"""Vehicle profiles, driver profiles and assignments (SRS §5; docs/api/deliveries.md).

- A **vehicle profile** records a vehicle type and its verified safe payload
  in litres (FR-013). Staff create them with the command-line tool.
- A **driver profile** links a ``driver`` account to the vehicle they use and
  says whether they are available for work. The account's ``is_active`` flag
  (FR-002) still decides whether they may sign in at all, and the profile's
  approval status whether they may work (docs/api/partners.md).
- An **assignment** offers one order to one driver. The database guarantees
  that an order has at most one live assignment and that a driver has at
  most one live job (``offered`` or ``accepted``), even under concurrent
  requests (FR-031: "concurrent assignments shall not overcommit a driver").
"""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    false,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, TimestampMixin, UUIDPrimaryKeyMixin

VEHICLE_TYPE_MAX_LENGTH = 50
MAX_SAFE_PAYLOAD_LITRES = 100_000


class AssignmentStatus(StrEnum):
    """Assignment statuses (docs/api/deliveries.md, "Assignment statuses")."""

    OFFERED = "offered"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    # Kept for when automatic offer expiry is decided; nothing sets it yet.
    EXPIRED = "expired"
    WITHDRAWN = "withdrawn"
    COMPLETED = "completed"


class DeclineReason(StrEnum):
    """Why a driver declined an offer (driver design J2-b; docs/api/deliveries.md)."""

    NOT_AVAILABLE = "not_available"
    VEHICLE_CANNOT_CARRY = "vehicle_cannot_carry"
    TOO_FAR = "too_far"
    UNSAFE_ACCESS = "unsafe_access"
    OTHER = "other"


DECLINE_NOTE_MAX_LENGTH = 300


# An assignment in one of these is "live": it holds the order and the driver.
LIVE_ASSIGNMENT_STATUSES = (AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED)
_LIVE = "status IN ('offered', 'accepted')"


class VehicleProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A vehicle type and its verified safe payload (FR-013).

    Attributes:
        vehicle_type: Free text, for example "Tricycle with 1,000 L tank".
        safe_payload_litres: Verified safe water payload per trip, adjusted
            for container and equipment weight. Must be checked by staff
            before it is entered; the system cannot verify it.
        is_active: Inactive profiles cannot be given to drivers.
    """

    __tablename__ = "vehicle_profiles"
    __table_args__ = (
        CheckConstraint(
            f"safe_payload_litres BETWEEN 1 AND {MAX_SAFE_PAYLOAD_LITRES}",
            name="safe_payload_litres_range",
        ),
    )

    vehicle_type: Mapped[str] = mapped_column(String(VEHICLE_TYPE_MAX_LENGTH))
    safe_payload_litres: Mapped[int]
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())


class ApprovalStatus(StrEnum):
    """Whether a partner may work (docs/api/partners.md, "Approval status").

    Separate from ``users.is_active`` (FR-002): a pending or suspended partner
    can still sign in, but cannot go online or be offered jobs; a deactivated
    account cannot sign in at all. The SRS defines only activation, so these
    states are a recorded decision (partners.md, decision 1).
    """

    PENDING = "pending"
    APPROVED = "approved"
    SUSPENDED = "suspended"


class DeliveryType(StrEnum):
    """The partner's vehicle kind, chosen at sign-up (design decision 9)."""

    KEKE = "keke"
    TANKER = "tanker"


class TransferMethod(StrEnum):
    """Tank types a partner can pour into (FR-013 "transfer method").

    The same values as an order's ``tank_type`` (docs/api/order-details-and-price.md).
    Only an admin sets them, at approval (partners.md, decision 4).
    """

    GROUND = "ground"
    OVERHEAD = "overhead"


#: Plate: 4-15 characters after trimming (partners.md, decision 3).
PLATE_MIN_LENGTH = 4
PLATE_MAX_LENGTH = 15
#: Declared tanker capacity typed at sign-up, in local gallons (design answer
#: 11c; frontend/src/domain/tankCapacity.ts). 500 is the smallest tanker
#: order; 20,000 only catches typos.
MIN_DECLARED_GALLONS = 500
MAX_DECLARED_GALLONS = 20_000


def _enum_column(enum: type[StrEnum], name: str, length: int) -> Enum:
    # VARCHAR plus a named CHECK, the schema's convention for enums.
    return Enum(
        enum,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=length,
        values_callable=lambda members: [member.value for member in members],
    )


class DriverProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Dispatch details of a driver account.

    A partner who signs up (docs/api/partners.md) gets a profile at once,
    ``pending`` and unavailable, with the vehicle they **declared**. An admin
    checks the vehicle and links a vehicle profile with its verified safe
    payload at approval (FR-013; partners.md, decision 8). Until then
    ``vehicle_profile_id`` is null and dispatch reports ``no_driver_profile``.

    Attributes:
        user_id: The ``driver`` account; one profile per account.
        vehicle_profile_id: The verified vehicle the driver uses, or null
            until an admin links one.
        is_available: Whether the driver can take new work now (FR-031
            "availability"). Set by the partner (``PUT /driver/availability``)
            or the command-line tool.
        approval_status: :class:`ApprovalStatus`. Drivers created before
            partner sign-up were backfilled ``approved``.
        delivery_type: Declared at sign-up; null for drivers created with the
            command-line tool before it asked.
        plate: Declared plate, trimmed and upper-cased; null as above.
        declared_capacity_gallons: Tanker capacity the driver typed. A claim,
            never used by dispatch, which reads only the verified payload
            (BR-03).
        transfer_methods: :class:`TransferMethod` values set by an admin;
            empty until then.
        new_order_alerts: Partner preference, stored only (partners.md,
            decision 5): no partner message is sent yet.
        sms_updates: As ``new_order_alerts``.
        location_sharing_on: Explicit dispatch-location consent is enabled.
        location_sharing_grant: Monotonic version invalidating late writes
            after withdrawal or offline (#410, FR-035).
    """

    __tablename__ = "driver_profiles"
    __table_args__ = (
        CheckConstraint("location_sharing_grant >= 0", name="location_sharing_grant_nonnegative"),
        CheckConstraint(
            f"declared_capacity_gallons BETWEEN {MIN_DECLARED_GALLONS} AND {MAX_DECLARED_GALLONS}",
            name="declared_capacity_gallons_range",
        ),
        CheckConstraint(
            f"char_length(plate) BETWEEN {PLATE_MIN_LENGTH} AND {PLATE_MAX_LENGTH}",
            name="plate_length",
        ),
        CheckConstraint(
            "transfer_methods <@ ARRAY['ground', 'overhead']::varchar[]",
            name="transfer_methods_values",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), unique=True
    )
    vehicle_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicle_profiles.id", ondelete="RESTRICT"), index=True, default=None
    )
    is_available: Mapped[bool] = mapped_column(default=True, server_default=true())
    approval_status: Mapped[ApprovalStatus] = mapped_column(
        _enum_column(ApprovalStatus, "approval_status", 20), default=ApprovalStatus.PENDING
    )
    delivery_type: Mapped[DeliveryType | None] = mapped_column(
        _enum_column(DeliveryType, "delivery_type", 10), default=None
    )
    plate: Mapped[str | None] = mapped_column(String(PLATE_MAX_LENGTH), default=None)
    declared_capacity_gallons: Mapped[int | None] = mapped_column(default=None)
    transfer_methods: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default=text("'{}'::varchar[]")
    )
    new_order_alerts: Mapped[bool] = mapped_column(default=True, server_default=true())
    sms_updates: Mapped[bool] = mapped_column(default=True, server_default=true())
    location_sharing_on: Mapped[bool] = mapped_column(default=False, server_default=false())
    location_sharing_grant: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default=text("0")
    )


class DriverServiceZone(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A service zone a driver works in (FR-031 "service area").

    docs/api/admin-directory.md, "Data needed". A partner's sign-up zone is
    their first row (partners.md). Zones are never deleted, only switched
    off, so the foreign key restricts.

    Attributes:
        driver_profile_id: The driver profile.
        zone_id: The service zone.
    """

    __tablename__ = "driver_service_zones"
    __table_args__ = (UniqueConstraint("driver_profile_id", "zone_id"),)

    driver_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("driver_profiles.id", ondelete="CASCADE"), index=True
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_zones.id", ondelete="RESTRICT"), index=True
    )


class Assignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One offer of one order to one driver (FR-031, FR-032).

    Rows are kept after they end, as the order's assignment history.

    Attributes:
        order_id: The order offered.
        driver_user_id: The driver's account (``users.id``).
        status: :class:`AssignmentStatus`.
        offered_by: The dispatcher who made the offer.
        responded_at: When the driver accepted or declined.
        ended_at: When it stopped being live (declined, withdrawn, completed).
        decline_reason: :class:`DeclineReason` given by the driver, if they
            declined through the driver app. Null otherwise.
        decline_note: The driver's own words with the decline (required for
            ``other`` by the API).
    """

    __tablename__ = "assignments"
    __table_args__ = (
        # At most one live assignment per order, and one live job per driver.
        Index(
            "uq_assignments_live_order",
            "order_id",
            unique=True,
            postgresql_where=text(_LIVE),
        ),
        Index(
            "uq_assignments_live_driver",
            "driver_user_id",
            unique=True,
            postgresql_where=text(_LIVE),
        ),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), index=True
    )
    driver_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[AssignmentStatus] = mapped_column(
        Enum(
            AssignmentStatus,
            name="assignment_status",
            native_enum=False,
            create_constraint=True,
            length=20,
            values_callable=lambda statuses: [status.value for status in statuses],
        )
    )
    offered_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    responded_at: Mapped[datetime | None] = mapped_column(default=None)
    ended_at: Mapped[datetime | None] = mapped_column(default=None)
    decline_reason: Mapped[DeclineReason | None] = mapped_column(
        Enum(
            DeclineReason,
            name="decline_reason",
            native_enum=False,
            create_constraint=True,
            length=30,
            values_callable=lambda reasons: [reason.value for reason in reasons],
        ),
        default=None,
    )
    decline_note: Mapped[str | None] = mapped_column(String(DECLINE_NOTE_MAX_LENGTH), default=None)
