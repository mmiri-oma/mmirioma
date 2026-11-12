"""Water source persistence (SRS §5, FR-011, FR-012, FR-014).

- ``water_sources``: a supplier or source where water is collected, with an
  approximate pickup location and its **kind** (``ninth_mile`` or
  ``borehole``, #21), which a Tanker customer's source preference matches.
  The kind says where the water is collected, never its quality (FR-014).
- ``water_categories``: the two categories the app offers, Potable Water and
  Utility Water (FR-014), seeded by migration ``0011``. Labels are
  admin-configured; a later change never alters a confirmed order, which
  keeps its own copy of the label (FR-024).
- ``water_source_categories``: one activation per source and category, the
  FR-012 safety gate. A source may serve a category only while its
  activation is ``activated`` and its laboratory approval is current
  (:mod:`app.modules.sources.eligibility`). It records the laboratory report
  **reference** only: the reports are kept privately outside the app (pilot
  fallback F1). The supplier's cost per litre is stored here and never sent
  to a client.

These rows are entered on the admin Water sources screen (#309, #407) or
with the command-line tool (:mod:`app.modules.sources.cli`, F1). A row here
records that an admin entered an approval; it is not itself legal compliance
(FR-012).
"""

import uuid
from datetime import date
from enum import StrEnum

from geoalchemy2 import Geography, WKBElement
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    false,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, TimestampMixin, UUIDPrimaryKeyMixin

SOURCE_NAME_MAX_LENGTH = 120
APPROXIMATE_LOCATION_MAX_LENGTH = 200
CATEGORY_CODE_MAX_LENGTH = 20
CATEGORY_LABEL_MAX_LENGTH = 60
SUPPORTED_USES_MAX_LENGTH = 500
REPORT_REFERENCE_MAX_LENGTH = 100
STATUS_REASON_MAX_LENGTH = 500
CONTACT_NAME_MAX_LENGTH = 120
#: E.164: ``+234`` and ten digits is 14 characters; 16 leaves room for the format.
CONTACT_PHONE_MAX_LENGTH = 16


class WaterSourceKind(StrEnum):
    """Where a source collects water (order details contract, point 2).

    The same values as ``orders.models.WaterSourcePreference``, which the
    orders module defines itself; a test keeps the two equal.
    """

    NINTH_MILE = "ninth_mile"
    BOREHOLE = "borehole"


class WaterSource(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A supplier or source where water is collected.

    Attributes:
        name: Supplier or source name shown to drivers, e.g. "Sample Borehole A".
        approximate_location: Approximate pickup location in words (FR-011),
            enough for a driver to find it.
        location: The pickup point, a WGS 84 point an administrator sets, or
            null (#385). Road-distance pricing needs it: a quote that could use
            a source without one is priced with the zone's fee instead. Never
            sent to a customer or a driver, and never guessed from the text.
        is_simulated: True for demo data (BR-09). A real order may still use
            a simulated source for now (order confirmation contract,
            decision 9); clients show its Simulated tag.
        kind: :class:`WaterSourceKind`, or null until an admin sets it. A
            source with no kind cannot be activated and is excluded from every
            order with ``kind_not_set`` (#407, decision 407-2).
        contact_name, contact_phone: Who to call at the source (#407,
            decision 407-1), or null. The phone is E.164. Admin-only: never
            sent to a customer or a driver, never audited or logged.
        min_litres_per_order, max_litres_per_order: The order sizes, in whole
            litres of the complete order, the supplier agreed to serve (D14,
            decision 407-3), or null for no limit.
        is_available: Whether the source takes new work now. Not a safety
            status: that is suspend and revoke on an activation (BR-10).
        serves_keke, serves_tanker: The vehicles that can load here (D14). At
            least one is true; :attr:`vehicle_kinds` is the list the API uses.
    """

    __tablename__ = "water_sources"
    __table_args__ = (
        CheckConstraint(
            "min_litres_per_order IS NULL OR min_litres_per_order >= 1",
            name="min_litres_positive",
        ),
        CheckConstraint(
            "max_litres_per_order IS NULL OR max_litres_per_order >= 1",
            name="max_litres_positive",
        ),
        CheckConstraint(
            "min_litres_per_order IS NULL OR max_litres_per_order IS NULL"
            " OR min_litres_per_order <= max_litres_per_order",
            name="min_litres_not_above_max",
        ),
        CheckConstraint("serves_keke OR serves_tanker", name="serves_a_vehicle"),
        # Nearest-source lookups for dispatch (#411) and road pricing (#408).
        Index("ix_water_sources_location", "location", postgresql_using="gist"),
    )

    name: Mapped[str] = mapped_column(String(SOURCE_NAME_MAX_LENGTH))
    approximate_location: Mapped[str] = mapped_column(String(APPROXIMATE_LOCATION_MAX_LENGTH))
    location: Mapped[WKBElement | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False)
    )
    is_simulated: Mapped[bool] = mapped_column(default=False, server_default=false())
    kind: Mapped[WaterSourceKind | None] = mapped_column(
        Enum(
            WaterSourceKind,
            name="water_source_kind",
            native_enum=False,
            create_constraint=True,
            length=12,
            values_callable=lambda kinds: [kind.value for kind in kinds],
        )
    )
    contact_name: Mapped[str | None] = mapped_column(String(CONTACT_NAME_MAX_LENGTH))
    contact_phone: Mapped[str | None] = mapped_column(String(CONTACT_PHONE_MAX_LENGTH))
    min_litres_per_order: Mapped[int | None] = mapped_column(Integer)
    max_litres_per_order: Mapped[int | None] = mapped_column(Integer)
    is_available: Mapped[bool] = mapped_column(default=True, server_default=true())
    serves_keke: Mapped[bool] = mapped_column(default=True, server_default=true())
    serves_tanker: Mapped[bool] = mapped_column(default=True, server_default=true())

    @property
    def vehicle_kinds(self) -> list[str]:
        """The vehicles that can load here, ``keke`` before ``tanker`` (#407)."""
        return [
            kind
            for kind, serves in (("keke", self.serves_keke), ("tanker", self.serves_tanker))
            if serves
        ]


class WaterCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A water category the app offers (FR-014).

    Attributes:
        code: Stable code: ``potable`` or ``utility``. Unique. Used by the
            command-line tool; clients use ``id`` and ``label``.
        label: Admin-configured label, e.g. "Potable Water". Never a
            description of the water itself.
        supported_uses: Admin-configured description of what the water may
            be used for, or null until it is written.
        is_active: Whether the category is offered at all. A category is
            also only usable while a source is eligible for it (FR-014).
    """

    __tablename__ = "water_categories"

    code: Mapped[str] = mapped_column(String(CATEGORY_CODE_MAX_LENGTH), unique=True)
    label: Mapped[str] = mapped_column(String(CATEGORY_LABEL_MAX_LENGTH))
    supported_uses: Mapped[str | None] = mapped_column(String(SUPPORTED_USES_MAX_LENGTH))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())


class ActivationStatus(StrEnum):
    """State of a source's activation for one category (FR-012, BR-10).

    - ``activated``: approved for the category after laboratory
      verification; usable while ``approved_until`` has not passed.
    - ``suspended``: stopped after a safety concern (BR-10); may be
      activated again.
    - ``revoked``: withdrawn.
    """

    ACTIVATED = "activated"
    SUSPENDED = "suspended"
    REVOKED = "revoked"


class WaterSourceCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One source's activation for one water category (the FR-012 gate).

    Attributes:
        source_id: The water source.
        water_category_id: The category.
        status: :class:`ActivationStatus`.
        approved_until: Last Lagos date the laboratory approval is valid
            (inclusive). From the next day the source is
            ``approval_expired`` for this category (T-04).
        report_reference: Reference of the laboratory report kept outside the
            app, e.g. "LR-0001" (F1). Never a document or link.
        cost_per_litre_minor_units: The supplier's cost per litre in kobo
            (FR-011, SRS §5). Used for pricing later; **never** sent to a
            client.
        status_reason: Why the activation was suspended or revoked. Required
            for those statuses, null when activated.
    """

    __tablename__ = "water_source_categories"
    __table_args__ = (
        UniqueConstraint("source_id", "water_category_id"),
        CheckConstraint("cost_per_litre_minor_units >= 0", name="cost_not_negative"),
        CheckConstraint(
            "(status = 'activated') = (status_reason IS NULL)",
            name="reason_only_when_not_activated",
        ),
    )

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("water_sources.id", ondelete="RESTRICT"), index=True
    )
    water_category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("water_categories.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[ActivationStatus] = mapped_column(
        Enum(
            ActivationStatus,
            name="activation_status",
            native_enum=False,
            create_constraint=True,
            length=20,
            values_callable=lambda members: [member.value for member in members],
        )
    )
    approved_until: Mapped[date]
    report_reference: Mapped[str] = mapped_column(String(REPORT_REFERENCE_MAX_LENGTH))
    cost_per_litre_minor_units: Mapped[int] = mapped_column(BigInteger)
    status_reason: Mapped[str | None] = mapped_column(String(STATUS_REASON_MAX_LENGTH))
