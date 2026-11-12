"""Order confirmation request and response bodies (docs/api/deliveries.md).

"Order confirmation endpoints" (agreed G3, PR #111). Money is integer kobo
(``*_minor_units``, SRS §5); times are UTC; the client shows Lagos time.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)

from app.modules.auth.models import User
from app.modules.confirmation.service import (
    CategoryOptions,
    ConfirmationLine,
    ConfirmationView,
    ConfirmInput,
    SourceOption,
)
from app.modules.orders.models import (
    EVENT_NOTE_MAX_LENGTH,
    ConfirmationSmsStatus,
    Order,
    OrderStatus,
)
from app.modules.pricing.models import (
    KOBO_PER_NAIRA,
    MIN_MANUAL_QUOTE_MINOR_UNITS,
    AgreementMethod,
)
from app.modules.sources.eligibility import EligibilityReason, OrderFitReason
from app.modules.sources.models import WaterSourceKind

Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=EVENT_NOTE_MAX_LENGTH)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Request -----------------------------------------------------------------------


class DeliveryWindowIn(_Request):
    """The window agreed with the customer (F3), UTC; the end after the start."""

    start_at: AwareDatetime
    end_at: AwareDatetime

    @model_validator(mode="after")
    def _end_after_start(self) -> Self:
        if self.end_at <= self.start_at:
            raise ValueError("The window must end after it starts")
        return self


class CustomerAgreementIn(_Request):
    """How and when the customer agreed (C1 section 7).

    Attributes:
        disclosures_confirmed: Must be true: the dispatcher told the customer
            the total, category, window, cash after unloading, and no
            cancellation or redelivery charge (F5).
    """

    method: AgreementMethod
    agreed_at: AwareDatetime
    disclosures_confirmed: Literal[True]


class ConfirmRequest(_Request):
    """Body of ``POST /admin/orders/{reference}/transition`` with ``to: confirmed``.

    Attributes:
        expected_status: The status the dispatcher saw: ``quote_requested``
            (a quote request, priced by hand) or ``awaiting_confirmation`` (an
            order placed with a server quote, #21).
        manual_quote_total_minor_units: Whole naira in kobo (a multiple of
            100), at least ₦1.00, no upper limit (decision 7). Required from
            ``quote_requested``; refused from ``awaiting_confirmation``,
            where the quote's total is confirmed (question 14 of the order
            details contract: a changed price is a repricing, BR-05).
        note: Optional; required when the customer agreed some ``other`` way.
    """

    to: Literal["confirmed"]
    expected_status: Literal["quote_requested", "awaiting_confirmation"]
    water_category_id: uuid.UUID
    source_id: uuid.UUID
    delivery_window: DeliveryWindowIn
    manual_quote_total_minor_units: Annotated[
        int | None,
        Field(strict=True, ge=MIN_MANUAL_QUOTE_MINOR_UNITS, multiple_of=KOBO_PER_NAIRA),
    ] = Field(default=None, validate_default=True)
    customer_agreement: CustomerAgreementIn
    note: Note | None = None

    @field_validator("manual_quote_total_minor_units")
    @classmethod
    def _total_for_quote_requests_only(cls, total: int | None, info: ValidationInfo) -> int | None:
        # A missing expected_status is reported on its own field.
        expected = info.data.get("expected_status")
        if expected == "quote_requested" and total is None:
            raise ValueError("Enter the total agreed with the customer")
        if expected == "awaiting_confirmation" and total is not None:
            raise ValueError("This order has a quote; its total is confirmed as it is")
        return total

    @model_validator(mode="after")
    def _note_with_other(self) -> Self:
        if not self.note:
            self.note = None
        if self.customer_agreement.method is AgreementMethod.OTHER and self.note is None:
            raise ValueError("Add a note to say how the customer agreed")
        return self

    def to_input(self) -> ConfirmInput:
        """The service's input."""
        return ConfirmInput(
            expected_status=OrderStatus(self.expected_status),
            water_category_id=self.water_category_id,
            source_id=self.source_id,
            window_start_at=self.delivery_window.start_at,
            window_end_at=self.delivery_window.end_at,
            total_minor_units=self.manual_quote_total_minor_units,
            agreement_method=self.customer_agreement.method,
            agreed_at=self.customer_agreement.agreed_at,
            note=self.note,
        )


# --- Options -----------------------------------------------------------------------


class SourceOptionRead(BaseModel):
    """One source for a category. Never the cost per litre.

    Attributes:
        report_reference: For this category, or null with no activation.
        approved_until: Lagos date, inclusive, or null with no activation.
        reasons: Empty means it may be chosen for this order: the four safety
            reasons and the six #407 order-fit reasons, in that order. The
            order detail's ``source.reasons`` keeps the four safety reasons.
        kind: Where it collects water (``ninth_mile``, ``borehole``), or
            null until set; a quoted Tanker order needs the customer's kind
            (deliveries.md, amendment #72). Never a quality claim (FR-014).
    """

    id: uuid.UUID
    name: str
    approximate_location: str
    report_reference: str | None
    approved_until: date | None
    is_simulated: bool
    reasons: list[EligibilityReason | OrderFitReason]
    kind: WaterSourceKind | None

    @classmethod
    def from_option(cls, option: SourceOption) -> SourceOptionRead:
        activation = option.activation
        return cls(
            id=option.source.id,
            name=option.source.name,
            approximate_location=option.source.approximate_location,
            report_reference=None if activation is None else activation.report_reference,
            approved_until=None if activation is None else activation.approved_until,
            is_simulated=option.source.is_simulated,
            reasons=option.reasons,
            kind=option.source.kind,
        )


class CategoryOptionsRead(BaseModel):
    id: uuid.UUID
    label: str
    sources: list[SourceOptionRead]


class ConfirmationOptions(BaseModel):
    """Body of ``GET /admin/orders/{reference}/confirmation-options``."""

    categories: list[CategoryOptionsRead]

    @classmethod
    def from_options(cls, options: list[CategoryOptions]) -> ConfirmationOptions:
        return cls(
            categories=[
                CategoryOptionsRead(
                    id=item.category.id,
                    label=item.category.label,
                    sources=[SourceOptionRead.from_option(option) for option in item.sources],
                )
                for item in options
            ]
        )


# --- Order detail additions (C2) ----------------------------------------------------


class _Person(BaseModel):
    id: uuid.UUID
    name: str


class WaterCategoryRead(BaseModel):
    id: uuid.UUID
    label: str


class OrderSourceRead(BaseModel):
    """The order's source with its current eligibility for the order's category."""

    id: uuid.UUID
    name: str
    approximate_location: str
    report_reference: str | None
    reasons: list[EligibilityReason]


class DeliveryWindowRead(BaseModel):
    start_at: datetime
    end_at: datetime


class CustomerAgreementRead(BaseModel):
    method: AgreementMethod
    agreed_at: datetime


class PriceRead(BaseModel):
    """The frozen price snapshot (FR-024). ``manual`` is true in the pilot."""

    total_minor_units: int
    currency: Literal["NGN"]
    manual: bool
    water_category_label: str
    entered_by: _Person | None
    entered_at: datetime
    customer_agreement: CustomerAgreementRead


class ConfirmationSmsRead(BaseModel):
    """Whether the provider accepted the confirmation SMS; never that it arrived."""

    status: ConfirmationSmsStatus
    attempted_at: datetime


class OrderConfirmationFields(BaseModel):
    """The fields ``AdminOrderDetail`` gains (null on unconfirmed orders)."""

    water_category: WaterCategoryRead | None
    source: OrderSourceRead | None
    delivery_window: DeliveryWindowRead | None
    price: PriceRead | None
    confirmation_sms: ConfirmationSmsRead | None

    @classmethod
    def from_view(cls, order: Order, view: ConfirmationView) -> OrderConfirmationFields:
        snapshot = view.snapshot
        return cls(
            water_category=None
            if view.water_category is None
            else WaterCategoryRead(id=view.water_category.id, label=view.water_category.label),
            source=None
            if view.source is None
            else OrderSourceRead(
                id=view.source.source.id,
                name=view.source.source.name,
                approximate_location=view.source.source.approximate_location,
                report_reference=view.source.report_reference,
                reasons=view.source.reasons,
            ),
            delivery_window=None
            if order.delivery_window_start_at is None or order.delivery_window_end_at is None
            else DeliveryWindowRead(
                start_at=order.delivery_window_start_at, end_at=order.delivery_window_end_at
            ),
            price=None
            if snapshot is None
            else PriceRead(
                total_minor_units=snapshot.total_minor_units,
                currency="NGN",
                manual=snapshot.is_manual,
                water_category_label=snapshot.water_category_label,
                entered_by=_person(view.entered_by),
                entered_at=snapshot.entered_at,
                customer_agreement=CustomerAgreementRead(
                    method=snapshot.customer_agreement_method,
                    agreed_at=snapshot.customer_agreed_at,
                ),
            ),
            confirmation_sms=None
            if order.confirmation_sms_status is None or order.confirmation_sms_attempted_at is None
            else ConfirmationSmsRead(
                status=order.confirmation_sms_status,
                attempted_at=order.confirmation_sms_attempted_at,
            ),
        )


def _person(user: User | None) -> _Person | None:
    return None if user is None else _Person(id=user.id, name=user.name)


# --- History (H1) --------------------------------------------------------------------


class ConfirmationLineRead(BaseModel):
    """``confirmation`` on the history entry that confirmed the order."""

    water_category_label: str
    source_name: str
    delivery_window: DeliveryWindowRead
    total_minor_units: int
    manual: bool

    @classmethod
    def from_line(cls, line: ConfirmationLine | None) -> ConfirmationLineRead | None:
        if line is None:
            return None
        return cls(
            water_category_label=line.water_category_label,
            source_name=line.source_name,
            delivery_window=DeliveryWindowRead(
                start_at=line.window_start_at, end_at=line.window_end_at
            ),
            total_minor_units=line.total_minor_units,
            manual=line.manual,
        )
