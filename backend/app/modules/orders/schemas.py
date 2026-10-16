"""Request, query and response models for the order endpoints (docs/api/orders.md).

Field rules come from the contract's "Field rules" table (FR-020, FR-021).
Responses carry no price: Sprint 1 orders are price-less requests (FR-021,
FR-022).
"""

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
)

from app.modules.auth.models import User
from app.modules.orders.models import (
    CONTACT_NAME_MAX_LENGTH,
    DELIVERY_ADDRESS_MAX_LENGTH,
    DELIVERY_INSTRUCTIONS_MAX_LENGTH,
    LANDMARK_MAX_LENGTH,
    MAX_QUANTITY_LITRES,
    MIN_QUANTITY_LITRES,
    Order,
    OrderStatus,
)
from app.modules.orders.service import NewOrder
from app.shared import lagos_time
from app.shared.phone import normalize_nigerian_phone

DELIVERY_ADDRESS_MIN_LENGTH = 5
PAGE_LIMIT_DEFAULT = 50
PAGE_LIMIT_MAX = 100


def _blank_to_none(value: str) -> str | None:
    # An optional field left as spaces means "not given", so it is stored as
    # null rather than an empty string.
    return value or None


# strict=True rejects JSON strings ("200"), floats (200.0) and booleans, so a
# client bug cannot silently become a valid quantity.
QuantityLitres = Annotated[int, Field(strict=True, ge=MIN_QUANTITY_LITRES, le=MAX_QUANTITY_LITRES)]
ContactName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=CONTACT_NAME_MAX_LENGTH),
]
ContactPhone = Annotated[str, Field(max_length=32), AfterValidator(normalize_nigerian_phone)]
DeliveryAddress = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=DELIVERY_ADDRESS_MIN_LENGTH,
        max_length=DELIVERY_ADDRESS_MAX_LENGTH,
    ),
]
Landmark = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=LANDMARK_MAX_LENGTH),
    AfterValidator(_blank_to_none),
]
DeliveryInstructions = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=DELIVERY_INSTRUCTIONS_MAX_LENGTH),
    AfterValidator(_blank_to_none),
]


class OrderCreate(BaseModel):
    """Body of ``POST /orders``.

    Unknown fields (price, status, customer, ``is_simulated``) are rejected:
    the server sets those.
    """

    model_config = ConfigDict(extra="forbid")

    idempotency_key: uuid.UUID
    quantity_litres: QuantityLitres
    contact_name: ContactName
    contact_phone: ContactPhone
    delivery_address: DeliveryAddress
    landmark: Landmark | None = None
    delivery_instructions: DeliveryInstructions | None = None
    preferred_delivery_date: date | None = None

    @field_validator("preferred_delivery_date")
    @classmethod
    def _not_in_the_past(cls, value: date | None) -> date | None:
        # "Today or later in Africa/Lagos" (contract field rules). A
        # preference only; it does not reserve a slot (FR-025).
        if value is not None and value < lagos_time.lagos_today():
            raise ValueError("Choose today or a later date")
        return value

    def to_new_order(self) -> NewOrder:
        """Convert to the service's input type.

        Returns:
            The validated, normalized order details.
        """
        return NewOrder(**self.model_dump())


class OrderRead(BaseModel):
    """An order as its customer sees it (``OrderRead`` in the contract).

    Has no internal ID, customer ID or ``is_simulated``: customers never see
    them (BR-09).
    """

    model_config = ConfigDict(from_attributes=True)

    reference: str
    status: OrderStatus
    quantity_litres: int
    contact_name: str
    contact_phone: str
    delivery_address: str
    landmark: str | None
    delivery_instructions: str | None
    preferred_delivery_date: date | None
    created_at: datetime
    updated_at: datetime


class OrderCustomer(BaseModel):
    """The ordering customer's account, shown to staff.

    Attributes:
        phone_verified: Whether a dispatcher has verified the phone (FR-003).
    """

    id: uuid.UUID
    name: str
    phone: str
    phone_verified: bool


class AdminOrderRead(OrderRead):
    """An order as staff see it: the customer view plus internal fields."""

    id: uuid.UUID
    customer: OrderCustomer
    is_simulated: bool

    @classmethod
    def from_order(cls, order: Order, customer: User) -> AdminOrderRead:
        """Build the staff view of an order.

        Args:
            order: The order.
            customer: The account that placed it.

        Returns:
            The admin representation.
        """
        return cls(
            **OrderRead.model_validate(order).model_dump(),
            id=order.id,
            customer=OrderCustomer(
                id=customer.id,
                name=customer.name,
                phone=customer.phone,
                phone_verified=customer.phone_verified_at is not None,
            ),
            is_simulated=order.is_simulated,
        )


class OrderPage(BaseModel):
    """A page of the customer's own orders (shared page shape, docs/api/README.md)."""

    items: list[OrderRead]
    total: int
    limit: int
    offset: int


class AdminOrderPage(BaseModel):
    """A page of orders for staff."""

    items: list[AdminOrderRead]
    total: int
    limit: int
    offset: int


class PageParams(BaseModel):
    """``limit`` (1-100, default 50) and ``offset`` (0 or more) query parameters."""

    limit: int = Field(PAGE_LIMIT_DEFAULT, ge=1, le=PAGE_LIMIT_MAX)
    offset: int = Field(0, ge=0)


class AdminOrderFilters(PageParams):
    """Query parameters of ``GET /admin/orders``.

    Attributes:
        status: Statuses to include; repeat the parameter for several. Empty
            means all statuses.
        created_from: First creation date to include (Africa/Lagos).
        created_to: Last creation date to include (Africa/Lagos).
        is_simulated: True for demo records only, false for real orders only,
            omitted for both (BR-09).
    """

    status: list[OrderStatus] = []
    created_from: date | None = None
    created_to: date | None = None
    is_simulated: bool | None = None

    @field_validator("created_to")
    @classmethod
    def _range_not_reversed(cls, value: date | None, info: ValidationInfo) -> date | None:
        created_from = info.data.get("created_from")
        if value is not None and created_from is not None and value < created_from:
            raise ValueError("created_to must be on or after created_from")
        return value
