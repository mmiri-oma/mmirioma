"""Request and response bodies of the admin driver directory.

Source: docs/api/admin-directory.md, "Drivers" (agreed, G3, #43). The design
says "rider" (Keke) and "driver" (Tanker), together "partner"; the server role
is ``driver`` for both, so the paths and fields here say driver. Staff see
phones (NFR-003); nothing here is sent to a partner.
"""

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.modules.dispatch.models import (
    MAX_SAFE_PAYLOAD_LITRES,
    VEHICLE_TYPE_MAX_LENGTH,
    ApprovalStatus,
    DeliveryType,
    TransferMethod,
)
from app.modules.orders.schemas import PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX
from app.modules.partners.schemas import PartnerVehicleRead, ZoneRead

#: ``q`` on the driver list: trimmed, 1-100 characters (as for customers).
SearchText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

#: The reason on an approval or activation change (NFR-004 audit).
REASON_MIN_LENGTH = 5
REASON_MAX_LENGTH = 500
Reason = Annotated[str, StringConstraints(strip_whitespace=True, max_length=REASON_MAX_LENGTH)]


class AdminDriverListParams(BaseModel):
    """Query parameters of ``GET /admin/drivers``.

    Attributes:
        delivery_type: ``keke`` or ``tanker`` (the design's pills).
        approval_status: ``pending``, ``approved`` or ``suspended``.
        is_active: ``false`` lists deactivated accounts (FR-002).
        q: Matches a part of the name (case-insensitive), the vehicle type
            or, with 4 or more digits, a part of the phone.
        limit: Page size, 1-100 (default 50).
        offset: Rows to skip.
    """

    delivery_type: DeliveryType | None = None
    approval_status: ApprovalStatus | None = None
    is_active: bool | None = None
    q: SearchText | None = None
    limit: int = Field(PAGE_LIMIT_DEFAULT, ge=1, le=PAGE_LIMIT_MAX)
    offset: int = Field(0, ge=0)


class AdminDriverRead(BaseModel):
    """One driver, as staff see them (the contract's ``AdminDriver``).

    ``vehicle`` is the same object as in the partner's own profile, so both
    sides read one record.
    """

    id: uuid.UUID
    name: str
    phone: str
    phone_verified: bool
    is_active: bool
    approval_status: ApprovalStatus
    is_available: bool
    vehicle: PartnerVehicleRead
    zones: list[ZoneRead]
    live_jobs: int
    completed_jobs: int
    delivered_jobs: int
    created_at: datetime


class AdminDriverCountsRead(BaseModel):
    """Counts over every driver, ignoring the list filters, for the pills."""

    all: int
    keke: int
    tanker: int
    pending: int
    inactive: int
    available: int


class AdminDriverPageRead(BaseModel):
    """A page of drivers, by name, plus the counts for the pills and the header."""

    items: list[AdminDriverRead]
    total: int
    limit: int
    offset: int
    counts: AdminDriverCountsRead


class ApprovalVehicle(BaseModel):
    """The vehicle the admin verified in person (FR-013). Unknown fields are refused.

    Attributes:
        description: The vehicle profile's text, 1-50 characters.
        safe_payload_litres: The verified safe payload per trip, whole litres
            (BR-03); the declared capacity is only a claim.
        transfer_methods: ``ground`` and ``overhead``, each at most once; may be
            empty.
    """

    model_config = ConfigDict(extra="forbid")

    description: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=VEHICLE_TYPE_MAX_LENGTH),
    ]
    safe_payload_litres: StrictInt = Field(ge=1, le=MAX_SAFE_PAYLOAD_LITRES)
    transfer_methods: list[TransferMethod]

    @field_validator("transfer_methods")
    @classmethod
    def _each_method_once(cls, methods: list[TransferMethod]) -> list[TransferMethod]:
        if len(set(methods)) != len(methods):
            raise ValueError("List each transfer method at most once")
        return methods


class ApprovalChange(BaseModel):
    """``POST /admin/drivers/{id}/approval``. Unknown fields are refused.

    A partner never goes back to ``pending``: that is only the state after
    sign-up. To suspend, a reason of 5-500 characters is required and a
    ``vehicle`` is not allowed. To approve, the reason is optional; whether a
    ``vehicle`` is required depends on the partner (the service checks).
    """

    model_config = ConfigDict(extra="forbid")

    approval_status: ApprovalStatus
    reason: Reason | None = None
    vehicle: ApprovalVehicle | None = None

    @field_validator("approval_status")
    @classmethod
    def _never_back_to_pending(cls, status: ApprovalStatus) -> ApprovalStatus:
        if status is ApprovalStatus.PENDING:
            raise ValueError("Use approved or suspended")
        return status

    @model_validator(mode="after")
    def _suspension_rules(self) -> Self:
        if self.approval_status is ApprovalStatus.SUSPENDED:
            if self.reason is None or len(self.reason) < REASON_MIN_LENGTH:
                raise ValueError(f"A reason of at least {REASON_MIN_LENGTH} characters is required")
            if self.vehicle is not None:
                raise ValueError("A vehicle is not allowed when suspending")
        return self


class ActivationChange(BaseModel):
    """``POST /admin/drivers/{id}/activation``. Unknown fields are refused.

    To deactivate, a reason of 5-500 characters is required (NFR-004); to
    activate it is optional.
    """

    model_config = ConfigDict(extra="forbid")

    is_active: bool
    reason: Reason | None = None

    @model_validator(mode="after")
    def _deactivation_needs_a_reason(self) -> Self:
        if not self.is_active and (self.reason is None or len(self.reason) < REASON_MIN_LENGTH):
            raise ValueError(f"A reason of at least {REASON_MIN_LENGTH} characters is required")
        return self
