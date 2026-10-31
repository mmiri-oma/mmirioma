"""Request and response models for the admin hold review endpoints.

Shapes follow docs/api/deliveries.md, "Admin hold review endpoints" (agreed
2026-10-21, PR #91). The admin order list, detail and history keep the
shapes agreed earlier; the list and detail gain ``hold``, and the history
gains ``kind`` and ``hold`` only with ``include=holds``.
"""

import uuid
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.modules.confirmation.service import ConfirmationLine
from app.modules.deliveries.holds import (
    CancellationOutcome,
    EligibilityAnswer,
    HeldOrder,
    HistoryItem,
    HistoryKind,
    HoldEntry,
    HoldReview,
    ProofEvidence,
)
from app.modules.deliveries.models import (
    MAX_DELIVERY_CODE_ATTEMPTS,
    RESOLUTION_NOTE_MAX_LENGTH,
    AlternativeProofReason,
    CustomerAcknowledgementMethod,
    ExceptionCategory,
    HoldKind,
    HoldResolution,
    OrderException,
    SmsStatus,
)
from app.modules.dispatch.schemas import (
    AdminOrderEvent,
    ContactAttemptRead,
    EventActor,
    PersonRead,
)
from app.modules.orders.models import EVENT_NOTE_MAX_LENGTH, OrderStatus, TransitionReason
from app.modules.orders.schemas import AdminOrderFilters, AdminOrderRead, OrderHoldRead
from app.modules.orders.service import ReadLookups
from app.modules.payments.models import CashEventKind
from app.modules.payments.schemas import CashEventRead
from app.modules.payments.service import CashHistoryEntry

DecisionNote = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=RESOLUTION_NOTE_MAX_LENGTH),
]
OptionalNote = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=EVENT_NOTE_MAX_LENGTH)
]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


def hold_read(hold: OrderException | None) -> OrderHoldRead | None:
    """The ``hold`` field of an admin order, from its open hold exception."""
    if hold is None or hold.hold_kind is None:
        return None
    return OrderHoldRead(id=hold.id, kind=hold.hold_kind.value, since=hold.created_at)


# --- Admin order list (R0) ---------------------------------------------------------


class AdminOrderListFilters(AdminOrderFilters):
    """Query parameters of ``GET /admin/orders``.

    Attributes:
        on_hold: True for orders whose job has an open hold (any kind), false
            for orders without one, omitted for both.
    """

    on_hold: bool | None = None


class AdminOrderListItem(AdminOrderRead):
    """An order on the admin list: ``AdminOrderRead`` plus its driver (#204, #243).

    The detail keeps the full ``assignment`` instead (admin dispatch, decision
    4); the list carries only who has the order, so the Rider column can name
    them without a request per row.

    Attributes:
        driver: The driver of the order's live assignment (``offered`` or
            ``accepted``); for a delivered, failed or cancelled order, the driver
            of its completed assignment; for a cancelled one, also the driver
            who had accepted the job before it was withdrawn; else null (not
            confirmed, in the pool, declined, withdrawn, disputed). Rules:
            ``dispatch.service.listed_drivers_by_order``.
    """

    driver: PersonRead | None

    @classmethod
    def from_held(
        cls, item: HeldOrder, hold: OrderHoldRead | None, *, lookups: ReadLookups
    ) -> AdminOrderListItem:
        """Build the list item from an order with its hold and live driver."""
        base = AdminOrderRead.from_order(
            item.staff_order.order, item.staff_order.customer, hold, lookups=lookups
        )
        return cls(
            **base.model_dump(),
            driver=None if item.driver is None else PersonRead.from_user(item.driver),
        )


class HeldAdminOrderPage(BaseModel):
    """A page of orders for staff, each with its ``hold`` and live ``driver``."""

    items: list[AdminOrderListItem]
    total: int
    limit: int
    offset: int


# --- Requests ----------------------------------------------------------------


class CustomerAcknowledgmentIn(_Request):
    """How the administrator confirmed the delivery with the customer (R1).

    Attributes:
        method: Phone call with the customer, in person to staff, or other.
        confirmed_at: When the customer confirmed; checked by the service
            against unloading and the current time.
        note: Optional, up to 500 characters; required with ``other``.
    """

    method: CustomerAcknowledgementMethod
    confirmed_at: AwareDatetime
    note: OptionalNote | None = None

    @field_validator("note")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _note_with_other(self) -> CustomerAcknowledgmentIn:
        if self.method is CustomerAcknowledgementMethod.OTHER and self.note is None:
            raise ValueError("A note is required when the method is other")
        return self


class ProofOverrideRequest(_Request):
    """Body of ``POST /admin/orders/{reference}/proof-overrides``.

    Attributes:
        hold_id: The open ``proof_review`` hold.
        decision: ``approve`` or ``reject``.
        customer_acknowledgment: Required to approve; must be absent to reject.
        note: Required, 1-500 characters after trimming; for a rejection, the reason.
    """

    hold_id: uuid.UUID
    decision: Literal["approve", "reject"]
    customer_acknowledgment: CustomerAcknowledgmentIn | None = None
    note: DecisionNote

    @model_validator(mode="after")
    def _acknowledgment_matches_decision(self) -> ProofOverrideRequest:
        if self.decision == "approve" and self.customer_acknowledgment is None:
            raise ValueError("customer_acknowledgment is required to approve")
        if self.decision == "reject" and self.customer_acknowledgment is not None:
            raise ValueError("customer_acknowledgment is only sent to approve")
        return self


class HoldDecisionRequest(_Request):
    """Body of ``POST .../hold/continue`` and ``.../hold/resume``.

    Attributes:
        hold_id: The open hold being decided.
        note: Required, 1-500 characters after trimming. For resume, the safe
            alternative.
    """

    hold_id: uuid.UUID
    note: DecisionNote


class AdminTransitionRequest(_Request):
    """Body of ``POST /admin/orders/{reference}/transition`` (fail and cancel only).

    Attributes:
        to: ``failed`` or ``cancelled``.
        expected_status: The order status the administrator saw.
        reason_code: For ``failed``: ``source_quality_concern``,
            ``unsafe_access`` or ``other``; for ``cancelled``:
            ``mmirioma_unable`` or ``customer_request`` (checked by the service).
        note: Optional, up to 500 characters; required with ``other``, and
            for a cancel from ``unloading`` (checked by the service).
        hold_id: The hold FAIL or CANCEL was opened from, if any.
    """

    to: Literal["failed", "cancelled"]
    expected_status: OrderStatus
    reason_code: TransitionReason
    note: OptionalNote | None = None
    hold_id: uuid.UUID | None = None

    @field_validator("note")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        return value or None


# --- HoldReview -------------------------------------------------------------------


class DeliveryCodeStateRead(BaseModel):
    """The newest delivery code's state. Never the code itself (FR-035)."""

    issued_at: datetime
    sms_status: SmsStatus
    attempts_used: int
    attempts_limit: int
    expired: bool


class LocationRead(BaseModel):
    """A GPS point the driver shared with consent; never a route."""

    latitude: float
    longitude: float
    accuracy_metres: float | None


class ProofRead(BaseModel):
    """``HoldReview.proof`` (R1)."""

    delivered_litres: int
    reason: AlternativeProofReason | None
    driver_note: str | None
    arrived_at: datetime | None
    unloading_completed_at: datetime | None
    sent_at: datetime
    delivery_code: DeliveryCodeStateRead | None
    contact_attempts: list[ContactAttemptRead]
    location: LocationRead | None

    @classmethod
    def from_evidence(cls, evidence: ProofEvidence) -> ProofRead:
        code = evidence.delivery_code
        return cls(
            delivered_litres=evidence.delivered_litres,
            reason=evidence.reason,
            driver_note=evidence.driver_note,
            arrived_at=evidence.arrived_at,
            unloading_completed_at=evidence.unloading_completed_at,
            sent_at=evidence.sent_at,
            delivery_code=None
            if code is None
            else DeliveryCodeStateRead(
                issued_at=code.issued_at,
                sms_status=code.sms_status,
                attempts_used=code.attempts,
                attempts_limit=MAX_DELIVERY_CODE_ATTEMPTS,
                expired=evidence.code_expired,
            ),
            contact_attempts=[
                ContactAttemptRead(attempted_at=at) for at in evidence.contact_attempts
            ],
            location=None
            if evidence.location is None
            else LocationRead(
                latitude=evidence.location.latitude,
                longitude=evidence.location.longitude,
                accuracy_metres=evidence.location.accuracy_metres,
            ),
        )


class SourceSummaryRead(BaseModel):
    id: uuid.UUID
    name: str
    approximate_location: str


class UsedAssignedSource(BaseModel):
    assigned: Literal[True] = True


class UsedOtherSource(BaseModel):
    assigned: Literal[False] = False
    name: str


class PickupRead(BaseModel):
    """``HoldReview.pickup`` (R2)."""

    assigned_source: SourceSummaryRead | None
    used_source: UsedAssignedSource | UsedOtherSource
    source_reference: str | None
    volume_collected_litres: int
    picked_up_at: datetime
    safety_concern: bool
    safety_note: str | None


class SourceEligibilityRead(BaseModel):
    """The server's eligibility answer; ``message`` is shown word for word."""

    answer: EligibilityAnswer
    message: str


class UnsafeReportRead(BaseModel):
    """``HoldReview.report`` (R3)."""

    kind: ExceptionCategory
    note: str | None
    reported_at: datetime
    order_status_then: OrderStatus | None


class IncidentRead(BaseModel):
    """Another incident the driver reported on this job."""

    kind: ExceptionCategory
    reported_at: datetime
    note: str | None


class HoldReviewRead(BaseModel):
    """Body of ``GET /admin/orders/{reference}/hold``."""

    id: uuid.UUID
    kind: HoldKind
    since: datetime
    order_status: OrderStatus
    driver: PersonRead
    proof: ProofRead | None
    pickup: PickupRead | None
    source_eligibility: SourceEligibilityRead | None
    report: UnsafeReportRead | None
    incidents: list[IncidentRead]
    withdraw_allowed: bool

    @classmethod
    def from_review(cls, review: HoldReview) -> HoldReviewRead:
        hold = review.hold
        pickup = None
        if review.pickup is not None:
            record = review.pickup.pickup
            source = review.pickup.assigned_source
            pickup = PickupRead(
                assigned_source=None
                if source is None
                else SourceSummaryRead(
                    id=source.id, name=source.name, approximate_location=source.approximate_location
                ),
                used_source=UsedAssignedSource()
                if record.other_source_name is None
                else UsedOtherSource(name=record.other_source_name),
                source_reference=record.source_reference,
                volume_collected_litres=record.volume_collected_litres,
                picked_up_at=record.picked_up_at,
                safety_concern=record.safety_concern,
                safety_note=record.safety_note,
            )
        report = review.report
        eligibility = review.source_eligibility
        return cls(
            id=hold.id,
            kind=HoldKind(hold.hold_kind),
            since=hold.created_at,
            order_status=review.order.status,
            driver=PersonRead.from_user(review.driver),
            proof=None if review.proof is None else ProofRead.from_evidence(review.proof),
            pickup=pickup,
            source_eligibility=None
            if eligibility is None
            else SourceEligibilityRead(answer=eligibility.answer, message=eligibility.message),
            report=None
            if report is None
            else UnsafeReportRead(
                kind=report.kind,
                note=report.note,
                reported_at=report.reported_at,
                order_status_then=report.order_status_then,
            ),
            incidents=[
                IncidentRead(kind=item.category, reported_at=item.created_at, note=item.note)
                for item in review.incidents
            ],
            withdraw_allowed=review.withdraw_allowed,
        )


class CancellationOutcomeRead(BaseModel):
    """Body of ``GET .../cancellation-outcome``. The charge is integer kobo."""

    reason_code: TransitionReason
    customer_charge_minor_units: int
    message: str

    @classmethod
    def from_outcome(cls, outcome: CancellationOutcome) -> CancellationOutcomeRead:
        return cls(
            reason_code=outcome.reason_code,
            customer_charge_minor_units=outcome.customer_charge_minor_units,
            message=outcome.message,
        )


# --- History with holds (include=holds, decision 8) -----------------------------------


class EventHoldRead(BaseModel):
    """The hold a history entry is about.

    Attributes:
        category: The exception category that opened it (for example
            ``source_mismatch``, ``unsafe_access``).
        decision: Set on ``hold_decided`` entries only.
    """

    id: uuid.UUID
    kind: HoldKind
    category: ExceptionCategory
    decision: HoldResolution | None


class AdminOrderEventWithHolds(AdminOrderEvent):
    """A history entry when the client asked for ``include=holds``.

    Hold entries have null ``from_status`` and ``to_status``. So do cash
    entries (``kind`` one of the five cash steps), which carry ``cash``
    (docs/api/payments.md, amendment 1); ``cash`` is null on every other
    entry.
    """

    kind: HistoryKind | CashEventKind
    to_status: OrderStatus | None
    hold: EventHoldRead | None
    cash: CashEventRead | None

    @classmethod
    def from_item(
        cls, item: HistoryItem, confirmations: Mapping[uuid.UUID, ConfirmationLine]
    ) -> AdminOrderEventWithHolds:
        if not isinstance(item, HoldEntry):
            return cls(
                **AdminOrderEvent.from_entry(item, confirmations).model_dump(),
                kind=HistoryKind.STATUS_CHANGE,
                hold=None,
                cash=None,
            )
        actor = item.actor
        return cls(
            id=_entry_id(item),
            kind=item.kind,
            from_status=None,
            to_status=None,
            actor=None
            if actor is None
            else EventActor(id=actor.id, role=actor.role, name=actor.name),
            reason_code=None,
            note=item.note,
            created_at=item.created_at,
            assignment=None,
            confirmation=None,
            hold=EventHoldRead(
                id=item.hold_id, kind=item.hold_kind, category=item.category, decision=item.decision
            ),
            cash=None,
        )

    @classmethod
    def from_cash(cls, entry: CashHistoryEntry) -> AdminOrderEventWithHolds:
        """Build a cash step entry (payments module); its statuses are null."""
        event = entry.event
        actor = entry.actor
        return cls(
            id=event.id,
            kind=event.kind,
            from_status=None,
            to_status=None,
            actor=None
            if actor is None
            else EventActor(id=actor.id, role=actor.role, name=actor.name),
            reason_code=None,
            note=event.note,
            created_at=event.occurred_at,
            assignment=None,
            confirmation=None,
            hold=None,
            cash=CashEventRead.from_entry(entry),
        )


def _entry_id(entry: HoldEntry) -> uuid.UUID:
    # Hold entries have no row of their own. Derive a stable id from the hold,
    # so the same entry keeps its id between reads and never equals the hold's.
    return uuid.uuid5(entry.hold_id, f"{entry.kind}:{entry.created_at.isoformat()}")


class AdminOrderHistoryWithHolds(BaseModel):
    """Body of ``GET .../history?include=holds``: newest first."""

    items: list[AdminOrderEventWithHolds]
