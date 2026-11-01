"""Driver assignment: offer, accept, decline and withdraw (FR-031, FR-032; S1-07).

Rules (docs/api/deliveries.md rows 8-11, "Assignment statuses"):

- **Assign (row 8).** A dispatcher offers a ``confirmed`` order to one
  driver. The driver must be eligible (FR-031): a ``driver`` account that is
  active (FR-002), approved (docs/api/partners.md, "Approval status"), with
  a driver profile and a verified vehicle, marked available, using an active
  vehicle whose verified safe payload covers the order's quantity in one
  trip (FR-013; multi-trip plans are not modelled yet), and with no other
  live job. The order becomes ``assigned`` and the assignment ``offered``.
  The driver has **not** accepted yet, and nothing may say so (FR-032).
- **Partner notifications.** An offer, a withdraw and a cancellation of a
  job the driver held each leave the driver an in-app message
  (``assigned``, ``reassigned``; docs/api/partners.md, "Notifications"),
  written in the same transaction as the change.
- **Accept (row 9)** and **decline (row 10)** are for the offered driver
  only; anyone else gets 404 ``order_not_found`` (T-07). Accepting makes
  the order ``accepted``; declining returns it to ``confirmed`` with reason
  ``driver_declined`` so the dispatcher sees it again (SRS §8).
- **Withdraw (rows 10, 11).** A dispatcher takes back an offered or accepted
  job (reason ``reassigned``); the order returns to ``confirmed``. The
  dispatcher names the assignment status they saw (``expected_status``), so
  withdrawing an offer cannot take back a job the driver accepted a moment
  earlier (admin dispatch decision 1). There is no automatic offer expiry
  yet (technical lead, 2026-10-19): the dispatcher withdraws an unanswered
  offer by hand.
- **Atomic and race-free.** Each operation locks the order row first, then
  the driver's profile, and saves the assignment and the order transition
  in one transaction. Partial unique indexes (one live assignment per order
  and per driver) are the last line of defence if two requests still race.
- **Repeats are harmless.** Offering the same order to the same driver
  again, or accepting twice, returns the existing assignment.
- **History.** The events of rows 8-11 carry the assignment's id
  (``order_events.assignment_id``), so the staff history can name the
  driver and the decline reason (docs/api/deliveries.md, "Admin dispatch
  endpoints").

Status changes go through ``orders.service.transition_order`` (one state
machine, one audit trail), never by writing the orders table here.
"""

import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from http import HTTPStatus

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.dispatch.models import (
    LIVE_ASSIGNMENT_STATUSES,
    ApprovalStatus,
    Assignment,
    AssignmentStatus,
    DeclineReason,
    DeliveryType,
    DriverProfile,
    DriverServiceZone,
    VehicleProfile,
)
from app.modules.notifications import admin_messages
from app.modules.notifications import service as notifications_service
from app.modules.orders import service as orders_service
from app.modules.orders.models import Order, OrderEvent, OrderStatus, TransitionReason
from app.modules.orders.service import StaffOrder
from app.modules.orders.transitions import Requirement

_ENDED_WITH_DRIVER = (OrderStatus.DELIVERED, OrderStatus.FAILED, OrderStatus.CANCELLED)
"""Order statuses whose driver the admin list names from the ``completed`` assignment.

A failed delivery the dispatcher then cancels keeps its ``completed`` assignment, and
the order panel names that driver, so the list must too (#243, #275). ``disputed`` is
left out on purpose: the agreed amendment gives it ``null`` (docs/api/deliveries.md).
"""


class Ineligibility(StrEnum):
    """Why a driver cannot take an order (``details.reasons`` of ``driver_not_eligible``)."""

    NOT_A_DRIVER = "not_a_driver"
    INACTIVE = "inactive"
    NOT_APPROVED = "not_approved"
    NO_DRIVER_PROFILE = "no_driver_profile"
    UNAVAILABLE = "unavailable"
    VEHICLE_INACTIVE = "vehicle_inactive"
    OVER_PAYLOAD = "over_payload"
    BUSY = "busy"


#: Partner notification kinds written here (docs/api/partners.md, "Notifications").
NOTIFICATION_ASSIGNED = "assigned"
NOTIFICATION_REASSIGNED = "reassigned"


def notify_job_taken_back(
    session: AsyncSession, *, driver_id: uuid.UUID, order: Order, cancelled: bool
) -> None:
    """Tell a driver an admin withdrew or cancelled a job they held. Does not commit.

    Kind ``reassigned`` covers both (partners.md: "Admin withdraws or cancels
    a job the partner held"). Called from the withdraw here and from the
    cancellation in :mod:`app.modules.deliveries.holds`.

    Args:
        session: The session the withdraw or cancellation is written in.
        driver_id: The driver who held the job.
        order: The order.
        cancelled: True for a cancellation, False for a withdraw.
    """
    if cancelled:
        title, body = "Order cancelled", f"Admin cancelled {order.reference}."
    else:
        title, body = "Order taken back", f"Admin took {order.reference} back from you."
    notifications_service.add(
        session,
        user_id=driver_id,
        order_id=order.id,
        kind=NOTIFICATION_REASSIGNED,
        title=title,
        body=body,
    )


def eligibility_problems(
    *,
    driver: User,
    profile: DriverProfile | None,
    vehicle: VehicleProfile | None,
    order_litres: int,
    has_live_job: bool,
) -> list[Ineligibility]:
    """List every reason a driver cannot take an order (FR-031). Empty means eligible.

    All reasons are reported at once so the dispatcher sees the whole picture.

    Args:
        driver: The account offered the job.
        profile: Its driver profile, if any.
        vehicle: The profile's vehicle, if any.
        order_litres: The order's quantity.
        has_live_job: Whether the driver already holds an offered or
            accepted job.

    Returns:
        The problems, in a fixed order.
    """
    problems: list[Ineligibility] = []
    if driver.role is not UserRole.DRIVER:
        return [Ineligibility.NOT_A_DRIVER]
    if not driver.is_active:
        problems.append(Ineligibility.INACTIVE)
    if profile is not None and profile.approval_status is not ApprovalStatus.APPROVED:
        # A pending or suspended partner is never offered a job (partners.md).
        problems.append(Ineligibility.NOT_APPROVED)
    if profile is None or vehicle is None:
        # No verified vehicle yet, e.g. a partner awaiting approval
        # (partners.md, decision 8): deliveries.md's "no vehicle recorded".
        problems.append(Ineligibility.NO_DRIVER_PROFILE)
    if profile is not None:
        if not profile.is_available:
            problems.append(Ineligibility.UNAVAILABLE)
        if vehicle is not None and not vehicle.is_active:
            problems.append(Ineligibility.VEHICLE_INACTIVE)
        if vehicle is not None and order_litres > vehicle.safe_payload_litres:
            # BR-03: never allocate more than the verified payload.
            problems.append(Ineligibility.OVER_PAYLOAD)
    if has_live_job:
        problems.append(Ineligibility.BUSY)
    return problems


def _not_eligible(problems: Sequence[Ineligibility]) -> APIError:
    return APIError(
        HTTPStatus.CONFLICT,
        "driver_not_eligible",
        "This driver cannot take this order.",
        details={"reasons": [problem.value for problem in problems]},
    )


def _order_not_found() -> APIError:
    return APIError(HTTPStatus.NOT_FOUND, "order_not_found", "Order not found")


async def _live_assignment(session: AsyncSession, order_id: uuid.UUID) -> Assignment | None:
    return await session.scalar(
        select(Assignment)
        .where(Assignment.order_id == order_id, Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES))
        .with_for_update()
    )


async def _driver_has_live_job(session: AsyncSession, driver_user_id: uuid.UUID) -> bool:
    found = await session.scalar(
        select(Assignment.id).where(
            Assignment.driver_user_id == driver_user_id,
            Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES),
        )
    )
    return found is not None


async def live_assignment_of_driver(
    session: AsyncSession, driver_user_id: uuid.UUID
) -> Assignment | None:
    """Return the driver's live assignment (``offered`` or ``accepted``), if any.

    A driver holds at most one live job (the unique live-driver index), so
    this is one row or none. Used by the admin driver directory, which takes
    an offered job back when it suspends or deactivates a partner.

    Args:
        session: Database session.
        driver_user_id: The driver's account id.

    Returns:
        The live assignment, or None.
    """
    return await session.scalar(
        select(Assignment).where(
            Assignment.driver_user_id == driver_user_id,
            Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES),
        )
    )


async def listed_drivers_by_order(
    session: AsyncSession, order_statuses: Mapping[uuid.UUID, OrderStatus]
) -> dict[uuid.UUID, User]:
    """Return the driver the admin order list names for each order, keyed by order id.

    Used by the admin order list (#204, #243), which names the driver in its
    Rider column (docs/api/deliveries.md, "Amendment (#243)"). The rule, by the
    order's status:

    * An order with a live assignment (``offered`` or ``accepted``) names that
      driver, the same rule as the detail's "Assigned to" line.
    * ``delivered``, ``failed`` and ``cancelled`` name the driver of the
      order's ``completed`` assignment. A cancelled order has one when the job
      finished (a failed delivery) before the cancellation (#275).
    * ``cancelled`` also names the driver of its ``withdrawn`` assignment only if
      that driver had accepted it (``responded_at`` set, no ``decline_reason``):
      a driver who never accepted never held the job, and the SRS has no rule
      for who "held" a cancelled job (FR-036), so an unanswered offer names
      nobody.
    * Every other order, including one back in the pool after a decline or a
      withdrawal, has no entry.

    One query reads the assignments of every order on the page and one reads
    the drivers' accounts, however many orders there are.

    Args:
        session: Database session; the caller enforces the admin role.
        order_statuses: The status of each order on the page, keyed by order id.

    Returns:
        The driver's account for each order that names one; orders without
        one are absent. Only the order's most recent assignment counts (the
        same one the detail reads), so an earlier driver who accepted is not
        named when a later offer was never answered.
    """
    if not order_statuses:
        return {}
    rows = (
        await session.execute(
            select(
                Assignment.order_id,
                Assignment.driver_user_id,
                Assignment.status,
                Assignment.responded_at,
                Assignment.decline_reason,
            )
            .where(Assignment.order_id.in_(order_statuses))
            .order_by(Assignment.created_at, Assignment.id)
        )
    ).all()
    # Only an order's most recent assignment counts, as in the detail
    # (`_latest_assignment`), so the list and the panel name the same driver.
    latest = {row.order_id: row for row in rows}
    named: dict[uuid.UUID, uuid.UUID] = {}
    for order_id, row in latest.items():
        order_status = order_statuses[order_id]
        if row.status in LIVE_ASSIGNMENT_STATUSES:
            named[order_id] = row.driver_user_id
        elif row.status is AssignmentStatus.COMPLETED and order_status in _ENDED_WITH_DRIVER:
            named[order_id] = row.driver_user_id
        elif (
            row.status is AssignmentStatus.WITHDRAWN
            and order_status is OrderStatus.CANCELLED
            and row.responded_at is not None
            and row.decline_reason is None
        ):
            named[order_id] = row.driver_user_id
    drivers = await auth_service.get_users_by_ids(session, set(named.values()))
    return {order_id: drivers[driver_id] for order_id, driver_id in named.items()}


@dataclass(frozen=True)
class DriverJobCounts:
    """A driver's job counts for the admin driver directory.

    Attributes:
        live: Assignments in status ``offered`` or ``accepted``.
        completed: Assignments in status ``completed``. A job also ends
            ``completed`` when its order fails or is cancelled
            (deliveries.md, ``job_status``), so this is not a delivery count.
        delivered: ``completed`` assignments whose order is ``delivered``: the
            design's "trips" (admin-directory.md, ``delivered_jobs``, #275).
    """

    live: int
    completed: int
    delivered: int


async def job_counts_by_driver(
    session: AsyncSession, driver_user_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, DriverJobCounts]:
    """Count each driver's live, completed and delivered assignments.

    Args:
        session: Database session.
        driver_user_ids: The drivers' account ids.

    Returns:
        The counts per driver; a driver with no assignment is absent.
    """
    if not driver_user_ids:
        return {}
    live = func.count().filter(Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES))
    completed = func.count().filter(Assignment.status == AssignmentStatus.COMPLETED)
    # A failed or cancelled order also ends its job `completed`; only a
    # delivered order is a trip (#275).
    delivered = func.count().filter(
        Assignment.status == AssignmentStatus.COMPLETED, Order.status == OrderStatus.DELIVERED
    )
    rows = await session.execute(
        select(Assignment.driver_user_id, live, completed, delivered)
        .join(Order, Order.id == Assignment.order_id)
        .where(Assignment.driver_user_id.in_(set(driver_user_ids)))
        .group_by(Assignment.driver_user_id)
    )
    return {driver_id: DriverJobCounts(live, done, trips) for driver_id, live, done, trips in rows}


async def assign_driver(
    session: AsyncSession, *, order_id: uuid.UUID, driver_user_id: uuid.UUID, admin: User
) -> Assignment:
    """Offer a confirmed order to an eligible driver (row 8). Commits.

    See :func:`_assign_driver`, which also says whether the offer is new.
    """
    assignment, _created = await _assign_driver(
        session, order_id=order_id, driver_user_id=driver_user_id, admin=admin
    )
    return assignment


async def _assign_driver(
    session: AsyncSession, *, order_id: uuid.UUID, driver_user_id: uuid.UUID, admin: User
) -> tuple[Assignment, bool]:
    """Offer a confirmed order to an eligible driver (row 8). Commits.

    Args:
        session: Database session; committed or rolled back here.
        order_id: The order.
        driver_user_id: The driver's account.
        admin: The dispatcher making the offer.

    Returns:
        The ``offered`` assignment, and whether it is new (False for a
        repeat, which returns the existing one).

    Raises:
        APIError: 404 ``order_not_found`` or ``driver_not_found``;
            409 ``invalid_order_transition`` (order not ``confirmed``);
            409 ``driver_not_eligible`` with ``details.reasons``;
            403 ``forbidden`` if ``admin`` is not an admin.
    """
    order = await orders_service.lock_order(session, order_id)
    live = await _live_assignment(session, order.id)
    if (
        live is not None
        and live.driver_user_id == driver_user_id
        and live.status is AssignmentStatus.OFFERED
    ):
        await session.commit()
        return live, False  # the same offer again: nothing to do
    if live is not None:
        # Held by another driver (or already accepted): the dispatcher must
        # withdraw it first. Same answer as the state machine gives. Read the
        # status before rolling back: rollback expires loaded objects, and an
        # async session cannot lazy-load them again (LOG.md, 2026-10-19).
        current = order.status
        await session.rollback()
        raise APIError(
            HTTPStatus.CONFLICT,
            "invalid_order_transition",
            f"This order cannot move from {current} to {OrderStatus.ASSIGNED}.",
            details={"from": current.value, "to": OrderStatus.ASSIGNED.value},
        )

    driver = (await auth_service.get_users_by_ids(session, {driver_user_id})).get(driver_user_id)
    if driver is None:
        await session.rollback()
        raise APIError(HTTPStatus.NOT_FOUND, "driver_not_found", "Driver not found")
    # Lock the driver's profile so two offers to the same driver are decided
    # one after the other.
    profile = await session.scalar(
        select(DriverProfile).where(DriverProfile.user_id == driver.id).with_for_update()
    )
    vehicle = (
        await session.get(VehicleProfile, profile.vehicle_profile_id)
        if profile is not None and profile.vehicle_profile_id is not None
        else None
    )
    problems = eligibility_problems(
        driver=driver,
        profile=profile,
        vehicle=vehicle,
        order_litres=order.quantity_litres,
        has_live_job=await _driver_has_live_job(session, driver.id),
    )
    if problems:
        await session.rollback()
        raise _not_eligible(problems)

    try:
        # The assignment is flushed first so the order event can point at it.
        assignment = Assignment(
            order_id=order.id,
            driver_user_id=driver.id,
            status=AssignmentStatus.OFFERED,
            offered_by=admin.id,
        )
        session.add(assignment)
        await session.flush()
        await orders_service.transition_order(
            session,
            order_id=order.id,
            target=OrderStatus.ASSIGNED,
            actor=admin,
            satisfied={Requirement.DRIVER_ELIGIBLE},
            assignment_id=assignment.id,
            commit=False,
        )
        notifications_service.add(
            session,
            user_id=driver.id,
            order_id=order.id,
            kind=NOTIFICATION_ASSIGNED,
            title="Admin assigned you an order",
            body=f"{order.reference} · {order.quantity_litres:,} L",
        )
    except IntegrityError as exc:
        # A concurrent request took the driver or the order first.
        await session.rollback()
        raise _not_eligible([Ineligibility.BUSY]) from exc
    except APIError:
        await session.rollback()
        raise
    await session.commit()
    await session.refresh(assignment)
    return assignment, True


async def _offered_to(session: AsyncSession, order: Order, driver: User) -> Assignment:
    """The live assignment of ``order`` held by ``driver``, or 404 (T-07)."""
    live = await _live_assignment(session, order.id)
    if live is None or live.driver_user_id != driver.id:
        await session.rollback()
        raise _order_not_found()
    return live


async def accept_assignment(
    session: AsyncSession, *, order_id: uuid.UUID, driver: User
) -> Assignment:
    """The offered driver accepts the job (row 9). Commits.

    Args:
        session: Database session; committed or rolled back here.
        order_id: The order.
        driver: The signed-in driver.

    Returns:
        The ``accepted`` assignment (unchanged if already accepted).

    Raises:
        APIError: 404 ``order_not_found`` if the order is not offered to
            this driver; 409 ``invalid_order_transition``.
    """
    order = await orders_service.lock_order(session, order_id)
    live = await _offered_to(session, order, driver)
    if live.status is AssignmentStatus.ACCEPTED:
        await session.commit()
        return live
    try:
        await orders_service.transition_order(
            session,
            order_id=order.id,
            target=OrderStatus.ACCEPTED,
            actor=driver,
            assigned_driver_id=live.driver_user_id,
            assignment_id=live.id,
            commit=False,
        )
    except APIError:
        await session.rollback()
        raise
    live.status = AssignmentStatus.ACCEPTED
    live.responded_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(live)
    return live


async def decline_assignment(
    session: AsyncSession,
    *,
    order_id: uuid.UUID,
    driver: User,
    note: str | None = None,
    reason: DeclineReason | None = None,
) -> Assignment:
    """The offered driver declines (row 10); the order returns to ``confirmed``. Commits.

    The driver app sends one of the design's decline reasons (J2-b). The
    reason and the driver's note are stored on the assignment; the event's
    note is the driver's note only, and the staff history reads the reason
    from the assignment (admin dispatch decision 3). Events written before
    that decision have the note ``<reason>`` or ``<reason>: <note>``.

    Args:
        session: Database session; committed or rolled back here.
        order_id: The order.
        driver: The signed-in driver.
        note: Optional reason in the driver's words.
        reason: Optional :class:`DeclineReason`.

    Returns:
        The ``declined`` assignment.

    Raises:
        APIError: 404 ``order_not_found``; 403 ``forbidden`` if the job is
            already accepted (only the dispatcher can take it back, row 11;
            the state machine refuses the driver as actor).
    """
    order = await orders_service.lock_order(session, order_id)
    live = await _offered_to(session, order, driver)
    try:
        await orders_service.transition_order(
            session,
            order_id=order.id,
            target=OrderStatus.CONFIRMED,
            actor=driver,
            reason_code=TransitionReason.DRIVER_DECLINED,
            note=note,
            assigned_driver_id=live.driver_user_id,
            assignment_id=live.id,
            commit=False,
        )
    except APIError:
        await session.rollback()
        raise
    now = datetime.now(UTC)
    live.status = AssignmentStatus.DECLINED
    live.responded_at = now
    live.ended_at = now
    live.decline_reason = reason
    live.decline_note = note
    # FR-032: admins are told in the same transaction (admin-operations.md).
    await admin_messages.driver_declined(session, order_id=order.id, reference=order.reference)
    await session.commit()
    await session.refresh(live)
    return live


async def withdraw_assignment(
    session: AsyncSession,
    *,
    order_id: uuid.UUID,
    admin: User,
    expected_status: AssignmentStatus,
    note: str | None = None,
    commit: bool = True,
) -> Assignment:
    """The dispatcher takes back an offered or accepted job (rows 10, 11).

    ``expected_status`` is the assignment status the dispatcher saw:
    ``offered`` from "Withdraw offer", ``accepted`` from "Withdraw job".
    Both rows allow a withdraw, so without it a withdraw of an offer sent
    just after the driver accepted would silently take back the accepted job
    (admin dispatch decision 1). A mismatch changes nothing.

    Args:
        session: Database session; committed or rolled back here.
        order_id: The order.
        admin: The dispatcher.
        expected_status: ``offered`` or ``accepted``.
        note: Optional explanation, saved as the event's note.
        commit: Commit here (default). Pass False to write more rows in the
            same transaction (the hold review closes the job's open hold,
            #93) and commit them together; on an error this function still
            rolls back.

    Returns:
        The ``withdrawn`` assignment.

    Raises:
        APIError: 404 ``assignment_not_found`` if the order has no live
            assignment; 409 ``invalid_order_transition`` if the live
            assignment is not ``expected_status``, or the driver has already
            departed (use the failure or cancellation steps).
    """
    order = await orders_service.lock_order(session, order_id)
    live = await _live_assignment(session, order.id)
    if live is None:
        await session.rollback()
        raise APIError(
            HTTPStatus.NOT_FOUND, "assignment_not_found", "This order has no driver assigned"
        )
    if live.status is not expected_status:
        # The driver answered while the dispatcher's dialog was open. Read
        # the status before rolling back (LOG.md, 2026-10-19).
        current = order.status
        await session.rollback()
        raise APIError(
            HTTPStatus.CONFLICT,
            "invalid_order_transition",
            f"This order cannot move from {current} to {OrderStatus.CONFIRMED}.",
            details={"from": current.value, "to": OrderStatus.CONFIRMED.value},
        )
    try:
        await orders_service.transition_order(
            session,
            order_id=order.id,
            target=OrderStatus.CONFIRMED,
            actor=admin,
            reason_code=TransitionReason.REASSIGNED,
            note=note,
            assignment_id=live.id,
            commit=False,
        )
    except APIError:
        await session.rollback()
        raise
    live.status = AssignmentStatus.WITHDRAWN
    live.ended_at = datetime.now(UTC)
    notify_job_taken_back(session, driver_id=live.driver_user_id, order=order, cancelled=False)
    if not commit:
        await session.flush()
        return live
    await session.commit()
    await session.refresh(live)
    return live


# --- Admin dispatch views (docs/api/deliveries.md, "Admin dispatch endpoints") ---


@dataclass(frozen=True)
class AssignmentView:
    """An assignment with the accounts and vehicle the dispatcher sees.

    Attributes:
        assignment: The assignment row.
        driver: The driver's account.
        vehicle: The driver's **current** vehicle, or None if the driver has
            no profile. Not a snapshot taken at the offer.
        offered_by: The dispatcher who made the offer.
    """

    assignment: Assignment
    driver: User
    vehicle: VehicleProfile | None
    offered_by: User


@dataclass(frozen=True)
class DispatchOrder:
    """An order for the admin detail page with its most recent assignment.

    Attributes:
        staff_order: The order and its customer.
        assignment: The order's most recent assignment, live or ended, or
            None if it was never offered (D2-D4 and the D3 decline banner).
    """

    staff_order: StaffOrder
    assignment: AssignmentView | None


@dataclass(frozen=True)
class DriverChoice:
    """One row of the Assign driver list (D1).

    Attributes:
        driver: The driver's account.
        vehicle: Their vehicle, or None without a driver profile.
        reasons: Why they cannot take this order now; empty means they can.
    """

    driver: User
    vehicle: VehicleProfile | None
    reasons: list[Ineligibility]


@dataclass(frozen=True)
class HistoryEntry:
    """One order event as the staff history shows it (H1).

    Attributes:
        event: The event row.
        actor: Who made the change, or None for the system.
        assignment: The assignment the event is about (rows 8-11), if linked.
        assignment_driver: That assignment's driver.
        decline_reason: The driver's decline reason, only on a decline event.
    """

    event: OrderEvent
    actor: User | None
    assignment: Assignment | None
    assignment_driver: User | None
    decline_reason: DeclineReason | None


async def _vehicles_by_driver(
    session: AsyncSession, driver_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, VehicleProfile]:
    """Map each driver who has a profile to their current vehicle."""
    if not driver_ids:
        return {}
    rows = await session.execute(
        select(DriverProfile.user_id, VehicleProfile)
        .join(VehicleProfile, VehicleProfile.id == DriverProfile.vehicle_profile_id)
        .where(DriverProfile.user_id.in_(set(driver_ids)))
    )
    return {user_id: vehicle for user_id, vehicle in rows}


async def vehicles_by_driver(
    session: AsyncSession, driver_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, VehicleProfile]:
    """Map each driver (``users.id``) who has a profile to their current vehicle.

    For other modules (the cash page names each driver's vehicle) so they
    need not read this module's tables.
    """
    return await _vehicles_by_driver(session, driver_ids)


async def _latest_assignment(session: AsyncSession, order_id: uuid.UUID) -> AssignmentView | None:
    """The order's most recent assignment with its people and vehicle."""
    assignment = await session.scalar(
        select(Assignment)
        .where(Assignment.order_id == order_id)
        .order_by(Assignment.created_at.desc(), Assignment.id.desc())
        .limit(1)
    )
    if assignment is None:
        return None
    users = await auth_service.get_users_by_ids(
        session, {assignment.driver_user_id, assignment.offered_by}
    )
    vehicles = await _vehicles_by_driver(session, {assignment.driver_user_id})
    return AssignmentView(
        assignment=assignment,
        driver=users[assignment.driver_user_id],
        vehicle=vehicles.get(assignment.driver_user_id),
        offered_by=users[assignment.offered_by],
    )


async def get_dispatch_order(session: AsyncSession, *, reference: str) -> DispatchOrder:
    """Return an order for the admin detail page (``AdminOrderDetail``).

    The order is read with a fresh query, so status and ``updated_at`` are
    current after an assign or withdraw in the same session.

    Args:
        session: Database session; the caller enforces the admin role.
        reference: Public order reference.

    Returns:
        The order, its customer and its most recent assignment.

    Raises:
        APIError: 404 ``order_not_found``.
    """
    staff_order = await orders_service.get_order_for_staff(session, reference=reference)
    return DispatchOrder(
        staff_order=staff_order,
        assignment=await _latest_assignment(session, staff_order.order.id),
    )


async def list_drivers_for_order(session: AsyncSession, *, reference: str) -> list[DriverChoice]:
    """Every driver account with its eligibility for this order now (D1, FR-031).

    Drivers who can take the order come first, then the rest; each group by
    name. Inactive accounts and drivers without a profile are listed too,
    with their reasons, so the dispatcher sees why. ``not_a_driver`` never
    appears: only ``driver`` accounts are listed. The list is a snapshot;
    :func:`assign_driver` checks again.

    Args:
        session: Database session; the caller enforces the admin role.
        reference: Public order reference.

    Returns:
        The rows; empty when no driver account exists ("No drivers set up yet").

    Raises:
        APIError: 404 ``order_not_found``.
    """
    order = (await orders_service.get_order_for_staff(session, reference=reference)).order
    drivers = await auth_service.list_users_by_role(session, UserRole.DRIVER)
    driver_ids = {driver.id for driver in drivers}
    if not driver_ids:
        return []
    profiles = {
        profile.user_id: profile
        for profile in await session.scalars(
            select(DriverProfile).where(DriverProfile.user_id.in_(driver_ids))
        )
    }
    vehicles = await _vehicles_by_driver(session, driver_ids)
    busy = set(
        await session.scalars(
            select(Assignment.driver_user_id).where(
                Assignment.driver_user_id.in_(driver_ids),
                Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES),
            )
        )
    )
    choices = [
        DriverChoice(
            driver=driver,
            vehicle=vehicles.get(driver.id),
            reasons=eligibility_problems(
                driver=driver,
                profile=profiles.get(driver.id),
                vehicle=vehicles.get(driver.id),
                order_litres=order.quantity_litres,
                has_live_job=driver.id in busy,
            ),
        )
        for driver in drivers
    ]
    # Stable sort: eligible first, keeping the name order from the query.
    return sorted(choices, key=lambda choice: bool(choice.reasons))


async def offer_order(
    session: AsyncSession, *, reference: str, driver_user_id: uuid.UUID, admin: User
) -> tuple[DispatchOrder, bool]:
    """Offer an order, named by reference, to a driver (D1, row 8). Commits.

    Args:
        session: Database session.
        reference: Public order reference.
        driver_user_id: The driver's account.
        admin: The dispatcher.

    Returns:
        The order as after the offer, and whether the offer is new (False
        when the same driver was already offered it).

    Raises:
        APIError: As :func:`assign_driver`.
    """
    order_id = (await orders_service.get_order_for_staff(session, reference=reference)).order.id
    _assignment, created = await _assign_driver(
        session, order_id=order_id, driver_user_id=driver_user_id, admin=admin
    )
    return await get_dispatch_order(session, reference=reference), created


async def order_history(session: AsyncSession, *, reference: str) -> list[HistoryEntry]:
    """Every event of an order, newest first, with names (H1, NFR-004).

    Names are the accounts' names when read. The decline reason is taken
    from the assignment, and only on the decline event itself (admin
    dispatch decision 3).

    Args:
        session: Database session; the caller enforces the admin role.
        reference: Public order reference.

    Returns:
        The entries, newest first; never empty for a stored order.

    Raises:
        APIError: 404 ``order_not_found``.
    """
    order = (await orders_service.get_order_for_staff(session, reference=reference)).order
    events = await orders_service.list_order_events(session, order.id)
    assignment_ids = {event.assignment_id for event in events if event.assignment_id is not None}
    assignments = (
        {
            assignment.id: assignment
            for assignment in await session.scalars(
                select(Assignment).where(Assignment.id.in_(assignment_ids))
            )
        }
        if assignment_ids
        else {}
    )
    user_ids = {event.actor_id for event in events if event.actor_id is not None}
    user_ids |= {assignment.driver_user_id for assignment in assignments.values()}
    users = await auth_service.get_users_by_ids(session, user_ids)
    entries: list[HistoryEntry] = []
    for event in events:
        assignment = assignments.get(event.assignment_id) if event.assignment_id else None
        declined = event.reason_code is TransitionReason.DRIVER_DECLINED
        entries.append(
            HistoryEntry(
                event=event,
                # Foreign keys are RESTRICT, so a recorded actor always exists.
                actor=None if event.actor_id is None else users[event.actor_id],
                assignment=assignment,
                assignment_driver=None if assignment is None else users[assignment.driver_user_id],
                decline_reason=assignment.decline_reason if assignment and declined else None,
            )
        )
    return entries


# --- Vehicle and driver profiles (command-line tool) -------------------------


async def create_vehicle_profile(
    session: AsyncSession, *, vehicle_type: str, safe_payload_litres: int
) -> VehicleProfile:
    """Add a vehicle profile (FR-013). Commits.

    Args:
        session: Database session.
        vehicle_type: Short description, 1-50 characters (validated by the caller).
        safe_payload_litres: Verified safe payload per trip, 1-100000.

    Returns:
        The new, active profile.
    """
    vehicle = VehicleProfile(vehicle_type=vehicle_type, safe_payload_litres=safe_payload_litres)
    session.add(vehicle)
    await session.commit()
    await session.refresh(vehicle)
    return vehicle


async def list_vehicle_profiles(session: AsyncSession) -> list[VehicleProfile]:
    """Return every vehicle profile, oldest first."""
    return list(await session.scalars(select(VehicleProfile).order_by(VehicleProfile.created_at)))


async def set_driver_vehicle(
    session: AsyncSession,
    *,
    phone: str,
    vehicle_profile_id: uuid.UUID,
    delivery_type: DeliveryType | None = None,
    plate: str | None = None,
    declared_capacity_gallons: int | None = None,
    zone_id: uuid.UUID | None = None,
) -> DriverProfile:
    """Create or update a driver's profile with their vehicle. Commits.

    The technical lead checks the driver and vehicle before running the
    command, so a profile created here starts ``approved`` (partners.md:
    drivers from the command-line tool keep working as before). It does not
    change the approval status of an existing profile.

    Args:
        session: Database session.
        phone: The driver's normalized phone.
        vehicle_profile_id: An active vehicle profile.
        delivery_type: Keke or tanker, if given (partners.md, the partner's
            ``vehicle.delivery_type``).
        plate: The plate, if given, already normalized
            (:func:`app.modules.dispatch.plates.normalize_plate`).
        declared_capacity_gallons: Tanker capacity the driver declared, if
            given (500-20,000, checked by the database). A claim only:
            dispatch reads the vehicle's verified payload (BR-03).
        zone_id: A service zone the driver works in, if given; added to
            ``driver_service_zones`` unless already there. The caller checks
            the zone exists.

    Returns:
        The driver profile.

    Raises:
        LookupError: Unknown phone or vehicle, the account is not a driver,
            or the vehicle is inactive. Only the command-line tool calls this.
    """
    user = await auth_service.get_user_by_phone(session, phone)
    if user is None or user.role is not UserRole.DRIVER:
        raise LookupError("No driver account with this phone number")
    vehicle = await session.get(VehicleProfile, vehicle_profile_id)
    if vehicle is None or not vehicle.is_active:
        raise LookupError("No active vehicle profile with this ID")
    profile = await session.scalar(select(DriverProfile).where(DriverProfile.user_id == user.id))
    if profile is None:
        profile = DriverProfile(
            user_id=user.id, vehicle_profile_id=vehicle.id, approval_status=ApprovalStatus.APPROVED
        )
        session.add(profile)
    else:
        profile.vehicle_profile_id = vehicle.id
    if delivery_type is not None:
        profile.delivery_type = delivery_type
    if plate is not None:
        profile.plate = plate
    if declared_capacity_gallons is not None:
        profile.declared_capacity_gallons = declared_capacity_gallons
    if zone_id is not None:
        await session.flush()
        linked = await session.scalar(
            select(DriverServiceZone.id).where(
                DriverServiceZone.driver_profile_id == profile.id,
                DriverServiceZone.zone_id == zone_id,
            )
        )
        if linked is None:
            session.add(DriverServiceZone(driver_profile_id=profile.id, zone_id=zone_id))
    await session.commit()
    await session.refresh(profile)
    return profile


async def set_driver_availability(
    session: AsyncSession, *, phone: str, available: bool
) -> DriverProfile:
    """Mark a driver available or unavailable for new work. Commits.

    An unavailable driver keeps any job they already hold; they just get no
    new offers.

    Raises:
        LookupError: No driver profile for this phone.
    """
    user = await auth_service.get_user_by_phone(session, phone)
    profile = (
        None
        if user is None
        else await session.scalar(select(DriverProfile).where(DriverProfile.user_id == user.id))
    )
    if profile is None:
        raise LookupError("No driver profile for this phone number")
    profile.is_available = available
    await session.commit()
    await session.refresh(profile)
    return profile


async def list_driver_profiles(
    session: AsyncSession,
) -> list[tuple[DriverProfile, User, VehicleProfile | None]]:
    """Return every driver profile with its account and vehicle (None until verified)."""
    rows = await session.execute(
        select(DriverProfile, User, VehicleProfile)
        .join(User, User.id == DriverProfile.user_id)
        .outerjoin(VehicleProfile, VehicleProfile.id == DriverProfile.vehicle_profile_id)
        .order_by(User.name)
    )
    # SQLAlchemy 2.1: rows unpack directly; Result.tuples() is deprecated.
    return [(profile, user, vehicle) for profile, user, vehicle in rows]


# --- Admin operations (docs/api/admin-operations.md, #102) ------------------------------

#: Order statuses in which the dispatcher must confirm or assign next (FR-030,
#: FR-031): with no live assignment, the order waits on staff.
WAITING_FOR_STAFF_STATUSES = (
    OrderStatus.QUOTE_REQUESTED,
    OrderStatus.AWAITING_CONFIRMATION,
    OrderStatus.CONFIRMED,
)


async def count_orders_needing_action(session: AsyncSession) -> int:
    """Count the orders the dispatcher must confirm or assign next.

    ``GET /admin/shell`` ``orders_needing_action``: orders in
    ``quote_requested``, ``awaiting_confirmation`` or ``confirmed`` with no
    live (offered or accepted) assignment. Simulated orders are counted:
    staff act on them too.

    Args:
        session: Database session.

    Returns:
        The count.
    """
    live = exists().where(
        Assignment.order_id == Order.id, Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES)
    )
    count = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.status.in_(WAITING_FOR_STAFF_STATUSES), ~live)
    )
    return count or 0


async def accepted_driver(session: AsyncSession, order_id: uuid.UUID) -> User | None:
    """Return the driver of the order's current or last accepted assignment.

    For the support request contacts (admin-operations.md). An assignment
    was accepted if it is ``accepted`` or ``completed``, or ``withdrawn``
    after acceptance (withdrawing keeps the acceptance time in
    ``responded_at``; a withdrawn offer has none). Offers the driver never
    accepted, and declines, do not count.

    Args:
        session: Database session.
        order_id: The order.

    Returns:
        The driver, or None if no assignment was ever accepted.
    """
    was_accepted = or_(
        Assignment.status.in_((AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED)),
        and_(
            Assignment.status == AssignmentStatus.WITHDRAWN,
            Assignment.responded_at.is_not(None),
        ),
    )
    driver_id = await session.scalar(
        select(Assignment.driver_user_id)
        .where(Assignment.order_id == order_id, was_accepted)
        .order_by(Assignment.responded_at.desc(), Assignment.id.desc())
        .limit(1)
    )
    if driver_id is None:
        return None
    return (await auth_service.get_users_by_ids(session, {driver_id})).get(driver_id)


async def oldest_waiting_created_at(session: AsyncSession, *, simulated: bool) -> datetime | None:
    """When the oldest order waiting on staff was created, for the dashboard.

    The same orders as :func:`count_orders_needing_action`, but only simulated
    or only real ones (BR-09), since the dashboard's order numbers never mix
    them.

    Args:
        session: Database session.
        simulated: Simulated orders only (True) or real ones only (False).

    Returns:
        The oldest ``created_at``, or None when no order waits.
    """
    live = exists().where(
        Assignment.order_id == Order.id, Assignment.status.in_(LIVE_ASSIGNMENT_STATUSES)
    )
    return await session.scalar(
        select(func.min(Order.created_at)).where(
            Order.status.in_(WAITING_FOR_STAFF_STATUSES),
            Order.is_simulated.is_(simulated),
            ~live,
        )
    )


@dataclass(frozen=True)
class AvailableDrivers:
    """Drivers who can take a job now (FR-031), by delivery type.

    Attributes:
        total: Every such driver, including those with no delivery type.
        keke: Keke riders.
        tanker: Tanker drivers.
    """

    total: int
    keke: int
    tanker: int


async def available_drivers(session: AsyncSession) -> AvailableDrivers:
    """Count active, approved drivers whose availability is on (FR-031).

    A "now" value for the dashboard: the same whatever its date or
    ``simulated`` value. Drivers with no delivery type count in ``total``
    only.

    Args:
        session: Database session.

    Returns:
        The counts.
    """
    rows = (
        await session.execute(
            select(DriverProfile.delivery_type, func.count())
            .join(User, User.id == DriverProfile.user_id)
            .where(
                User.is_active.is_(True),
                User.role == UserRole.DRIVER,
                DriverProfile.approval_status == ApprovalStatus.APPROVED,
                DriverProfile.is_available.is_(True),
            )
            .group_by(DriverProfile.delivery_type)
        )
    ).all()
    counts = {delivery_type: count for delivery_type, count in rows}
    return AvailableDrivers(
        total=sum(counts.values()),
        keke=counts.get(DeliveryType.KEKE, 0),
        tanker=counts.get(DeliveryType.TANKER, 0),
    )


#: Order statuses of a job on the road, from acceptance to unloading (the live map).
ON_THE_ROAD_STATUSES = (
    OrderStatus.ACCEPTED,
    OrderStatus.DEPARTED,
    OrderStatus.COLLECTED,
    OrderStatus.EN_ROUTE,
    OrderStatus.ARRIVED,
    OrderStatus.UNLOADING,
)


@dataclass(frozen=True)
class LiveJob:
    """An accepted job on the road, for the live map (no GPS, FR-037).

    Attributes:
        order: The order (status, delivery type, source, zone, flag).
        driver: The driver who accepted it.
        plate: Their plate, or None if not recorded.
    """

    order: Order
    driver: User
    plate: str | None


async def live_jobs(session: AsyncSession) -> list[LiveJob]:
    """Return the orders with an accepted assignment that are on the road, oldest first.

    Args:
        session: Database session.

    Returns:
        The jobs; every order is included with its ``is_simulated`` flag.
    """
    rows = (
        await session.execute(
            select(Order, User, DriverProfile.plate)
            .join(Assignment, Assignment.order_id == Order.id)
            .join(User, User.id == Assignment.driver_user_id)
            .outerjoin(DriverProfile, DriverProfile.user_id == User.id)
            .where(
                Assignment.status == AssignmentStatus.ACCEPTED,
                Order.status.in_(ON_THE_ROAD_STATUSES),
            )
            .order_by(Order.created_at, Order.id)
        )
    ).all()
    return [LiveJob(order=order, driver=driver, plate=plate) for order, driver, plate in rows]


@dataclass(frozen=True)
class DriverDeliveries:
    """How many of the given deliveries one driver made."""

    driver: User
    plate: str | None
    delivered: int


async def deliveries_by_driver(
    session: AsyncSession, order_ids: Collection[uuid.UUID]
) -> list[DriverDeliveries]:
    """Count the given delivered orders per driver, most first.

    The driver of a delivered order is the one on its ``completed``
    assignment (the job that ended with the delivery).

    Args:
        session: Database session.
        order_ids: Delivered orders (from ``orders.reporting.count_deliveries``).

    Returns:
        One row per driver with at least one of them, most first, then by name.
    """
    if not order_ids:
        return []
    delivered = func.count(Assignment.order_id.distinct())
    rows = (
        await session.execute(
            select(User, DriverProfile.plate, delivered)
            .join(Assignment, Assignment.driver_user_id == User.id)
            .outerjoin(DriverProfile, DriverProfile.user_id == User.id)
            .where(
                Assignment.order_id.in_(set(order_ids)),
                Assignment.status == AssignmentStatus.COMPLETED,
            )
            .group_by(User.id, DriverProfile.plate)
            .order_by(delivered.desc(), User.name, User.id)
        )
    ).all()
    return [DriverDeliveries(driver=user, plate=plate, delivered=n) for user, plate, n in rows]
