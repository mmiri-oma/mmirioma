"""Request and response bodies of the admin water-source endpoints (#309).

docs/api/admin-water-sources.md. ``cost_per_litre_minor_units`` is the
supplier's cost, an integer in kobo. It appears only in these bodies, which
only an admin can reach; no customer, driver or quote response carries it.
The supplier contact (#407) follows the same rule.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.core.config import get_settings
from app.modules.sources.eligibility import (
    EligibilityReason,
    OrderFitReason,
    eligibility_reasons,
    source_wide_reasons,
)
from app.modules.sources.models import (
    APPROXIMATE_LOCATION_MAX_LENGTH,
    CONTACT_NAME_MAX_LENGTH,
    REPORT_REFERENCE_MAX_LENGTH,
    SOURCE_NAME_MAX_LENGTH,
    STATUS_REASON_MAX_LENGTH,
    ActivationStatus,
    WaterCategory,
    WaterSourceCategory,
    WaterSourceKind,
)
from app.modules.sources.service import SourceWithActivations
from app.shared.lagos_time import lagos_today
from app.shared.location import DECIMAL_PLACES, OUT_OF_BOUNDS_MESSAGE
from app.shared.phone import normalize_nigerian_phone

#: How many days before ``approved_until`` an activation starts to warn
#: (decision 4 on #309; fixed in docs/design/admin-water-sources.md).
EXPIRY_WARNING_DAYS = 30

#: ``water_source_categories.cost_per_litre_minor_units`` is a BIGINT.
MAX_COST_MINOR_UNITS = 2**63 - 1
#: ``water_sources.min_litres_per_order`` and ``max_litres_per_order`` are INTEGER.
MAX_LITRES_PER_ORDER = 2**31 - 1

#: The #407 fields a PATCH may set to ``null`` (clearing them), with ``location``.
NULLABLE_UPDATE_FIELDS = frozenset(
    {"location", "contact_name", "contact_phone", "min_litres_per_order", "max_litres_per_order"}
)

SourceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=SOURCE_NAME_MAX_LENGTH)
]
Location = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=APPROXIMATE_LOCATION_MAX_LENGTH
    ),
]
ReportReference = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=REPORT_REFERENCE_MAX_LENGTH),
]
Reason = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=STATUS_REASON_MAX_LENGTH),
]
ContactName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=CONTACT_NAME_MAX_LENGTH),
]


def _nigerian_mobile(value: str) -> str:
    # The normalizer's message never echoes the number, so it is safe to return.
    return normalize_nigerian_phone(value)


ContactPhone = Annotated[str, AfterValidator(_nigerian_mobile)]
LitresPerOrder = Annotated[int, Field(strict=True, ge=1, le=MAX_LITRES_PER_ORDER)]
VehicleKind = Literal["keke", "tanker"]


def _vehicle_kinds(kinds: list[VehicleKind]) -> list[VehicleKind]:
    """At least one, no repeats; returned keke before tanker (#407)."""
    if len(set(kinds)) != len(kinds):
        raise ValueError("List each vehicle kind once")
    return [kind for kind in ("keke", "tanker") if kind in kinds]


VehicleKinds = Annotated[list[VehicleKind], Field(min_length=1), AfterValidator(_vehicle_kinds)]


def _max_not_below_min(value: int | None, info: ValidationInfo) -> int | None:
    """Refuse a maximum below the minimum sent in the same body (#407).

    A PATCH that sends only one of them is checked against the stored value
    by the service instead.
    """
    minimum = info.data.get("min_litres_per_order")
    if value is not None and minimum is not None and minimum > value:
        raise ValueError("max_litres_per_order cannot be below min_litres_per_order")
    return value


MaxLitresPerOrder = Annotated[LitresPerOrder | None, AfterValidator(_max_not_below_min)]


class SourceLocationBody(BaseModel):
    """A source's pickup point (``location`` in the #385 amendment): WGS 84 degrees.

    Refused outside ``DELIVERY_LOCATION_BOUNDS``, like a delivery point, on the
    whole ``location`` field.
    """

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)

    @field_validator("latitude", "longitude")
    @classmethod
    def _round(cls, value: float) -> float:
        return round(value, DECIMAL_PLACES)


def _inside_bounds(location: SourceLocationBody | None) -> SourceLocationBody | None:
    if location is None:
        return None
    if not get_settings().delivery_bounds.contains(location.latitude, location.longitude):
        raise PydanticCustomError("value_error", OUT_OF_BOUNDS_MESSAGE)
    return location


SourceLocationField = Annotated[SourceLocationBody | None, AfterValidator(_inside_bounds)]


class WaterSourceCreate(BaseModel):
    """``POST /admin/water-sources``.

    ``is_simulated`` is never sent by the screen; it lets demo data still be
    flagged through the API (BR-09).
    """

    name: SourceName
    approximate_location: Location
    kind: WaterSourceKind | None = None
    location: SourceLocationField = None
    is_simulated: bool = False
    contact_name: ContactName | None = None
    contact_phone: ContactPhone | None = None
    min_litres_per_order: LitresPerOrder | None = None
    max_litres_per_order: MaxLitresPerOrder = None
    is_available: bool = True
    vehicle_kinds: VehicleKinds = Field(default_factory=lambda: ["keke", "tanker"])


class WaterSourceUpdate(BaseModel):
    """``PATCH /admin/water-sources/{source_id}``: only the fields that change.

    At least one field is required. ``null`` clears the pickup ``location``
    (#385) and the #407 contact and litre limits (:data:`NULLABLE_UPDATE_FIELDS`).
    Every other field cannot be sent as ``null``.
    """

    name: SourceName | None = None
    approximate_location: Location | None = None
    kind: WaterSourceKind | None = None
    location: SourceLocationField = None
    contact_name: ContactName | None = None
    contact_phone: ContactPhone | None = None
    min_litres_per_order: LitresPerOrder | None = None
    max_litres_per_order: MaxLitresPerOrder = None
    is_available: bool | None = None
    vehicle_kinds: VehicleKinds | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> Self:
        sent = self.model_fields_set
        if not sent:
            raise ValueError("Send at least one field to change")
        for field in sent - NULLABLE_UPDATE_FIELDS:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self

    def supplier_changes(self) -> dict[str, object]:
        """The #407 fields that were sent, by name, for the service."""
        fields = (
            "contact_name",
            "contact_phone",
            "min_litres_per_order",
            "max_litres_per_order",
            "is_available",
            "vehicle_kinds",
        )
        return {field: getattr(self, field) for field in fields if field in self.model_fields_set}


class ActivationWrite(BaseModel):
    """``PUT /admin/water-sources/{source_id}/activations/{category_id}``."""

    approved_until: date
    report_reference: ReportReference
    cost_per_litre_minor_units: Annotated[int, Field(strict=True, ge=0, le=MAX_COST_MINOR_UNITS)]

    @field_validator("approved_until")
    @classmethod
    def _not_in_the_past(cls, value: date) -> date:
        """Refuse a date before today in Lagos (decided on 2026-11-01, G3).

        An activation approved until yesterday would be expired the moment it
        is saved. Renewing an expired approval needs a new date. The command
        line keeps accepting a past date; the API does not.
        """
        if value < lagos_today():
            raise ValueError("approved_until must be today or later")
        return value


class ActivationCostWrite(BaseModel):
    """``PATCH /admin/water-sources/{source_id}/activations/{category_id}`` (#407).

    Only the cost; the status, report reference and date are not accepted.
    """

    model_config = ConfigDict(extra="forbid")

    cost_per_litre_minor_units: Annotated[int, Field(strict=True, ge=0, le=MAX_COST_MINOR_UNITS)]


class ActivationStatusWrite(BaseModel):
    """``POST /admin/water-sources/{source_id}/activations/{category_id}/status``.

    ``activated`` is refused (422): use the PUT to activate.
    """

    status: Literal["suspended", "revoked"]
    reason: Reason


class WaterCategoryRead(BaseModel):
    """A water category: id, code and label. The label is a name, never a claim."""

    id: uuid.UUID
    code: str
    label: str


class ExpiryRead(BaseModel):
    """Where an approval stands against today's date in Lagos.

    Attributes:
        state: ``ok``, ``expires_soon`` or ``expired``.
        days_left: Whole days from today to ``approved_until``: 0 on the last
            valid day, negative once expired.
    """

    state: Literal["ok", "expires_soon", "expired"]
    days_left: int


class ActivationRead(BaseModel):
    """One source's activation for one category."""

    category: WaterCategoryRead
    status: ActivationStatus
    approved_until: date
    report_reference: str
    cost_per_litre_minor_units: int
    status_reason: str | None
    expiry: ExpiryRead
    reasons: list[EligibilityReason]


class WaterSourceRead(BaseModel):
    """A source with its activations (``WaterSourceRead`` in the contract)."""

    id: uuid.UUID
    name: str
    approximate_location: str
    kind: WaterSourceKind | None
    location: SourceLocationBody | None
    is_simulated: bool
    created_at: datetime
    activations: list[ActivationRead]
    contact_name: str | None
    contact_phone: str | None
    min_litres_per_order: int | None
    max_litres_per_order: int | None
    is_available: bool
    vehicle_kinds: list[VehicleKind]
    source_reasons: list[OrderFitReason]


class WaterSourceListRead(BaseModel):
    """``GET /admin/water-sources``: every source, and both categories."""

    items: list[WaterSourceRead]
    categories: list[WaterCategoryRead]


def expiry_for(approved_until: date, *, today: date) -> ExpiryRead:
    """Return the expiry state of an approval.

    ``approved_until`` is the last valid day, inclusive (T-04), so on that day
    ``days_left`` is 0 and the state is still ``expires_soon``. From the next
    day it is ``expired``.

    Args:
        approved_until: The last Lagos date the approval is valid.
        today: Today's date in Lagos.

    Returns:
        The state and the whole days left.
    """
    days_left = (approved_until - today).days
    if days_left < 0:
        return ExpiryRead(state="expired", days_left=days_left)
    if days_left <= EXPIRY_WARNING_DAYS:
        return ExpiryRead(state="expires_soon", days_left=days_left)
    return ExpiryRead(state="ok", days_left=days_left)


def category_read(category: WaterCategory) -> WaterCategoryRead:
    """Build the category body."""
    return WaterCategoryRead(id=category.id, code=category.code, label=category.label)


def activation_read(
    activation: WaterSourceCategory, category: WaterCategory, *, today: date
) -> ActivationRead:
    """Build one activation body, with its expiry and eligibility reasons for today."""
    return ActivationRead(
        category=category_read(category),
        status=activation.status,
        approved_until=activation.approved_until,
        report_reference=activation.report_reference,
        cost_per_litre_minor_units=activation.cost_per_litre_minor_units,
        status_reason=activation.status_reason,
        expiry=expiry_for(activation.approved_until, today=today),
        reasons=eligibility_reasons(activation, today=today),
    )


def source_read(view: SourceWithActivations, *, today: date) -> WaterSourceRead:
    """Build a source body from a source and its activations."""
    source = view.source
    return WaterSourceRead(
        id=source.id,
        name=source.name,
        approximate_location=source.approximate_location,
        kind=source.kind,
        location=(
            SourceLocationBody(latitude=view.location.latitude, longitude=view.location.longitude)
            if view.location is not None
            else None
        ),
        is_simulated=source.is_simulated,
        created_at=source.created_at,
        activations=[
            activation_read(activation, category, today=today)
            for activation, category in view.activations
        ],
        contact_name=source.contact_name,
        contact_phone=source.contact_phone,
        min_litres_per_order=source.min_litres_per_order,
        max_litres_per_order=source.max_litres_per_order,
        is_available=source.is_available,
        vehicle_kinds=source.vehicle_kinds,
        source_reasons=source_wide_reasons(source),
    )
