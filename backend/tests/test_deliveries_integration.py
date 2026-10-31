"""Driver jobs against a real, migrated database (docs/api/deliveries.md).

Covers the job list groups (including later-day jobs), ownership (T-07),
decline through dispatch (FR-032, row 10), pickup and its holds (FR-034,
row 13), new delivery codes (FR-035, 10 minutes, hashed, rate limited, only
after unloading is recorded complete, #67) and incidents (FR-036). Part 2
(accept, steps, arrival, contact attempts, unloading complete, proof) is in
test_driver_job_steps_integration.py. Jobs are ``dispatch`` assignments; a driver holds at
most one live job, so each scenario uses its own drivers.

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Every row is created here and deleted afterwards.
"""

import asyncio
import os
import secrets
import uuid
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth.models import User, UserRole
from app.modules.deliveries import codes, holds, service
from app.modules.deliveries.models import (
    ContactAttempt,
    DeliveryAttempt,
    DeliveryCode,
    ExceptionCategory,
    HoldKind,
    OrderException,
    PickupRecord,
    SmsStatus,
)
from app.modules.dispatch.models import Assignment, AssignmentStatus, DeclineReason
from app.modules.messaging.sms import MockSmsProvider
from app.modules.orders.models import Order, OrderEvent, OrderStatus, TransitionReason
from app.modules.sources.models import WaterSource

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

Sessions = async_sessionmaker[AsyncSession]
Scenario = Callable[[Sessions], Awaitable[None]]

# Mon 19 Oct 2026, 10:00 in Lagos.
NOW = datetime(2026, 10, 19, 9, 0, tzinfo=UTC)
REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def run(scenario: Scenario) -> None:
    """Run an async scenario with its own engine and event loop (see LOG.md)."""

    async def _run() -> None:
        engine = create_async_engine(TEST_DATABASE_URL or "")
        try:
            await scenario(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            await engine.dispose()

    asyncio.run(_run())


@dataclass
class Created:
    user_ids: list[uuid.UUID]
    source_ids: list[uuid.UUID]


@pytest.fixture
def created(monkeypatch: pytest.MonkeyPatch) -> Iterator[Created]:
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    get_settings.cache_clear()
    rows = Created(user_ids=[], source_ids=[])
    yield rows
    url = get_settings().sync_database_url.set(drivername="postgresql")
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        # Foreign keys are RESTRICT, so delete children first.
        for statement in (
            "DELETE FROM order_exceptions WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            # Part 2 tables (revision 0009): proofs and contact attempts first.
            "DELETE FROM delivery_proofs WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            "DELETE FROM contact_attempts WHERE delivery_attempt_id IN "
            "(SELECT id FROM delivery_attempts WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s)))",
            "DELETE FROM delivery_attempts WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            "DELETE FROM delivery_codes WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            "DELETE FROM pickup_records WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            # Price snapshots reference orders and events (revision 0012).
            "DELETE FROM order_price_snapshots WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            # order_events reference assignments (revision 0008).
            "DELETE FROM order_events WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            "DELETE FROM assignments WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            "DELETE FROM orders WHERE customer_id = ANY(%s)",
        ):
            connection.execute(statement, (rows.user_ids,))
        # Category activations reference sources (revision 0011).
        connection.execute(
            "DELETE FROM water_source_categories WHERE source_id = ANY(%s)", (rows.source_ids,)
        )
        connection.execute("DELETE FROM water_sources WHERE id = ANY(%s)", (rows.source_ids,))
        connection.execute("DELETE FROM users WHERE id = ANY(%s)", (rows.user_ids,))
    get_settings.cache_clear()


async def add_user(sessions: Sessions, created: Created, role: UserRole) -> User:
    phone = "+234809" + "".join(secrets.choice("0123456789") for _ in range(7))
    user = User(name=f"Sample {role.value}", phone=phone, password_hash="unused", role=role)
    async with sessions() as session:
        session.add(user)
        await session.commit()
    created.user_ids.append(user.id)
    return user


@dataclass
class Setup:
    admin: User
    customer: User
    source_id: uuid.UUID


async def setup(sessions: Sessions, created: Created) -> Setup:
    source = WaterSource(name="Sample Borehole A", approximate_location="Near the market gate")
    async with sessions() as session:
        session.add(source)
        await session.commit()
    created.source_ids.append(source.id)
    return Setup(
        admin=await add_user(sessions, created, UserRole.ADMIN),
        customer=await add_user(sessions, created, UserRole.CUSTOMER),
        source_id=source.id,
    )


async def add_job(
    sessions: Sessions,
    s: Setup,
    driver: User,
    *,
    order_status: OrderStatus,
    assignment_status: AssignmentStatus = AssignmentStatus.ACCEPTED,
    window_start: datetime | None = NOW,
    events: list[tuple[OrderStatus, datetime]] | None = None,
    with_source: bool = True,
    ended_at: datetime | None = None,
) -> str:
    """Create an order in ``order_status`` with one assignment. Returns the reference."""
    reference = "MO-" + "".join(secrets.choice(REFERENCE_ALPHABET) for _ in range(10))
    order = Order(
        reference=reference,
        customer_id=s.customer.id,
        idempotency_key=uuid.uuid4(),
        status=order_status,
        quantity_litres=1200,
        contact_name="Ngozi Adeyemi",
        contact_phone="+2348000000001",
        delivery_address="12 Sample Close, Independence Layout, Enugu",
        is_simulated=True,
        source_id=s.source_id if with_source else None,
        delivery_window_start_at=window_start,
        delivery_window_end_at=window_start + timedelta(hours=3) if window_start else None,
    )
    async with sessions() as session:
        session.add(order)
        await session.flush()
        session.add(
            Assignment(
                order_id=order.id,
                driver_user_id=driver.id,
                status=assignment_status,
                offered_by=s.admin.id,
                responded_at=(
                    None
                    if assignment_status is AssignmentStatus.OFFERED
                    else NOW - timedelta(hours=1)
                ),
                ended_at=ended_at,
            )
        )
        for to_status, at in events or []:
            session.add(
                OrderEvent(
                    order_id=order.id,
                    to_status=to_status,
                    actor_id=None,
                    created_at=at,
                    updated_at=at,
                )
            )
        await session.commit()
    return reference


async def mark_unloading_complete(
    sessions: Sessions, reference: str, driver: User, *, at: datetime = NOW
) -> None:
    """Give an ``unloading`` job a delivery attempt with unloading recorded complete.

    Stands in for ``POST .../unloading-complete`` without issuing a code, so
    the new-code tests start from "no code yet".
    """
    async with sessions() as session:
        order = await session.scalar(select(Order).where(Order.reference == reference))
        assert order is not None
        assignment = await session.scalar(select(Assignment).where(Assignment.order_id == order.id))
        assert assignment is not None
        session.add(
            DeliveryAttempt(
                assignment_id=assignment.id,
                order_id=order.id,
                arrived_at=at - timedelta(minutes=20),
                unloading_completed_at=at,
                recorded_by=driver.id,
            )
        )
        await session.commit()


async def expect_error(awaitable: Awaitable[object], status: int, code: str) -> APIError:
    with pytest.raises(APIError) as caught:
        await awaitable
    assert caught.value.status_code == status
    assert caught.value.code == code
    return caught.value


def pickup(**changes: object) -> service.NewPickup:
    fields: dict[str, object] = {
        "assigned_source": True,
        "other_source_name": None,
        "source_reference": "RCPT-0042",
        "volume_collected_litres": 1200,
        "picked_up_at": NOW - timedelta(minutes=10),
        "safety_concern": False,
        "safety_note": None,
    }
    fields.update(changes)
    return service.NewPickup(**fields)  # type: ignore[arg-type]


async def order_for(sessions: Sessions, reference: str) -> Order:
    async with sessions() as session:
        order = await session.scalar(select(Order).where(Order.reference == reference))
    assert order is not None
    return order


# --- Job list ---------------------------------------------------------------------


def test_list_shows_the_live_job_and_todays_finished_jobs(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        live = await add_job(sessions, s, driver, order_status=OrderStatus.EN_ROUTE)
        delivered = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.DELIVERED,
            assignment_status=AssignmentStatus.COMPLETED,
            ended_at=NOW - timedelta(hours=2),
        )
        # failed ends the job for the driver (the order may be rescheduled).
        failed = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.FAILED,
            assignment_status=AssignmentStatus.COMPLETED,
            ended_at=NOW - timedelta(hours=1),
        )
        # Not listed: ended yesterday, declined, withdrawn.
        await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.DELIVERED,
            assignment_status=AssignmentStatus.COMPLETED,
            ended_at=NOW - timedelta(days=1),
        )
        await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.CONFIRMED,
            assignment_status=AssignmentStatus.DECLINED,
            ended_at=NOW - timedelta(minutes=5),
        )
        await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.CONFIRMED,
            assignment_status=AssignmentStatus.WITHDRAWN,
            ended_at=NOW - timedelta(minutes=5),
        )

        async with sessions() as session:
            jobs = await service.list_driver_jobs(session, driver_id=driver.id, now=NOW)
        assert [j.order.reference for j in jobs.today] == [live]
        assert [j.order.reference for j in jobs.done] == [failed, delivered]
        assert jobs.offers == []
        assert jobs.upcoming == []

    run(scenario)


def test_offer_and_later_day_job_groups(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        offered_driver = await add_user(sessions, created, UserRole.DRIVER)
        later_driver = await add_user(sessions, created, UserRole.DRIVER)
        overdue_driver = await add_user(sessions, created, UserRole.DRIVER)
        offer = await add_job(
            sessions,
            s,
            offered_driver,
            order_status=OrderStatus.ASSIGNED,
            assignment_status=AssignmentStatus.OFFERED,
            window_start=NOW + timedelta(days=3),
        )
        later = await add_job(
            sessions,
            s,
            later_driver,
            order_status=OrderStatus.ACCEPTED,
            window_start=NOW + timedelta(days=2),
        )
        overdue = await add_job(
            sessions,
            s,
            overdue_driver,
            order_status=OrderStatus.ACCEPTED,
            window_start=NOW - timedelta(days=1),
        )
        async with sessions() as session:
            offers = await service.list_driver_jobs(session, driver_id=offered_driver.id, now=NOW)
            upcoming = await service.list_driver_jobs(session, driver_id=later_driver.id, now=NOW)
            late = await service.list_driver_jobs(session, driver_id=overdue_driver.id, now=NOW)
        assert [j.order.reference for j in offers.offers] == [offer]
        assert [j.order.reference for j in upcoming.upcoming] == [later]
        assert upcoming.upcoming[0].allowed_actions == [service.JobAction.REPORT_INCIDENT]
        assert [j.order.reference for j in late.today] == [overdue]
        assert late.today[0].allowed_actions[0] is service.JobAction.START_JOB

    run(scenario)


def test_t07_jobs_of_others_or_no_longer_held_are_not_found(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        other = await add_user(sessions, created, UserRole.DRIVER)
        mine = await add_job(sessions, s, driver, order_status=OrderStatus.ACCEPTED)
        withdrawn = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.CONFIRMED,
            assignment_status=AssignmentStatus.WITHDRAWN,
        )
        completed = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.DELIVERED,
            assignment_status=AssignmentStatus.COMPLETED,
            ended_at=NOW - timedelta(hours=1),
        )
        async with sessions() as session:
            await expect_error(
                service.get_driver_job(session, driver_id=other.id, reference=mine),
                404,
                "order_not_found",
            )
        # Only the order's live assignment opens the job (technical lead, 2026-10-19).
        for gone in (withdrawn, completed):
            async with sessions() as session:
                await expect_error(
                    service.get_driver_job(session, driver_id=driver.id, reference=gone),
                    404,
                    "order_not_found",
                )
        async with sessions() as session:
            job = await service.get_driver_job(session, driver_id=driver.id, reference=mine)
            assert job.job_status is service.JobStatus.ACCEPTED
        async with sessions() as session:
            await expect_error(
                service.get_driver_job(session, driver_id=driver.id, reference="MO-0000000000"),
                404,
                "order_not_found",
            )
        async with sessions() as session:
            await expect_error(
                service.report_incident(
                    session,
                    driver=other,
                    reference=mine,
                    incident=service.NewIncident(ExceptionCategory.VEHICLE_PROBLEM, None, None),
                    now=NOW,
                ),
                404,
                "order_not_found",
            )

    run(scenario)


# --- Decline ------------------------------------------------------------------------


def test_decline_goes_through_dispatch_and_keeps_the_reason(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.ASSIGNED,
            assignment_status=AssignmentStatus.OFFERED,
        )
        async with sessions() as session:
            await service.decline_offer(
                session,
                driver=driver,
                reference=reference,
                reason=DeclineReason.OTHER,
                note="Vehicle at the mechanic",
            )
        order = await order_for(sessions, reference)
        async with sessions() as session:
            assignment = await session.scalar(
                select(Assignment).where(Assignment.order_id == order.id)
            )
            event = await session.scalar(select(OrderEvent).where(OrderEvent.order_id == order.id))
        assert order.status is OrderStatus.CONFIRMED
        assert assignment is not None
        assert assignment.status is AssignmentStatus.DECLINED
        assert assignment.decline_reason is DeclineReason.OTHER
        assert assignment.decline_note == "Vehicle at the mechanic"
        assert assignment.ended_at is not None
        assert event is not None
        assert event.from_status is OrderStatus.ASSIGNED
        assert event.to_status is OrderStatus.CONFIRMED
        assert event.actor_id == driver.id
        assert event.reason_code is TransitionReason.DRIVER_DECLINED
        # The reason stays on the assignment; the event note is the driver's
        # own words, linked to the assignment (admin dispatch decision 3).
        assert event.note == "Vehicle at the mechanic"
        assert event.assignment_id == assignment.id

        # The offer is gone: a repeat looks like any order not offered to them.
        async with sessions() as session:
            await expect_error(
                service.decline_offer(
                    session,
                    driver=driver,
                    reference=reference,
                    reason=DeclineReason.TOO_FAR,
                    note=None,
                ),
                404,
                "order_not_found",
            )

    run(scenario)


def test_an_accepted_job_cannot_be_declined(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(sessions, s, driver, order_status=OrderStatus.ACCEPTED)
        async with sessions() as session:
            await expect_error(
                service.decline_offer(
                    session,
                    driver=driver,
                    reference=reference,
                    reason=DeclineReason.TOO_FAR,
                    note=None,
                ),
                403,
                "forbidden",
            )

    run(scenario)


# --- Pickup -------------------------------------------------------------------------


def test_pickup_moves_the_order_to_collected(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.DEPARTED,
            events=[(OrderStatus.DEPARTED, NOW - timedelta(minutes=30))],
        )
        async with sessions() as session:
            result = await service.record_pickup(
                session, driver=driver, reference=reference, pickup=pickup(), now=NOW
            )
        assert result.order.status is OrderStatus.COLLECTED
        assert result.hold is None
        assert result.pickup is not None
        assert result.pickup.source_id == s.source_id
        assert result.allowed_actions == [
            service.JobAction.LEAVE_FOR_CUSTOMER,
            service.JobAction.REPORT_INCIDENT,
        ]
        order = await order_for(sessions, reference)
        async with sessions() as session:
            exceptions = (
                await session.scalars(
                    select(OrderException).where(OrderException.order_id == order.id)
                )
            ).all()
            collected = await session.scalar(
                select(OrderEvent).where(
                    OrderEvent.order_id == order.id, OrderEvent.to_status == OrderStatus.COLLECTED
                )
            )
        assert exceptions == []
        assert collected is not None
        assert collected.actor_id == driver.id

        async with sessions() as session:
            await expect_error(
                service.record_pickup(
                    session, driver=driver, reference=reference, pickup=pickup(), now=NOW
                ),
                409,
                "pickup_already_recorded",
            )

    run(scenario)


def test_other_source_and_low_volume_open_a_review_hold_and_exceptions(
    created: Created,
) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(sessions, s, driver, order_status=OrderStatus.DEPARTED)
        async with sessions() as session:
            result = await service.record_pickup(
                session,
                driver=driver,
                reference=reference,
                pickup=pickup(
                    assigned_source=False,
                    other_source_name="Sample Tanker Point",
                    volume_collected_litres=800,
                ),
                now=NOW,
            )
        # FR-034: water was collected, but the driver must wait for review.
        assert result.order.status is OrderStatus.COLLECTED
        assert result.hold is not None
        assert result.hold.hold_kind is HoldKind.SOURCE_REVIEW
        assert result.allowed_actions == [service.JobAction.REPORT_INCIDENT]
        async with sessions() as session:
            categories = set(
                await session.scalars(
                    select(OrderException.category).where(
                        OrderException.order_id == result.order.id
                    )
                )
            )
            record = await session.scalar(
                select(PickupRecord).where(PickupRecord.order_id == result.order.id)
            )
        assert categories == {ExceptionCategory.SOURCE_MISMATCH, ExceptionCategory.PARTIAL_PICKUP}
        assert record is not None
        assert record.source_id is None
        assert record.other_source_name == "Sample Tanker Point"

    run(scenario)


def test_pickup_rules(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        drivers = [await add_user(sessions, created, UserRole.DRIVER) for _ in range(4)]
        not_departed = await add_job(sessions, s, drivers[0], order_status=OrderStatus.ACCEPTED)
        departed = await add_job(
            sessions,
            s,
            drivers[1],
            order_status=OrderStatus.DEPARTED,
            events=[(OrderStatus.DEPARTED, NOW - timedelta(minutes=30))],
        )
        no_source = await add_job(
            sessions, s, drivers[2], order_status=OrderStatus.DEPARTED, with_source=False
        )
        offered = await add_job(
            sessions,
            s,
            drivers[3],
            order_status=OrderStatus.ASSIGNED,
            assignment_status=AssignmentStatus.OFFERED,
        )
        async with sessions() as session:
            await expect_error(
                service.record_pickup(
                    session, driver=drivers[0], reference=not_departed, pickup=pickup(), now=NOW
                ),
                409,
                "invalid_order_transition",
            )
        async with sessions() as session:
            await expect_error(
                service.record_pickup(
                    session, driver=drivers[3], reference=offered, pickup=pickup(), now=NOW
                ),
                409,
                "invalid_order_transition",
            )
        async with sessions() as session:
            error = await expect_error(
                service.record_pickup(
                    session,
                    driver=drivers[1],
                    reference=departed,
                    pickup=pickup(picked_up_at=NOW - timedelta(hours=1)),
                    now=NOW,
                ),
                422,
                "validation_error",
            )
            assert error.details[0]["loc"] == ["body", "picked_up_at"]
        async with sessions() as session:
            await expect_error(
                service.record_pickup(
                    session,
                    driver=drivers[1],
                    reference=departed,
                    pickup=pickup(picked_up_at=NOW + timedelta(minutes=5)),
                    now=NOW,
                ),
                422,
                "validation_error",
            )
        async with sessions() as session:
            await expect_error(
                service.record_pickup(
                    session, driver=drivers[2], reference=no_source, pickup=pickup(), now=NOW
                ),
                422,
                "validation_error",
            )

    run(scenario)


def test_pickup_is_refused_while_the_job_is_on_hold(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(sessions, s, driver, order_status=OrderStatus.DEPARTED)
        async with sessions() as session:
            await service.report_incident(
                session,
                driver=driver,
                reference=reference,
                incident=service.NewIncident(ExceptionCategory.UNSAFE_ACCESS, None, None),
                now=NOW,
            )
        async with sessions() as session:
            await expect_error(
                service.record_pickup(
                    session, driver=driver, reference=reference, pickup=pickup(), now=NOW
                ),
                409,
                "job_on_hold",
            )

    run(scenario)


# --- Delivery codes -------------------------------------------------------------------


def test_new_delivery_code_is_hashed_sent_and_valid_10_minutes(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(sessions, s, driver, order_status=OrderStatus.UNLOADING)
        await mark_unloading_complete(sessions, reference, driver)
        sms = MockSmsProvider()
        async with sessions() as session:
            result = await service.issue_new_delivery_code(
                session, driver=driver, reference=reference, sms=sms, now=NOW
            )
        assert len(sms.outbox) == 1
        assert sms.outbox[0].phone == "+2348000000001"
        sent_code = sms.outbox[0].text.split("code is ")[1][:6]
        code = result.delivery_code
        assert code is not None
        assert code.sms_status is SmsStatus.ACCEPTED
        assert code.expires_at == NOW + timedelta(minutes=10)
        assert code.code_hash == codes.hash_code(code.id, sent_code)
        assert sent_code not in code.code_hash

        # Too soon for another (60-second cooldown).
        async with sessions() as session:
            error = await expect_error(
                service.issue_new_delivery_code(
                    session,
                    driver=driver,
                    reference=reference,
                    sms=sms,
                    now=NOW + timedelta(seconds=20),
                ),
                429,
                "rate_limited",
            )
            assert error.details == {"retry_after_seconds": 40}
        # After the cooldown, a usable code that was sent blocks a new one.
        async with sessions() as session:
            await expect_error(
                service.issue_new_delivery_code(
                    session,
                    driver=driver,
                    reference=reference,
                    sms=sms,
                    now=NOW + timedelta(minutes=2),
                ),
                409,
                "delivery_code_still_valid",
            )
        # After expiry a new code replaces the old one.
        async with sessions() as session:
            await service.issue_new_delivery_code(
                session,
                driver=driver,
                reference=reference,
                sms=sms,
                now=NOW + timedelta(minutes=11),
            )
        async with sessions() as session:
            rows = (
                await session.scalars(
                    select(DeliveryCode)
                    .where(DeliveryCode.order_id == result.order.id)
                    .order_by(DeliveryCode.issued_at)
                )
            ).all()
        assert len(rows) == 2
        assert rows[0].invalidated_at == NOW + timedelta(minutes=11)
        assert rows[1].invalidated_at is None

    run(scenario)


def test_sms_failure_is_recorded_and_not_claimed_as_sent(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(sessions, s, driver, order_status=OrderStatus.UNLOADING)
        await mark_unloading_complete(sessions, reference, driver)
        sms = MockSmsProvider(fail=True)
        async with sessions() as session:
            result = await service.issue_new_delivery_code(
                session, driver=driver, reference=reference, sms=sms, now=NOW
            )
        assert result.delivery_code is not None
        assert result.delivery_code.sms_status is SmsStatus.FAILED
        assert sms.outbox == []

    run(scenario)


def test_new_code_needs_unloading_recorded_complete(created: Created) -> None:
    # #67: the code is issued after unloading, so none can be replaced before.
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        sms = MockSmsProvider()
        for status in (OrderStatus.EN_ROUTE, OrderStatus.ARRIVED):
            driver = await add_user(sessions, created, UserRole.DRIVER)
            reference = await add_job(sessions, s, driver, order_status=status)
            async with sessions() as session:
                await expect_error(
                    service.issue_new_delivery_code(
                        session, driver=driver, reference=reference, sms=sms, now=NOW
                    ),
                    409,
                    "invalid_order_transition",
                )
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(sessions, s, driver, order_status=OrderStatus.UNLOADING)
        async with sessions() as session:
            error = await expect_error(
                service.issue_new_delivery_code(
                    session, driver=driver, reference=reference, sms=sms, now=NOW
                ),
                409,
                "transition_requirements_unmet",
            )
        assert error.details == {"missing": ["unloading_confirmed"]}
        assert sms.outbox == []

    run(scenario)


# --- Incidents ---------------------------------------------------------------------------


def test_incidents_never_change_the_order_status(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await add_job(sessions, s, driver, order_status=OrderStatus.EN_ROUTE)
        eta = NOW + timedelta(hours=1)
        async with sessions() as session:
            late, hold = await service.report_incident(
                session,
                driver=driver,
                reference=reference,
                incident=service.NewIncident(ExceptionCategory.RUNNING_LATE, "Traffic", eta),
                now=NOW,
            )
        assert hold is None
        assert late.new_estimated_arrival_at == eta
        async with sessions() as session:
            concern, _ = await service.report_incident(
                session,
                driver=driver,
                reference=reference,
                incident=service.NewIncident(ExceptionCategory.SOURCE_CONCERN, "Cloudy", None),
                now=NOW,
            )
        async with sessions() as session:
            _, unsafe_hold = await service.report_incident(
                session,
                driver=driver,
                reference=reference,
                incident=service.NewIncident(ExceptionCategory.UNSAFE_TRANSFER, None, None),
                now=NOW,
            )
        assert concern.requires_admin_review is True
        assert unsafe_hold is not None
        assert unsafe_hold.hold_kind is HoldKind.UNSAFE_STOP
        order = await order_for(sessions, reference)
        async with sessions() as session:
            events = (
                await session.scalars(select(OrderEvent).where(OrderEvent.order_id == order.id))
            ).all()
        assert order.status is OrderStatus.EN_ROUTE
        assert events == []

    run(scenario)


def test_incident_rules(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        drivers = [await add_user(sessions, created, UserRole.DRIVER) for _ in range(3)]
        offer = await add_job(
            sessions,
            s,
            drivers[0],
            order_status=OrderStatus.ASSIGNED,
            assignment_status=AssignmentStatus.OFFERED,
        )
        ended = await add_job(sessions, s, drivers[1], order_status=OrderStatus.DELIVERED)
        active = await add_job(sessions, s, drivers[2], order_status=OrderStatus.COLLECTED)
        incident = service.NewIncident(ExceptionCategory.VEHICLE_PROBLEM, None, None)
        for driver, reference in ((drivers[0], offer), (drivers[1], ended)):
            async with sessions() as session:
                await expect_error(
                    service.report_incident(
                        session, driver=driver, reference=reference, incident=incident, now=NOW
                    ),
                    409,
                    "job_not_active",
                )
        async with sessions() as session:
            await expect_error(
                service.report_incident(
                    session,
                    driver=drivers[2],
                    reference=active,
                    incident=service.NewIncident(
                        ExceptionCategory.RUNNING_LATE, None, NOW - timedelta(hours=1)
                    ),
                    now=NOW,
                ),
                422,
                "validation_error",
            )

    run(scenario)


async def add_contact_attempts(
    sessions: Sessions, reference: str, driver: User, times: list[datetime]
) -> None:
    """Give a job an arrival and contact attempts at ``times``, inserted in the order given."""
    async with sessions() as session:
        order = await session.scalar(select(Order).where(Order.reference == reference))
        assert order is not None
        assignment = await session.scalar(select(Assignment).where(Assignment.order_id == order.id))
        assert assignment is not None
        arrival = DeliveryAttempt(
            assignment_id=assignment.id,
            order_id=order.id,
            arrived_at=NOW - timedelta(minutes=30),
            recorded_by=driver.id,
        )
        session.add(arrival)
        await session.flush()
        for at in times:
            session.add(
                ContactAttempt(
                    delivery_attempt_id=arrival.id, attempted_at=at, recorded_by=driver.id
                )
            )
        await session.commit()


def test_the_admin_detail_lists_the_contact_attempts_oldest_first(created: Created) -> None:
    """#280: a failed delivery's attempts, as times, oldest first; another order's never mix in."""

    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        first = NOW + timedelta(minutes=14)
        second = NOW + timedelta(minutes=19)
        failed = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.FAILED,
            assignment_status=AssignmentStatus.COMPLETED,
        )
        other = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.FAILED,
            assignment_status=AssignmentStatus.COMPLETED,
        )
        unreached = await add_job(sessions, s, driver, order_status=OrderStatus.EN_ROUTE)
        # Inserted newest first, so the order of the result is the read's, not the insert's.
        await add_contact_attempts(sessions, failed, driver, [second, first])
        await add_contact_attempts(sessions, other, driver, [NOW + timedelta(minutes=40)])

        async with sessions() as session:
            failed_order = await order_for(sessions, failed)
            unreached_order = await order_for(sessions, unreached)
            assert await holds.contact_attempt_times(session, failed_order.id) == (first, second)
            assert await holds.contact_attempt_times(session, unreached_order.id) == ()
            detail = await holds.get_order_detail(session, reference=failed)
            assert detail.contact_attempts == (first, second)
            empty = await holds.get_order_detail(session, reference=unreached)
            assert empty.contact_attempts == ()

    run(scenario)
