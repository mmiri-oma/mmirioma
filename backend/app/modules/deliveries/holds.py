"""Admin hold review (docs/api/deliveries.md, "Admin hold review endpoints", #93).

A driver's job can stop on a **hold**: an ``order_exceptions`` row with a
``hold_kind`` and no ``resolved_at`` (see :mod:`app.modules.deliveries.models`).
While it is open the driver's next step is refused. This module lets an
administrator see the evidence and decide, and serves the admin order views
that show holds. Rules, from the contract and the technical lead's decisions
on #88 (2026-10-20 and 2026-10-21):

- **An administrator decides every hold.** The router allows admins only, so
  a driver can never approve proof (T-23). Approving is also refused when
  the administrator is the job's driver or recorded the proof (BR-13, 403
  ``own_delivery_override``); rejecting is not.
- **The hold shown is the oldest open one on the order's live job.** Holds on
  ended jobs never count: every way a job ends here closes its holds.
- **Decisions name the hold** (``hold_id``). If that hold is no longer open,
  or is not the kind the endpoint decides, the request is refused with 409
  ``hold_not_open`` and nothing changes, so a stale screen cannot decide a
  newer hold.
- **A decision closes every open hold of its kind on the job.** A pickup
  that used another source and flagged a concern opens two
  ``source_review`` exceptions; they are one hold.
- **Proof review (FR-035, row 18).** Approve: the order becomes
  ``delivered`` with the proof's litres, the job ends and unused codes are
  voided; payment is not touched (BR-12). Reject: the proof no longer counts,
  the partial delivery exception it opened is closed (a new proof opens it
  again), the order stays ``unloading`` and the driver can send a new code.
- **Source review (FR-012, FR-034).** Continue only when the source is
  eligible for the order's water category, answered by the shared check in
  :mod:`app.modules.sources.eligibility` (#112). A free-text source is never
  eligible, and an order with no water category (set at confirmation, #113)
  answers ``cannot_check``, so until then the review ends in Fail or Cancel.
- **Unsafe stop (SRS §8).** Resume once the dispatcher records a safe
  alternative. Before departure the job may be withdrawn instead (row 11,
  technical lead 2026-10-21), which closes the hold.
- **Fail and cancel (rows 20, 23)** close every open hold on the job and never
  charge the customer: the failures here are attributable to MmiriOma
  (FR-038, BR-14) and ``mmirioma_unable`` cancellation is free (FR-044).
- **Records (NFR-004, contract decision 6).** Each decision is stored on the
  exception (who, when, how, note), on the proof for an override, as an
  ``audit_logs`` row in the same transaction, and as ``order_events`` for
  status changes.

Write functions lock the order row first (``orders.service.lock_order``),
then the assignment and the exceptions, as the driver and dispatch services
do, so concurrent decisions cannot both win.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from http import HTTPStatus

from geoalchemy2 import Geometry
from sqlalchemy import ColumnElement, cast, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.modules.audit import service as audit_service
from app.modules.auth import service as auth_service
from app.modules.auth.models import User
from app.modules.confirmation import service as confirmation_service
from app.modules.deliveries import codes
from app.modules.deliveries.models import (
    HOLD_DECISIONS,
    AcknowledgementMethod,
    AlternativeProofReason,
    ContactAttempt,
    CustomerAcknowledgementMethod,
    DeliveryAttempt,
    DeliveryCode,
    DeliveryOutcome,
    DeliveryProof,
    ExceptionCategory,
    HoldKind,
    HoldResolution,
    OrderException,
    OverrideStatus,
    PickupRecord,
)
from app.modules.dispatch import service as dispatch_service
from app.modules.dispatch.models import LIVE_ASSIGNMENT_STATUSES, Assignment, AssignmentStatus
from app.modules.orders import service as orders_service
from app.modules.orders.models import Order, OrderEvent, OrderStatus, TransitionReason
from app.modules.orders.service import StaffOrder
from app.modules.orders.transitions import Actor, Requirement, check_transition
from app.modules.payments import service as payments_service
from app.modules.sources.eligibility import EligibilityReason, source_reasons
from app.modules.sources.models import WaterSource
from app.shared.lagos_time import lagos_today

CLOCK_SKEW_TOLERANCE = timedelta(minutes=2)

# Exception categories a driver reports as incidents (``IncidentType``); the
# others are opened by the system.
DRIVER_INCIDENT_CATEGORIES = frozenset(
    {
        ExceptionCategory.RUNNING_LATE,
        ExceptionCategory.UNSAFE_ACCESS,
        ExceptionCategory.UNSAFE_TRANSFER,
        ExceptionCategory.VOLUME_ISSUE,
        ExceptionCategory.SOURCE_CONCERN,
        ExceptionCategory.VEHICLE_PROBLEM,
        ExceptionCategory.OTHER,
    }
)

# What this section agrees for the planned admin transition endpoint (rows 20
# and 23, with a cancel at the customer's request, #174); its other rows and
# reasons are agreed with the screens that use them.
TRANSITION_REASONS = {
    OrderStatus.FAILED: frozenset(
        {
            TransitionReason.SOURCE_QUALITY_CONCERN,
            TransitionReason.UNSAFE_ACCESS,
            TransitionReason.OTHER,
        }
    ),
    OrderStatus.CANCELLED: frozenset(
        {TransitionReason.MMIRIOMA_UNABLE, TransitionReason.CUSTOMER_REQUEST}
    ),
}

NO_CHARGE_MESSAGE = "The customer is not charged for this cancellation."


class EligibilityAnswer(StrEnum):
    """The server's answer on a source for an order's water category (FR-012)."""

    ELIGIBLE = "eligible"
    NOT_ELIGIBLE = "not_eligible"
    CANNOT_CHECK = "cannot_check"


@dataclass(frozen=True)
class SourceEligibility:
    """An eligibility answer with the text the client shows word for word."""

    answer: EligibilityAnswer
    message: str


class ProofDecision(StrEnum):
    """An administrator's decision on alternative proof (R1)."""

    APPROVE = "approve"
    REJECT = "reject"


@dataclass(frozen=True)
class CustomerAcknowledgment:
    """How the administrator confirmed the delivery with the customer.

    Attributes:
        method: Phone call, in person to staff, or other.
        confirmed_at: When the customer confirmed (aware).
        note: Optional; required with ``other`` (checked by the request schema).
    """

    method: CustomerAcknowledgementMethod
    confirmed_at: datetime
    note: str | None


# --- Views -------------------------------------------------------------------


@dataclass(frozen=True)
class HeldOrder:
    """An order for the admin list with its open hold and live driver, if any.

    Attributes:
        staff_order: The order and its customer.
        hold: The open hold on the order's current job, or None.
        driver: The driver of the order's live assignment (``offered`` or
            ``accepted``), or None (#204).
    """

    staff_order: StaffOrder
    hold: OrderException | None
    driver: User | None = None


@dataclass(frozen=True)
class OrderDetail:
    """The admin order detail: dispatch view, open hold and confirmation (C2)."""

    dispatch: dispatch_service.DispatchOrder
    hold: OrderException | None
    confirmation: confirmation_service.ConfirmationView
    #: Times of the order's contact attempts, oldest first (FR-038, #280); empty if none.
    contact_attempts: tuple[datetime, ...]
    #: The payment card (K6, docs/api/payments.md); None before confirmation.
    payment: payments_service.PaymentView | None = None
    #: The order's zone name and quote summary (order details contract).
    lookups: orders_service.ReadLookups = field(default_factory=orders_service.ReadLookups)


@dataclass(frozen=True)
class Point:
    """A consented GPS point, read back as coordinates (never a route)."""

    latitude: float
    longitude: float
    accuracy_metres: float | None


@dataclass(frozen=True)
class ProofEvidence:
    """What R1 shows for alternative proof (``HoldReview.proof``)."""

    delivered_litres: int
    reason: AlternativeProofReason | None
    driver_note: str | None
    arrived_at: datetime | None
    unloading_completed_at: datetime | None
    sent_at: datetime
    delivery_code: DeliveryCode | None
    code_expired: bool
    contact_attempts: tuple[datetime, ...]
    location: Point | None


@dataclass(frozen=True)
class PickupEvidence:
    """What R2 shows about the pickup (``HoldReview.pickup``)."""

    assigned_source: WaterSource | None
    pickup: PickupRecord


@dataclass(frozen=True)
class UnsafeReport:
    """What R3 shows about the stop (``HoldReview.report``)."""

    kind: ExceptionCategory
    note: str | None
    reported_at: datetime
    order_status_then: OrderStatus | None


@dataclass(frozen=True)
class HoldReview:
    """The evidence for the hold shown on an order (``GET .../hold``)."""

    hold: OrderException
    order: Order
    driver: User
    proof: ProofEvidence | None
    pickup: PickupEvidence | None
    source_eligibility: SourceEligibility | None
    report: UnsafeReport | None
    incidents: list[OrderException]
    withdraw_allowed: bool


class HistoryKind(StrEnum):
    """Kinds of staff history entry with ``include=holds`` (decision 8)."""

    STATUS_CHANGE = "status_change"
    HOLD_OPENED = "hold_opened"
    HOLD_DECIDED = "hold_decided"


@dataclass(frozen=True)
class HoldEntry:
    """A hold opened or decided, as a history entry.

    Attributes:
        kind: ``hold_opened`` or ``hold_decided``.
        hold_id: The hold (the oldest exception of a decision's group).
        hold_kind: Proof review, source review or unsafe stop.
        category: The exception category that opened it.
        decision: The decision, for ``hold_decided``.
        actor: The driver who opened it or the administrator who decided.
        note: The driver's note, or the decision note.
        created_at: When it opened, or when it was decided.
    """

    kind: HistoryKind
    hold_id: uuid.UUID
    hold_kind: HoldKind
    category: ExceptionCategory
    decision: HoldResolution | None
    actor: User | None
    note: str | None
    created_at: datetime


HistoryItem = dispatch_service.HistoryEntry | HoldEntry


# --- Errors ------------------------------------------------------------------


def _hold_not_open() -> APIError:
    return APIError(
        HTTPStatus.CONFLICT,
        "hold_not_open",
        "This hold has already been decided or has changed",
    )


def _invalid_transition(source: OrderStatus, target: OrderStatus) -> APIError:
    return APIError(
        HTTPStatus.CONFLICT,
        "invalid_order_transition",
        f"This order cannot move from {source} to {target}.",
        details={"from": source.value, "to": target.value},
    )


def _validation_error(loc: list[str | int], msg: str) -> APIError:
    return APIError(
        HTTPStatus.UNPROCESSABLE_ENTITY,
        "validation_error",
        "Request validation failed",
        details=[{"loc": loc, "msg": msg, "type": "value_error"}],
    )


# --- Finding holds -------------------------------------------------------------


def _open_hold_filter() -> list[ColumnElement[bool]]:
    return [
        OrderException.hold_kind.is_not(None),
        OrderException.resolved_at.is_(None),
        Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES),
    ]


def on_hold_condition() -> ColumnElement[bool]:
    """A condition on ``Order``: its live job has an open hold (the ``on_hold`` filter)."""
    return exists(
        select(OrderException.id)
        .join(Assignment, Assignment.id == OrderException.assignment_id)
        .where(OrderException.order_id == Order.id, *_open_hold_filter())
    )


async def current_holds(
    session: AsyncSession, order_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, OrderException]:
    """Each order's hold shown to staff: the oldest open hold on its live job.

    Args:
        session: Database session.
        order_ids: The orders.

    Returns:
        Order id to its hold; orders without one are absent.
    """
    if not order_ids:
        return {}
    holds: dict[uuid.UUID, OrderException] = {}
    for exception in await session.scalars(
        select(OrderException)
        .join(Assignment, Assignment.id == OrderException.assignment_id)
        .where(OrderException.order_id.in_(order_ids), *_open_hold_filter())
        .order_by(OrderException.created_at, OrderException.id)
    ):
        holds.setdefault(exception.order_id, exception)
    return holds


async def list_orders(
    session: AsyncSession,
    *,
    statuses: Sequence[OrderStatus],
    created_from: date | None,
    created_to: date | None,
    is_simulated: bool | None,
    on_hold: bool | None,
    limit: int,
    offset: int,
) -> tuple[list[HeldOrder], int]:
    """The admin order list with each order's hold (R0, FR-030).

    Args:
        session: Database session; the caller enforces the admin role.
        statuses, created_from, created_to, is_simulated, limit, offset: As
            :func:`app.modules.orders.service.list_orders_for_staff`.
        on_hold: True for orders with an open hold only, False for orders
            without one, None for both.

    Returns:
        ``(orders, total)``; ``total`` counts every match, so with
        ``on_hold=True`` it is the On hold count. Each order carries its driver
        (live, or the one who held an ended order; #243), read for the whole page at once.
    """
    extra = [] if on_hold is None else [on_hold_condition() if on_hold else ~on_hold_condition()]
    staff_orders, total = await orders_service.list_orders_for_staff(
        session,
        statuses=statuses,
        created_from=created_from,
        created_to=created_to,
        is_simulated=is_simulated,
        limit=limit,
        offset=offset,
        extra_conditions=extra,
    )
    order_ids = [item.order.id for item in staff_orders]
    holds = await current_holds(session, order_ids)
    drivers = await dispatch_service.listed_drivers_by_order(
        session, {item.order.id: item.order.status for item in staff_orders}
    )
    return [
        HeldOrder(
            staff_order=item, hold=holds.get(item.order.id), driver=drivers.get(item.order.id)
        )
        for item in staff_orders
    ], total


async def contact_attempt_times(session: AsyncSession, order_id: uuid.UUID) -> tuple[datetime, ...]:
    """Return the times of every contact attempt recorded on an order, oldest first.

    ``AdminOrderDetail.contact_attempts`` (docs/api/deliveries.md, "Amendment
    (#280)"). An attempt hangs off a delivery attempt (one arrival, one
    assignment), so this reads across all of the order's arrivals; today an
    order has one, and a rescheduled order will have more. Times only: the
    amendment sends no names, numbers or locations.

    Args:
        session: Database session; the caller enforces the admin role.
        order_id: The order.

    Returns:
        The server times of the attempts (UTC), oldest first; empty if no
        driver has reached the customer.
    """
    rows = await session.scalars(
        select(ContactAttempt.attempted_at)
        .join(DeliveryAttempt, DeliveryAttempt.id == ContactAttempt.delivery_attempt_id)
        .where(DeliveryAttempt.order_id == order_id)
        .order_by(ContactAttempt.attempted_at, ContactAttempt.id)
    )
    return tuple(rows)


async def get_order_detail(session: AsyncSession, *, reference: str) -> OrderDetail:
    """The admin order detail with its assignment and hold (R0).

    Raises:
        APIError: 404 ``order_not_found``.
    """
    dispatch = await dispatch_service.get_dispatch_order(session, reference=reference)
    order = dispatch.staff_order.order
    holds = await current_holds(session, [order.id])
    return OrderDetail(
        dispatch=dispatch,
        hold=holds.get(order.id),
        confirmation=await confirmation_service.confirmation_view(session, order),
        contact_attempts=await contact_attempt_times(session, order.id),
        payment=await payments_service.payment_view(session, order),
        lookups=await orders_service.read_lookups(session, [order]),
    )


# --- Evidence (R1, R2, R3) -------------------------------------------------------


#: R2's ``not_eligible`` message for the first eligibility reason (contract,
#: "Source eligibility (shared with R2)").
_NOT_ELIGIBLE_MESSAGES = {
    EligibilityReason.NOT_ACTIVATED: "This source is not activated for this water category.",
    EligibilityReason.SUSPENDED: "This source is suspended for this water category.",
    EligibilityReason.REVOKED: "This source's activation for this water category is revoked.",
    EligibilityReason.APPROVAL_EXPIRED: (
        "This source's laboratory approval for this water category has expired."
    ),
}


async def source_eligibility(
    session: AsyncSession,
    *,
    order: Order,
    pickup: PickupRecord | None,
    today: date | None = None,
) -> SourceEligibility:
    """Whether the source the driver used may serve the order's water category (FR-012).

    R2 keeps its agreed one-answer shape and takes it from the shared check
    (:mod:`app.modules.sources.eligibility`), in this order:

    1. A source the driver named in free text (``other_source_name``) is never
       in the source records, so it is ``not_eligible`` (hold review
       decision 7). Choosing a recorded source at pickup is #109.
    2. An order without a water category cannot be checked: the category is
       set at confirmation (#113), so older orders answer ``cannot_check``.
    3. Otherwise the source's reasons for the category: none is
       ``eligible``; else ``not_eligible`` with the first reason's message.

    Args:
        session: Database session.
        order: The order under review.
        pickup: The job's pickup record, or None if it has none; then the
            order's assigned source is checked.
        today: Today's date in Africa/Lagos (default: now).

    Returns:
        The answer and the message the client shows word for word.
    """
    used_source_id = pickup.source_id if pickup is not None else order.source_id
    if used_source_id is None:
        return SourceEligibility(
            EligibilityAnswer.NOT_ELIGIBLE, "This source is not in the source records."
        )
    if order.water_category_id is None:
        return SourceEligibility(
            EligibilityAnswer.CANNOT_CHECK, "This order has no water category."
        )
    reasons = await source_reasons(
        session,
        source_id=used_source_id,
        water_category_id=order.water_category_id,
        today=today or lagos_today(),
    )
    if not reasons:
        return SourceEligibility(
            EligibilityAnswer.ELIGIBLE,
            "This source is activated for the order's water category.",
        )
    return SourceEligibility(EligibilityAnswer.NOT_ELIGIBLE, _NOT_ELIGIBLE_MESSAGES[reasons[0]])


async def _live_assignment(
    session: AsyncSession, order_id: uuid.UUID, *, lock: bool = False
) -> Assignment | None:
    query = select(Assignment).where(
        Assignment.order_id == order_id, Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES)
    )
    return await session.scalar(query.with_for_update() if lock else query)


async def _pending_proof(session: AsyncSession, assignment_id: uuid.UUID) -> DeliveryProof | None:
    return await session.scalar(
        select(DeliveryProof)
        .where(
            DeliveryProof.assignment_id == assignment_id,
            DeliveryProof.method == AcknowledgementMethod.ALTERNATIVE_PROOF,
            DeliveryProof.override_status == OverrideStatus.PENDING,
        )
        .order_by(DeliveryProof.created_at.desc())
        .limit(1)
    )


async def _proof_point(session: AsyncSession, proof: DeliveryProof) -> Point | None:
    if proof.location is None:
        return None
    # Geography has no ST_X/ST_Y; a geometry cast reads the stored coordinates.
    geometry = cast(DeliveryProof.location, Geometry)
    row = (
        await session.execute(
            select(func.ST_Y(geometry), func.ST_X(geometry)).where(DeliveryProof.id == proof.id)
        )
    ).one()
    return Point(
        latitude=float(row[0]),
        longitude=float(row[1]),
        accuracy_metres=proof.location_accuracy_metres,
    )


async def _proof_evidence(
    session: AsyncSession, assignment: Assignment, order: Order, now: datetime
) -> ProofEvidence | None:
    proof = await _pending_proof(session, assignment.id)
    if proof is None:
        return None
    attempt = await session.get(DeliveryAttempt, proof.delivery_attempt_id)
    code = await session.scalar(
        select(DeliveryCode)
        .where(DeliveryCode.order_id == order.id)
        .order_by(DeliveryCode.issued_at.desc())
        .limit(1)
    )
    contacts = (
        tuple(
            await session.scalars(
                select(ContactAttempt.attempted_at)
                .where(ContactAttempt.delivery_attempt_id == attempt.id)
                .order_by(ContactAttempt.attempted_at, ContactAttempt.id)
            )
        )
        if attempt is not None
        else ()
    )
    return ProofEvidence(
        delivered_litres=proof.delivered_litres,
        reason=proof.alternative_reason,
        driver_note=proof.alternative_note,
        arrived_at=attempt.arrived_at if attempt else None,
        unloading_completed_at=attempt.unloading_completed_at if attempt else None,
        sent_at=proof.delivered_at,
        delivery_code=code,
        code_expired=code is not None and not codes.is_usable(code, now),
        contact_attempts=contacts,
        location=await _proof_point(session, proof),
    )


async def _status_at(
    session: AsyncSession, order_id: uuid.UUID, at: datetime
) -> OrderStatus | None:
    return await session.scalar(
        select(OrderEvent.to_status)
        .where(OrderEvent.order_id == order_id, OrderEvent.created_at <= at)
        .order_by(OrderEvent.created_at.desc(), OrderEvent.id.desc())
        .limit(1)
    )


async def get_hold_review(
    session: AsyncSession, *, reference: str, now: datetime | None = None
) -> HoldReview:
    """The evidence for the hold shown on an order (R1, R2, R3).

    Only the part for the hold's kind is filled. The delivery code itself is
    never read (only its state), and a GPS point appears only if the driver
    shared it with consent (FR-035).

    Args:
        session: Database session; the caller enforces the admin role.
        reference: Public order reference.
        now: Current time, for tests.

    Returns:
        The review.

    Raises:
        APIError: 404 ``order_not_found``; 404 ``hold_not_found`` when the
            order has no open hold (it was decided meanwhile).
    """
    now = now or datetime.now(UTC)
    order = (await orders_service.get_order_for_staff(session, reference=reference)).order
    hold = (await current_holds(session, [order.id])).get(order.id)
    assignment = None if hold is None else await _live_assignment(session, order.id)
    if hold is None or assignment is None or hold.hold_kind is None:
        raise APIError(HTTPStatus.NOT_FOUND, "hold_not_found", "This order has no open hold")
    driver = (await auth_service.get_users_by_ids(session, {assignment.driver_user_id}))[
        assignment.driver_user_id
    ]

    proof = pickup = eligibility = report = None
    if hold.hold_kind is HoldKind.PROOF_REVIEW:
        proof = await _proof_evidence(session, assignment, order, now)
    elif hold.hold_kind is HoldKind.SOURCE_REVIEW:
        record = await session.scalar(
            select(PickupRecord).where(PickupRecord.assignment_id == assignment.id)
        )
        if record is not None:
            assigned = await session.get(WaterSource, order.source_id) if order.source_id else None
            pickup = PickupEvidence(assigned_source=assigned, pickup=record)
        eligibility = await source_eligibility(session, order=order, pickup=record)
    else:
        report = UnsafeReport(
            kind=hold.category,
            note=hold.note,
            reported_at=hold.created_at,
            order_status_then=await _status_at(session, order.id, hold.created_at),
        )

    incidents = list(
        await session.scalars(
            select(OrderException)
            .where(
                OrderException.assignment_id == assignment.id,
                OrderException.category.in_(DRIVER_INCIDENT_CATEGORIES),
                OrderException.id != hold.id,
            )
            .order_by(OrderException.created_at, OrderException.id)
        )
    )
    return HoldReview(
        hold=hold,
        order=order,
        driver=driver,
        proof=proof,
        pickup=pickup,
        source_eligibility=eligibility,
        report=report,
        incidents=incidents,
        withdraw_allowed=order.status is OrderStatus.ACCEPTED,
    )


# --- Decisions -------------------------------------------------------------------


@dataclass(frozen=True)
class _Locked:
    order: Order
    assignment: Assignment
    holds: list[OrderException]


async def _lock_hold(
    session: AsyncSession, *, reference: str, hold_id: uuid.UUID, kind: HoldKind
) -> _Locked:
    """Lock the order, its live job and that job's open holds of ``kind``.

    Raises:
        APIError: 404 ``order_not_found``; 409 ``hold_not_open`` unless
            ``hold_id`` is one of those open holds.
    """
    order_id = (await orders_service.get_order_for_staff(session, reference=reference)).order.id
    order = await orders_service.lock_order(session, order_id)
    assignment = await _live_assignment(session, order.id, lock=True)
    holds = (
        []
        if assignment is None
        else list(
            await session.scalars(
                select(OrderException)
                .where(
                    OrderException.assignment_id == assignment.id,
                    OrderException.hold_kind == kind,
                    OrderException.resolved_at.is_(None),
                )
                .order_by(OrderException.created_at, OrderException.id)
                .with_for_update()
            )
        )
    )
    if assignment is None or not any(hold.id == hold_id for hold in holds):
        await session.rollback()
        raise _hold_not_open()
    return _Locked(order=order, assignment=assignment, holds=holds)


def _close(
    holds: Sequence[OrderException],
    *,
    admin: User,
    resolution: HoldResolution,
    note: str | None,
    now: datetime,
) -> None:
    for hold in holds:
        hold.resolved_at = now
        hold.resolved_by = admin.id
        hold.resolution = resolution
        hold.resolution_note = note


def _audit(
    session: AsyncSession, *, admin: User, action: str, order: Order, hold: OrderException
) -> None:
    # Ids and kinds only: notes stay on the exception (CLAUDE.md, Security).
    audit_service.record(
        session,
        actor_id=admin.id,
        action=action,
        target_type="order",
        target_id=order.id,
        details={
            "hold_id": str(hold.id),
            "hold_kind": hold.hold_kind.value if hold.hold_kind else None,
        },
    )


async def decide_proof(
    session: AsyncSession,
    *,
    reference: str,
    admin: User,
    hold_id: uuid.UUID,
    decision: ProofDecision,
    acknowledgment: CustomerAcknowledgment | None,
    note: str,
    now: datetime | None = None,
) -> OrderDetail:
    """Approve or reject alternative proof (R1, FR-035, row 18). Commits.

    See the module docstring for both outcomes. Approval needs the
    customer's acknowledgment (method and time) and is refused for the
    delivering driver or whoever recorded the proof (BR-13).

    Args:
        session: Database session.
        reference: Public order reference.
        admin: The signed-in administrator.
        hold_id: The open ``proof_review`` hold being decided.
        decision: Approve or reject.
        acknowledgment: Required to approve; ignored for a rejection.
        note: Required decision note; for a rejection, the reason.
        now: Current time, for tests.

    Returns:
        The order after the decision, with any hold still open.

    Raises:
        APIError: 404 ``order_not_found``; 409 ``hold_not_open``; 403
            ``own_delivery_override``; 409 ``invalid_order_transition`` unless
            the order is ``unloading``; 422 ``validation_error`` for an
            acknowledgment time in the future or before unloading was
            completed.
    """
    now = now or datetime.now(UTC)
    locked = await _lock_hold(
        session, reference=reference, hold_id=hold_id, kind=HoldKind.PROOF_REVIEW
    )
    order, assignment = locked.order, locked.assignment
    if order.status is not OrderStatus.UNLOADING:
        current = order.status
        await session.rollback()
        raise _invalid_transition(current, OrderStatus.DELIVERED)
    proof = await _pending_proof(session, assignment.id)
    if proof is None:
        # A proof_review hold always comes with its proof; without one there
        # is nothing to decide.
        await session.rollback()
        raise _hold_not_open()
    attempt = await session.get(DeliveryAttempt, proof.delivery_attempt_id)

    if decision is ProofDecision.APPROVE:
        # BR-13, T-23: never the person who delivered or recorded the proof.
        if admin.id in {assignment.driver_user_id, proof.recorded_by}:
            await session.rollback()
            raise APIError(
                HTTPStatus.FORBIDDEN,
                "own_delivery_override",
                "You can't approve proof for a delivery you made.",
            )
        if acknowledgment is None:
            # The request schema requires it; checked here for other callers.
            await session.rollback()
            raise _validation_error(
                ["body", "customer_acknowledgment"], "Required to approve the proof"
            )
        confirmed_at = acknowledgment.confirmed_at
        unloaded_at = attempt.unloading_completed_at if attempt else None
        if confirmed_at > now + CLOCK_SKEW_TOLERANCE or (
            unloaded_at is not None and confirmed_at < unloaded_at - CLOCK_SKEW_TOLERANCE
        ):
            await session.rollback()
            raise _validation_error(
                ["body", "customer_acknowledgment", "confirmed_at"],
                "Use a time after unloading was completed and not in the future",
            )
        proof.override_status = OverrideStatus.APPROVED
        proof.customer_ack_method = acknowledgment.method
        proof.customer_ack_at = confirmed_at
        proof.customer_ack_note = acknowledgment.note
    else:
        proof.override_status = OverrideStatus.REJECTED
    proof.override_decided_by = admin.id
    proof.override_decided_at = now
    proof.override_note = note

    if decision is ProofDecision.APPROVE:
        await session.flush()
        try:
            await orders_service.transition_order(
                session,
                order_id=order.id,
                target=OrderStatus.DELIVERED,
                actor=admin,
                satisfied={
                    Requirement.DELIVERED_QUANTITY_RECORDED,
                    Requirement.UNLOADING_CONFIRMED,
                    Requirement.PROOF_OVERRIDE_APPROVED,
                },
                commit=False,
            )
        except APIError:
            await session.rollback()
            raise
        assignment.status = AssignmentStatus.COMPLETED
        assignment.ended_at = now
        if attempt is not None:
            attempt.outcome = DeliveryOutcome.DELIVERED
        # The delivery is proven; no outstanding code may be used any more.
        await session.execute(
            update(DeliveryCode)
            .where(
                DeliveryCode.order_id == order.id,
                DeliveryCode.invalidated_at.is_(None),
                DeliveryCode.used_at.is_(None),
            )
            .values(invalidated_at=now, updated_at=now)
        )
        _close(
            locked.holds, admin=admin, resolution=HoldResolution.PROOF_APPROVED, note=note, now=now
        )
        _audit(
            session,
            admin=admin,
            action="proof_override_approved",
            order=order,
            hold=locked.holds[0],
        )
    else:
        # The partial delivery recorded with this proof described litres that
        # no longer count; a new proof opens it again (FR-036).
        partials = await session.scalars(
            select(OrderException).where(
                OrderException.assignment_id == assignment.id,
                OrderException.category == ExceptionCategory.PARTIAL_DELIVERY,
                OrderException.resolved_at.is_(None),
                OrderException.created_at >= proof.created_at,
            )
        )
        _close(
            [*locked.holds, *partials],
            admin=admin,
            resolution=HoldResolution.PROOF_REJECTED,
            note=note,
            now=now,
        )
        _audit(
            session,
            admin=admin,
            action="proof_override_rejected",
            order=order,
            hold=locked.holds[0],
        )
    await session.commit()
    return await get_order_detail(session, reference=reference)


async def continue_source(
    session: AsyncSession,
    *,
    reference: str,
    admin: User,
    hold_id: uuid.UUID,
    note: str,
    now: datetime | None = None,
) -> OrderDetail:
    """Let the driver continue after a source review (R2, FR-012, FR-034). Commits.

    Allowed only when :func:`source_eligibility` answers ``eligible``,
    checked again here under the lock. The order stays ``collected``.

    Raises:
        APIError: 404 ``order_not_found``; 409 ``hold_not_open``; 409
            ``source_not_eligible`` with the answer's message and
            ``details.answer``.
    """
    now = now or datetime.now(UTC)
    locked = await _lock_hold(
        session, reference=reference, hold_id=hold_id, kind=HoldKind.SOURCE_REVIEW
    )
    record = await session.scalar(
        select(PickupRecord).where(PickupRecord.assignment_id == locked.assignment.id)
    )
    eligibility = await source_eligibility(session, order=locked.order, pickup=record)
    if eligibility.answer is not EligibilityAnswer.ELIGIBLE:
        await session.rollback()
        raise APIError(
            HTTPStatus.CONFLICT,
            "source_not_eligible",
            eligibility.message,
            details={"answer": eligibility.answer.value},
        )
    _close(
        locked.holds, admin=admin, resolution=HoldResolution.SOURCE_CONTINUED, note=note, now=now
    )
    _audit(
        session,
        admin=admin,
        action="source_review_continued",
        order=locked.order,
        hold=locked.holds[0],
    )
    await session.commit()
    return await get_order_detail(session, reference=reference)


async def resume_unsafe(
    session: AsyncSession,
    *,
    reference: str,
    admin: User,
    hold_id: uuid.UUID,
    note: str,
    now: datetime | None = None,
) -> OrderDetail:
    """Resume a job after an unsafe stop, with a safe alternative (R3, SRS §8). Commits.

    ``note`` is the safe alternative. The job continues from the status it
    stopped at.

    Raises:
        APIError: 404 ``order_not_found``; 409 ``hold_not_open``.
    """
    now = now or datetime.now(UTC)
    locked = await _lock_hold(
        session, reference=reference, hold_id=hold_id, kind=HoldKind.UNSAFE_STOP
    )
    _close(locked.holds, admin=admin, resolution=HoldResolution.UNSAFE_RESUMED, note=note, now=now)
    _audit(
        session,
        admin=admin,
        action="unsafe_stop_resumed",
        order=locked.order,
        hold=locked.holds[0],
    )
    await session.commit()
    return await get_order_detail(session, reference=reference)


async def _open_holds_on(session: AsyncSession, assignment_id: uuid.UUID) -> list[OrderException]:
    return list(
        await session.scalars(
            select(OrderException)
            .where(
                OrderException.assignment_id == assignment_id,
                OrderException.hold_kind.is_not(None),
                OrderException.resolved_at.is_(None),
            )
            .with_for_update()
        )
    )


async def withdraw_job(
    session: AsyncSession,
    *,
    reference: str,
    admin: User,
    expected_status: AssignmentStatus,
    note: str | None,
    now: datetime | None = None,
) -> OrderDetail:
    """Take back an offered or accepted job, closing its holds (D5, R3; rows 10, 11). Commits.

    The withdraw itself is
    :func:`app.modules.dispatch.service.withdraw_assignment`. Before
    departure a job can carry an ``unsafe_stop`` hold (R3 offers Withdraw
    then, technical lead 2026-10-21); it is closed with resolution
    ``withdrawn`` in the same transaction.

    Raises:
        APIError: As ``withdraw_assignment``, and 404 ``order_not_found``.
    """
    now = now or datetime.now(UTC)
    order_id = (await orders_service.get_order_for_staff(session, reference=reference)).order.id
    withdrawn = await dispatch_service.withdraw_assignment(
        session,
        order_id=order_id,
        admin=admin,
        expected_status=expected_status,
        note=note,
        commit=False,
    )
    _close(
        await _open_holds_on(session, withdrawn.id),
        admin=admin,
        resolution=HoldResolution.WITHDRAWN,
        note=note,
        now=now,
    )
    await session.commit()
    return await get_order_detail(session, reference=reference)


async def transition_with_holds(
    session: AsyncSession,
    *,
    reference: str,
    admin: User,
    target: OrderStatus,
    expected_status: OrderStatus,
    reason_code: TransitionReason,
    note: str | None,
    hold_id: uuid.UUID | None,
    now: datetime | None = None,
) -> OrderDetail:
    """Fail a delivery (row 20) or cancel an order (row 23). Commits.

    Only these uses of the planned admin transition endpoint are agreed
    (contract, "fail and cancel", and "Cancel because the customer asked").
    The job ends: on failure its assignment is
    ``completed`` and its delivery attempt ``failed``; on cancellation the
    assignment is ``withdrawn`` and the job leaves the driver's list (nothing
    notifies the driver). Every open hold on the job is closed. No charge is
    recorded: the failures here are attributable to MmiriOma (FR-038,
    BR-14), and a cancellation is free in the pilot (FR-044, F5).

    Args:
        session: Database session.
        reference: Public order reference.
        admin: The signed-in administrator.
        target: ``failed`` or ``cancelled``.
        expected_status: The order status the administrator saw.
        reason_code: One this section allows for ``target``.
        note: Optional; required with ``other``.
        hold_id: The hold FAIL or CANCEL was opened from, if any; it must
            still be open.
        now: Current time, for tests.

    Returns:
        The order after the change.

    Raises:
        APIError: 404 ``order_not_found``; 422 ``validation_error`` for a
            target or reason this section does not cover, ``other``
            without a note, or a cancel from ``unloading`` without a note
            (FR-044 administrator review); 409 ``invalid_order_transition`` when the order
            is not ``expected_status`` or cannot make the change; 409
            ``hold_not_open``.
    """
    now = now or datetime.now(UTC)
    allowed = TRANSITION_REASONS.get(target)
    if allowed is None:
        raise _validation_error(["body", "to"], "Use failed or cancelled")
    if reason_code not in allowed:
        choices = ", ".join(sorted(reason.value for reason in allowed))
        raise _validation_error(["body", "reason_code"], f"Give one of: {choices}")
    if target is OrderStatus.CANCELLED and expected_status is OrderStatus.UNLOADING and not note:
        # Unloading has started: FR-044 requires an administrator review, which is this
        # cancel with its reason recorded (#174, decision 3).
        raise _validation_error(["body", "note"], "Say why: unloading has already started")

    order_id = (await orders_service.get_order_for_staff(session, reference=reference)).order.id
    order = await orders_service.lock_order(session, order_id)
    if order.status is not expected_status:
        current = order.status
        await session.rollback()
        raise _invalid_transition(current, target)
    assignment = await _live_assignment(session, order.id, lock=True)
    holds = [] if assignment is None else await _open_holds_on(session, assignment.id)
    if hold_id is not None and not any(hold.id == hold_id for hold in holds):
        await session.rollback()
        raise _hold_not_open()
    try:
        await orders_service.transition_order(
            session,
            order_id=order.id,
            target=target,
            actor=admin,
            reason_code=reason_code,
            note=note,
            commit=False,
        )
    except APIError:
        await session.rollback()
        raise
    if assignment is not None:
        assignment.ended_at = now
        if target is OrderStatus.FAILED:
            assignment.status = AssignmentStatus.COMPLETED
            attempt = await session.scalar(
                select(DeliveryAttempt).where(DeliveryAttempt.assignment_id == assignment.id)
            )
            if attempt is not None and attempt.outcome is None:
                attempt.outcome = DeliveryOutcome.FAILED
        else:
            assignment.status = AssignmentStatus.WITHDRAWN
            # The driver loses a job they held (docs/api/partners.md, "reassigned").
            dispatch_service.notify_job_taken_back(
                session, driver_id=assignment.driver_user_id, order=order, cancelled=True
            )
    _close(
        holds,
        admin=admin,
        resolution=(
            HoldResolution.FAILED if target is OrderStatus.FAILED else HoldResolution.CANCELLED
        ),
        note=note,
        now=now,
    )
    await session.commit()
    return await get_order_detail(session, reference=reference)


@dataclass(frozen=True)
class CancellationOutcome:
    """What cancelling would cost the customer (FR-044), for the CANCEL dialog."""

    reason_code: TransitionReason
    customer_charge_minor_units: int
    message: str


async def cancellation_outcome(
    session: AsyncSession, *, reference: str, reason_code: TransitionReason
) -> CancellationOutcome:
    """The customer's charge if the order were cancelled with ``reason_code``.

    ``mmirioma_unable`` (MmiriOma could not fulfil the order) and
    ``customer_request`` (the customer asked, #174) are supported. The pilot has
    no cancellation charge (F5), so the customer is never charged, for either
    (FR-044 applies once charges exist). The charge is integer kobo (SRS §5).

    Raises:
        APIError: 404 ``order_not_found``; 422 ``validation_error`` for any
            other reason (``other`` included); 409 ``invalid_order_transition`` when an
            administrator cannot cancel the order now (row 23).
    """
    order = (await orders_service.get_order_for_staff(session, reference=reference)).order
    if reason_code not in TRANSITION_REASONS[OrderStatus.CANCELLED]:
        raise _validation_error(
            ["query", "reason_code"], "Only mmirioma_unable and customer_request are supported"
        )
    check_transition(
        source=order.status,
        target=OrderStatus.CANCELLED,
        actor=Actor.ADMIN,
        reason_code=reason_code,
    )
    return CancellationOutcome(
        reason_code=reason_code, customer_charge_minor_units=0, message=NO_CHARGE_MESSAGE
    )


# --- History (include=holds, decision 8) -------------------------------------------


async def order_history(
    session: AsyncSession, *, reference: str, include_holds: bool
) -> list[HistoryItem]:
    """The staff history, with hold entries only on request (H1, HISTORY).

    Without ``include_holds`` this is exactly the dispatch history. With it,
    one ``hold_opened`` entry per exception that opened a hold, and one
    ``hold_decided`` entry per decision (``proof_approved``,
    ``proof_rejected``, ``source_continued``, ``unsafe_resumed``). Holds
    closed by a failure, cancellation or withdraw have no decided entry: the
    status change shows them. Newest first.

    Raises:
        APIError: 404 ``order_not_found``.
    """
    entries: list[HistoryItem] = list(
        await dispatch_service.order_history(session, reference=reference)
    )
    if not include_holds:
        return entries
    order = (await orders_service.get_order_for_staff(session, reference=reference)).order
    exceptions = list(
        await session.scalars(
            select(OrderException)
            .where(OrderException.order_id == order.id, OrderException.hold_kind.is_not(None))
            .order_by(OrderException.created_at, OrderException.id)
        )
    )
    if not exceptions:
        return entries
    # The driver's own words for a proof review are on the proof written in
    # the same transaction (same database time), not on the exception.
    proof_notes = {
        proof.created_at: proof.alternative_note
        for proof in await session.scalars(
            select(DeliveryProof).where(
                DeliveryProof.order_id == order.id,
                DeliveryProof.method == AcknowledgementMethod.ALTERNATIVE_PROOF,
            )
        )
    }
    user_ids = {e.reported_by for e in exceptions if e.reported_by} | {
        e.resolved_by for e in exceptions if e.resolved_by
    }
    users = await auth_service.get_users_by_ids(session, user_ids)

    holds: list[HoldEntry] = []
    decided: dict[tuple[object, ...], OrderException] = {}
    for exception in exceptions:
        if exception.hold_kind is None:  # excluded by the query; narrows the type
            continue
        holds.append(
            HoldEntry(
                kind=HistoryKind.HOLD_OPENED,
                hold_id=exception.id,
                hold_kind=exception.hold_kind,
                category=exception.category,
                decision=None,
                actor=users.get(exception.reported_by) if exception.reported_by else None,
                note=(
                    proof_notes.get(exception.created_at)
                    if exception.hold_kind is HoldKind.PROOF_REVIEW
                    else exception.note
                ),
                created_at=exception.created_at,
            )
        )
        if exception.resolution in HOLD_DECISIONS and exception.resolved_at is not None:
            # Exceptions closed by one decision form one entry, under the oldest.
            key = (
                exception.hold_kind,
                exception.resolution,
                exception.resolved_at,
                exception.resolved_by,
            )
            decided.setdefault(key, exception)
    for exception in decided.values():
        if exception.hold_kind is None or exception.resolved_at is None:
            continue
        holds.append(
            HoldEntry(
                kind=HistoryKind.HOLD_DECIDED,
                hold_id=exception.id,
                hold_kind=exception.hold_kind,
                category=exception.category,
                decision=exception.resolution,
                actor=users.get(exception.resolved_by) if exception.resolved_by else None,
                note=exception.resolution_note,
                created_at=exception.resolved_at,
            )
        )

    def created_at(item: HistoryItem) -> datetime:
        return item.created_at if isinstance(item, HoldEntry) else item.event.created_at

    # Stable sort, newest first; status changes keep their order among ties.
    return sorted([*entries, *holds], key=created_at, reverse=True)


async def count_open_holds(session: AsyncSession) -> int:
    """Count the jobs with an open hold waiting for an administrator (dashboard ``holds_open``).

    FR-032 asks for driver rejections and timeouts "through dashboard state";
    holds are the reviews staff must act on (admin-operations.md). One job
    with two open holds (a pickup at another source with a safety concern)
    counts once. A "now" value: the same for real and simulated numbers.

    Args:
        session: Database session.

    Returns:
        The count.
    """
    count = await session.scalar(
        select(func.count(OrderException.assignment_id.distinct()))
        .join(Assignment, Assignment.id == OrderException.assignment_id)
        .where(*_open_hold_filter())
    )
    return count or 0
