"""Request and response bodies for the partner account (docs/api/partners.md)."""

import uuid
from datetime import date
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    ValidationInfo,
    field_validator,
)

from app.modules.auth.schemas import AcceptedTerms, Password, PersonName, PhoneNumber
from app.modules.dispatch.models import (
    MAX_DECLARED_GALLONS,
    MIN_DECLARED_GALLONS,
    PLATE_MAX_LENGTH,
    ApprovalStatus,
    DeliveryType,
    DriverProfile,
    VehicleProfile,
)
from app.modules.dispatch.plates import normalize_plate
from app.modules.partners.location_schemas import DriverLocationRead

#: Local gallons to litres, exactly (FR-021; docs/architecture/api-mapping.md).
LITRES_PER_LOCAL_GALLON = 4

# Generous before trimming; normalize_plate enforces 4-15 after it.
Plate = Annotated[str, Field(max_length=PLATE_MAX_LENGTH + 20), AfterValidator(normalize_plate)]


class PartnerRegisterRequest(BaseModel):
    """``POST /auth/partner-register``: partner self sign-up (design decision 9).

    Unknown fields (such as ``role`` or ``approval_status``) are rejected.
    """

    model_config = ConfigDict(extra="forbid")

    name: PersonName
    phone: PhoneNumber
    password: Password
    accepted_terms: AcceptedTerms
    delivery_type: DeliveryType
    plate: Plate
    # Validated even when absent, so a tanker without it is refused with
    # this field's ``loc`` (the contract names the field).
    declared_capacity_gallons: int | None = Field(default=None, validate_default=True)
    service_zone_id: uuid.UUID

    @field_validator("declared_capacity_gallons")
    @classmethod
    def _capacity_matches_vehicle(cls, value: int | None, info: ValidationInfo) -> int | None:
        delivery_type = info.data.get("delivery_type")
        if delivery_type is DeliveryType.KEKE:
            if value is not None:
                raise ValueError("Leave the capacity empty for a keke")
            return None
        if delivery_type is DeliveryType.TANKER:
            if value is None:
                raise ValueError("Enter how many gallons your tanker carries")
            if not MIN_DECLARED_GALLONS <= value <= MAX_DECLARED_GALLONS:
                raise ValueError(
                    f"Use {MIN_DECLARED_GALLONS:,} to {MAX_DECLARED_GALLONS:,} gallons"
                )
        return value


class PreferencesRead(BaseModel):
    """Partner preferences, stored only (partners.md, decision 5)."""

    new_order_alerts: bool
    sms_updates: bool


class PreferencesUpdate(BaseModel):
    """Any subset of the preferences; absent ones keep their value."""

    model_config = ConfigDict(extra="forbid")

    new_order_alerts: StrictBool | None = None
    sms_updates: StrictBool | None = None


class PartnerProfileUpdate(BaseModel):
    """``PATCH /driver/profile``. Only the preferences can change."""

    model_config = ConfigDict(extra="forbid")

    preferences: PreferencesUpdate | None = None


class AvailabilityUpdate(BaseModel):
    """``PUT /driver/availability``: going online or offline (FR-031)."""

    model_config = ConfigDict(extra="forbid")

    # Strict: "yes" or 1 is refused, not read as true (contract: a boolean).
    is_available: StrictBool


class ZoneRead(BaseModel):
    """A service zone the partner works in."""

    id: uuid.UUID
    name: str


class PartnerVehicleRead(BaseModel):
    """The partner's vehicle: declared at sign-up, verified by an admin.

    ``delivery_type`` and ``plate`` are null only for drivers created with
    the command-line tool before it asked for them.
    """

    delivery_type: DeliveryType | None
    plate: str | None
    description: str | None
    declared_capacity_gallons: int | None
    declared_capacity_litres: int | None
    safe_payload_litres: int | None
    transfer_methods: list[str]


def partner_vehicle_read(
    profile: DriverProfile, vehicle: VehicleProfile | None
) -> PartnerVehicleRead:
    """Build the vehicle object from a driver profile and its verified vehicle.

    The partner's own profile and the admin driver directory both use it, so
    both sides read one record (admin-directory.md, "Drivers").

    Args:
        profile: The driver profile (declared vehicle, transfer methods).
        vehicle: The verified vehicle profile, or None until an admin links one.

    Returns:
        The vehicle object; the declared litres are the gallons times 4.
    """
    gallons = profile.declared_capacity_gallons
    return PartnerVehicleRead(
        delivery_type=profile.delivery_type,
        plate=profile.plate,
        description=vehicle.vehicle_type if vehicle is not None else None,
        declared_capacity_gallons=gallons,
        declared_capacity_litres=None if gallons is None else gallons * LITRES_PER_LOCAL_GALLON,
        safe_payload_litres=vehicle.safe_payload_litres if vehicle is not None else None,
        transfer_methods=list(profile.transfer_methods),
    )


class PartnerProfileRead(BaseModel):
    """``PartnerProfileRead`` (docs/api/partners.md, "Partner object")."""

    id: uuid.UUID
    name: str
    phone: str
    phone_verified: bool
    approval_status: ApprovalStatus
    is_available: bool
    partner_since: date
    vehicle: PartnerVehicleRead
    service_zones: list[ZoneRead]
    preferences: PreferencesRead
    location: DriverLocationRead
