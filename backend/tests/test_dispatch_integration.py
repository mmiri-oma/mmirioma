"""Driver assignment against a real, migrated database (FR-031, FR-032, T-07; S1-07).

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Accounts use random fictional numbers; everything created is deleted
afterwards, children first (all foreign keys are RESTRICT).
"""

import asyncio
import secrets
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field

import psycopg
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.confirmation import service as confirmation_service
from app.modules.confirmation.schemas import OrderConfirmationFields
from app.modules.deliveries import holds
from app.modules.dispatch import service
from app.modules.dispatch.models import Assignment, AssignmentStatus, DeclineReason
from app.modules.dispatch.schemas import AdminOrderDetail, AdminOrderEvent
from app.modules.dispatch.service import Ineligibility
from app.modules.orders import service as orders_service
from app.modules.orders.models import Order, OrderEvent, OrderStatus, TransitionReason
from app.modules.orders.transitions import Requirement
from app.modules.payments import service as payments_service
from app.modules.payments.schemas import OrderPaymentRead
from tests.test_orders_integration import TEST_DATABASE_URL, new_order, run

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

S = OrderStatus
CONFIRMABLE = {
    Requirement.QUOTE_ACCEPTED,
    Requirement.PAY_ON_DELIVERY,
    Requirement.PHONE_VERIFIED,
    Requirement.SOURCE_ELIGIBLE,
    Requirement.SLOT_RESERVED,
}


@dataclass
class Created:
    user_ids: list[uuid.UUID] = field(default_factory=list)
    vehicle_ids: list[uuid.UUID] = field(default_factory=list)


@pytest.fixture
def created(monkeypatch: pytest.MonkeyPatch) -> Iterator[Created]:
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    get_settings.cache_clear()
    record = Created()
    yield record
    url = get_settings().sync_database_url.set(drivername="postgresql")
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        users = (record.user_ids,)
        # order_events reference assignments (revision 0008), so they go first.
        connection.execute(
            "DELETE FROM order_events WHERE order_id IN "
            "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
            users,
        )
        connection.execute("DELETE FROM assignments WHERE driver_user_id = ANY(%s)", users)
        connection.execute("DELETE FROM orders WHERE customer_id = ANY(%s)", users)
        connection.execute("DELETE FROM driver_profiles WHERE user_id = ANY(%s)", users)
        connection.execute("DELETE FROM vehicle_profiles WHERE id = ANY(%s)", (record.vehicle_ids,))
        connection.execute("DELETE FROM users WHERE id = ANY(%s)", users)
    get_settings.cache_clear()


def phone() -> str:
    return "+234809" + "".join(secrets.choice("0123456789") for _ in range(7))


async def add_user(
    sessions: async_sessionmaker[AsyncSession], created: Created, role: UserRole
) -> User:
    user = User(name=f"Sample {role.value}", phone=phone(), password_hash="unused", role=role)
    async with sessions() as session:
        session.add(user)
        await session.commit()
    created.user_ids.append(user.id)
    return user


async def add_driver(
    sessions: async_sessionmaker[AsyncSession], created: Created, payload: int = 1200
) -> User:
    """A driver account with a vehicle profile and a driver profile, available."""
    user = await add_user(sessions, created, UserRole.DRIVER)
    async with sessions() as session:
        vehicle = await service.create_vehicle_profile(
            session, vehicle_type="Sample tricycle", safe_payload_litres=payload
        )
        created.vehicle_ids.append(vehicle.id)
        await service.set_driver_vehicle(session, phone=user.phone, vehicle_profile_id=vehicle.id)
    return user


async def confirmed_order(
    sessions: async_sessionmaker[AsyncSession], created: Created, litres: int = 1200
) -> Order:
    customer = await add_user(sessions, created, UserRole.CUSTOMER)
    async with sessions() as session:
        order, _ = await orders_service.create_order(
            session, customer_id=customer.id, request=new_order(quantity_litres=litres)
        )
        return await orders_service.transition_order(
            session, order_id=order.id, target=S.CONFIRMED, actor=customer, satisfied=CONFIRMABLE
        )


async def status_of(sessions: async_sessionmaker[AsyncSession], order_id: uuid.UUID) -> OrderStatus:
    async with sessions() as session:
        order = await session.get(Order, order_id)
        assert order is not None
        return order.status


def test_assign_accept_and_the_audit_trail(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        order = await confirmed_order(sessions, created)

        async with sessions() as session:
            offered = await service.assign_driver(
                session, order_id=order.id, driver_user_id=driver.id, admin=admin
            )
        assert (offered.status, offered.offered_by) == (AssignmentStatus.OFFERED, admin.id)
        # FR-032: assigned, not accepted, until the driver says so.
        assert await status_of(sessions, order.id) is S.ASSIGNED

        async with sessions() as session:
            accepted = await service.accept_assignment(session, order_id=order.id, driver=driver)
        assert accepted.status is AssignmentStatus.ACCEPTED
        assert accepted.responded_at is not None
        assert await status_of(sessions, order.id) is S.ACCEPTED

        async with sessions() as session:
            events = list(
                await session.scalars(
                    select(OrderEvent)
                    .where(OrderEvent.order_id == order.id)
                    .order_by(OrderEvent.created_at, OrderEvent.id)
                )
            )
        assert [(e.to_status, e.actor_id) for e in events][-2:] == [
            (S.ASSIGNED, admin.id),
            (S.ACCEPTED, driver.id),
        ]

    run(scenario)


def test_ineligible_drivers_are_refused_with_every_reason(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        small = await add_driver(sessions, created, payload=600)
        no_profile = await add_user(sessions, created, UserRole.DRIVER)
        order = await confirmed_order(sessions, created, litres=1200)
        async with sessions() as session:
            await service.set_driver_availability(session, phone=small.phone, available=False)

        for target, reasons in [
            (small, ["unavailable", "over_payload"]),
            (no_profile, ["no_driver_profile"]),
            (admin, ["not_a_driver"]),
        ]:
            async with sessions() as session:
                with pytest.raises(APIError) as raised:
                    await service.assign_driver(
                        session, order_id=order.id, driver_user_id=target.id, admin=admin
                    )
            assert (raised.value.status_code, raised.value.code) == (409, "driver_not_eligible")
            assert raised.value.details == {"reasons": reasons}
        assert await status_of(sessions, order.id) is S.CONFIRMED

    run(scenario)


def test_t07_another_driver_cannot_accept_or_decline(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        other = await add_driver(sessions, created)
        order = await confirmed_order(sessions, created)
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=order.id, driver_user_id=driver.id, admin=admin
            )
        for action in (service.accept_assignment, service.decline_assignment):
            async with sessions() as session:
                with pytest.raises(APIError) as raised:
                    await action(session, order_id=order.id, driver=other)
            assert (raised.value.status_code, raised.value.code) == (404, "order_not_found")
        assert await status_of(sessions, order.id) is S.ASSIGNED

    run(scenario)


def test_the_order_list_names_the_live_driver_in_one_read(created: Created) -> None:
    """#204: an offered or accepted assignment names its driver; an ended one does not."""

    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        first_driver = await add_driver(sessions, created)
        second_driver = await add_driver(sessions, created)
        offered = await confirmed_order(sessions, created)
        declined = await confirmed_order(sessions, created)
        unassigned = await confirmed_order(sessions, created)
        ids = [offered.id, declined.id, unassigned.id]
        statuses = dict.fromkeys(ids, S.CONFIRMED)

        async with sessions() as session:
            assert await service.listed_drivers_by_order(session, {}) == {}
            assert await service.listed_drivers_by_order(session, statuses) == {}

        async with sessions() as session:
            await service.assign_driver(
                session, order_id=offered.id, driver_user_id=first_driver.id, admin=admin
            )
            await service.assign_driver(
                session, order_id=declined.id, driver_user_id=second_driver.id, admin=admin
            )
        async with sessions() as session:
            live = await service.listed_drivers_by_order(session, statuses)
        # Offered counts as live (decision 2 of the amendment); the unassigned order is absent.
        assert {order_id: user.id for order_id, user in live.items()} == {
            offered.id: first_driver.id,
            declined.id: second_driver.id,
        }

        async with sessions() as session:
            await service.accept_assignment(session, order_id=offered.id, driver=first_driver)
            await service.decline_assignment(
                session, order_id=declined.id, driver=second_driver, note="Sample: tyre puncture"
            )
        async with sessions() as session:
            live = await service.listed_drivers_by_order(session, statuses)
        assert {order_id: user.id for order_id, user in live.items()} == {
            offered.id: first_driver.id
        }

        # The admin list carries the same answer on each order of the page.
        async with sessions() as session:
            items, _ = await holds.list_orders(
                session,
                statuses=[],
                created_from=None,
                created_to=None,
                is_simulated=None,
                on_hold=None,
                limit=100,
                offset=0,
            )
        by_id = {item.staff_order.order.id: item.driver for item in items}
        assert by_id[offered.id] is not None
        assert by_id[offered.id].id == first_driver.id
        assert by_id[declined.id] is None
        assert by_id[unassigned.id] is None

    run(scenario)


def test_the_order_list_names_the_driver_of_an_ended_order(created: Created) -> None:
    """#243, #275: a completed job names its driver, whatever the order became later."""

    async def end(
        sessions: async_sessionmaker[AsyncSession],
        order_id: uuid.UUID,
        order_status: OrderStatus,
        assignment_status: AssignmentStatus | None = None,
    ) -> None:
        async with sessions() as session:
            order = await session.get(Order, order_id)
            assert order is not None
            order.status = order_status
            if assignment_status is not None:
                assignment = (
                    await session.scalars(select(Assignment).where(Assignment.order_id == order_id))
                ).one()
                assignment.status = assignment_status
            await session.commit()

    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        other = await add_driver(sessions, created)
        delivered = await confirmed_order(sessions, created)
        failed = await confirmed_order(sessions, created)
        held = await confirmed_order(sessions, created)
        never_accepted = await confirmed_order(sessions, created)
        declined = await confirmed_order(sessions, created)
        back_in_pool = await confirmed_order(sessions, created)
        reassigned = await confirmed_order(sessions, created)
        failed_then_cancelled = await confirmed_order(sessions, created)
        disputed = await confirmed_order(sessions, created)

        async with sessions() as session:
            for order, who in ((delivered, driver), (failed, other)):
                await service.assign_driver(
                    session, order_id=order.id, driver_user_id=who.id, admin=admin
                )
                await service.accept_assignment(session, order_id=order.id, driver=who)
        # The first two jobs end; then the driver is free for the next ones.
        await end(sessions, delivered.id, S.DELIVERED, AssignmentStatus.COMPLETED)
        await end(sessions, failed.id, S.FAILED, AssignmentStatus.COMPLETED)
        # Both drivers are free again. Two more jobs finish, and then the order moves on: a
        # failed delivery the dispatcher cancels (its only action, #275) and a delivery the
        # customer disputes. The assignment stays `completed` while the order status changes.
        # The agreed amendment names the first one and gives `disputed` null.
        async with sessions() as session:
            for order, who in ((failed_then_cancelled, other), (disputed, driver)):
                await service.assign_driver(
                    session, order_id=order.id, driver_user_id=who.id, admin=admin
                )
                await service.accept_assignment(session, order_id=order.id, driver=who)
        await end(sessions, failed_then_cancelled.id, S.FAILED, AssignmentStatus.COMPLETED)
        await end(sessions, failed_then_cancelled.id, S.CANCELLED)
        await end(sessions, disputed.id, S.DELIVERED, AssignmentStatus.COMPLETED)
        await end(sessions, disputed.id, S.DISPUTED)
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=held.id, driver_user_id=driver.id, admin=admin
            )
            await service.accept_assignment(session, order_id=held.id, driver=driver)
            await service.withdraw_assignment(
                session, order_id=held.id, admin=admin, expected_status=AssignmentStatus.ACCEPTED
            )
            await service.assign_driver(
                session, order_id=never_accepted.id, driver_user_id=driver.id, admin=admin
            )
            await service.withdraw_assignment(
                session,
                order_id=never_accepted.id,
                admin=admin,
                expected_status=AssignmentStatus.OFFERED,
            )
            await service.assign_driver(
                session, order_id=declined.id, driver_user_id=driver.id, admin=admin
            )
            await service.decline_assignment(
                session, order_id=declined.id, driver=driver, note="Sample: tyre puncture"
            )
            await service.assign_driver(
                session, order_id=back_in_pool.id, driver_user_id=driver.id, admin=admin
            )
            await service.accept_assignment(session, order_id=back_in_pool.id, driver=driver)
            await service.withdraw_assignment(
                session,
                order_id=back_in_pool.id,
                admin=admin,
                expected_status=AssignmentStatus.ACCEPTED,
            )
        # A accepted and was withdrawn, then B was offered and never answered: the latest counts.
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=reassigned.id, driver_user_id=driver.id, admin=admin
            )
            await service.accept_assignment(session, order_id=reassigned.id, driver=driver)
            await service.withdraw_assignment(
                session,
                order_id=reassigned.id,
                admin=admin,
                expected_status=AssignmentStatus.ACCEPTED,
            )
            await service.assign_driver(
                session, order_id=reassigned.id, driver_user_id=other.id, admin=admin
            )
            await service.withdraw_assignment(
                session,
                order_id=reassigned.id,
                admin=admin,
                expected_status=AssignmentStatus.OFFERED,
            )
        for order in (held, never_accepted, declined, reassigned):
            await end(sessions, order.id, S.CANCELLED)

        statuses = {
            delivered.id: S.DELIVERED,
            failed.id: S.FAILED,
            held.id: S.CANCELLED,
            never_accepted.id: S.CANCELLED,
            declined.id: S.CANCELLED,
            back_in_pool.id: S.CONFIRMED,
            reassigned.id: S.CANCELLED,
            failed_then_cancelled.id: S.CANCELLED,
            disputed.id: S.DISPUTED,
        }
        async with sessions() as session:
            named = await service.listed_drivers_by_order(session, statuses)
        assert {order_id: user.id for order_id, user in named.items()} == {
            delivered.id: driver.id,
            failed.id: other.id,
            held.id: driver.id,
            failed_then_cancelled.id: other.id,
        }

    run(scenario)


def test_decline_returns_the_order_and_frees_the_driver(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        order = await confirmed_order(sessions, created)
        second = await confirmed_order(sessions, created)
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=order.id, driver_user_id=driver.id, admin=admin
            )
            declined = await service.decline_assignment(
                session, order_id=order.id, driver=driver, note="Sample: tyre puncture"
            )
        assert (declined.status, declined.ended_at is not None) == (AssignmentStatus.DECLINED, True)
        assert await status_of(sessions, order.id) is S.CONFIRMED
        async with sessions() as session:
            last = await session.scalar(
                select(OrderEvent)
                .where(OrderEvent.order_id == order.id)
                .order_by(OrderEvent.created_at.desc(), OrderEvent.id.desc())
                .limit(1)
            )
        assert last is not None
        assert (last.reason_code, last.note) == (
            TransitionReason.DRIVER_DECLINED,
            "Sample: tyre puncture",
        )
        # The driver is free again.
        async with sessions() as session:
            again = await service.assign_driver(
                session, order_id=second.id, driver_user_id=driver.id, admin=admin
            )
        assert again.status is AssignmentStatus.OFFERED

    run(scenario)


def test_withdraw_an_accepted_job_but_not_after_departure(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        order = await confirmed_order(sessions, created)
        departed = await confirmed_order(sessions, created)
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=order.id, driver_user_id=driver.id, admin=admin
            )
            await service.accept_assignment(session, order_id=order.id, driver=driver)
            withdrawn = await service.withdraw_assignment(
                session, order_id=order.id, admin=admin, expected_status=AssignmentStatus.ACCEPTED
            )
        assert withdrawn.status is AssignmentStatus.WITHDRAWN
        assert await status_of(sessions, order.id) is S.CONFIRMED

        async with sessions() as session:
            await service.assign_driver(
                session, order_id=departed.id, driver_user_id=driver.id, admin=admin
            )
            await service.accept_assignment(session, order_id=departed.id, driver=driver)
            await orders_service.transition_order(
                session,
                order_id=departed.id,
                target=S.DEPARTED,
                actor=driver,
                assigned_driver_id=driver.id,
            )
            with pytest.raises(APIError) as raised:
                await service.withdraw_assignment(
                    session,
                    order_id=departed.id,
                    admin=admin,
                    expected_status=AssignmentStatus.ACCEPTED,
                )
        assert raised.value.code == "invalid_order_transition"

        async with sessions() as session:
            with pytest.raises(APIError) as none:
                await service.withdraw_assignment(
                    session,
                    order_id=order.id,
                    admin=admin,
                    expected_status=AssignmentStatus.OFFERED,
                )
        assert (none.value.status_code, none.value.code) == (404, "assignment_not_found")

    run(scenario)


def test_repeats_are_harmless_and_a_held_order_is_not_reassigned(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        other = await add_driver(sessions, created)
        order = await confirmed_order(sessions, created)
        async with sessions() as session:
            first = await service.assign_driver(
                session, order_id=order.id, driver_user_id=driver.id, admin=admin
            )
            repeat = await service.assign_driver(
                session, order_id=order.id, driver_user_id=driver.id, admin=admin
            )
            assert repeat.id == first.id
            with pytest.raises(APIError) as held:
                await service.assign_driver(
                    session, order_id=order.id, driver_user_id=other.id, admin=admin
                )
            assert held.value.code == "invalid_order_transition"
            await service.accept_assignment(session, order_id=order.id, driver=driver)
            twice = await service.accept_assignment(session, order_id=order.id, driver=driver)
            assert twice.status is AssignmentStatus.ACCEPTED
            rows = list(
                await session.scalars(select(Assignment).where(Assignment.order_id == order.id))
            )
        assert len(rows) == 1

    run(scenario)


def test_concurrent_offers_cannot_overcommit_a_driver(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        orders = [await confirmed_order(sessions, created) for _ in range(2)]

        async def offer(order: Order) -> object:
            async with sessions() as session:
                return await service.assign_driver(
                    session, order_id=order.id, driver_user_id=driver.id, admin=admin
                )

        results = await asyncio.gather(*(offer(order) for order in orders), return_exceptions=True)
        failures = [r for r in results if isinstance(r, APIError)]
        assert len(failures) == 1, results
        assert failures[0].code == "driver_not_eligible"
        assert failures[0].details == {"reasons": ["busy"]}
        statuses = sorted([await status_of(sessions, order.id) for order in orders])
        assert statuses == sorted([S.ASSIGNED, S.CONFIRMED])

    run(scenario)


def test_concurrent_offers_of_one_order_to_two_drivers(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        drivers = [await add_driver(sessions, created) for _ in range(2)]
        order = await confirmed_order(sessions, created)

        async def offer(driver: User) -> object:
            async with sessions() as session:
                return await service.assign_driver(
                    session, order_id=order.id, driver_user_id=driver.id, admin=admin
                )

        results = await asyncio.gather(*(offer(d) for d in drivers), return_exceptions=True)
        assert sum(isinstance(r, APIError) for r in results) == 1, results
        async with sessions() as session:
            live = list(
                await session.scalars(
                    select(Assignment).where(
                        Assignment.order_id == order.id,
                        Assignment.status == AssignmentStatus.OFFERED,
                    )
                )
            )
        assert len(live) == 1

    run(scenario)


def test_driver_profiles_only_for_driver_accounts_and_active_vehicles(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        async with sessions() as session:
            vehicle = await service.create_vehicle_profile(
                session, vehicle_type="Sample truck", safe_payload_litres=5000
            )
            created.vehicle_ids.append(vehicle.id)
            with pytest.raises(LookupError):
                await service.set_driver_vehicle(
                    session, phone=admin.phone, vehicle_profile_id=vehicle.id
                )
            with pytest.raises(LookupError):
                await service.set_driver_vehicle(
                    session, phone=driver.phone, vehicle_profile_id=uuid.uuid4()
                )
            with pytest.raises(LookupError):
                await service.set_driver_availability(session, phone=driver.phone, available=False)

            profile = await service.set_driver_vehicle(
                session, phone=driver.phone, vehicle_profile_id=vehicle.id
            )
            assert profile.is_available
            listed = [user.id for _, user, _ in await service.list_driver_profiles(session)]
        assert driver.id in listed

    run(scenario)


# --- Admin dispatch views (docs/api/deliveries.md, "Admin dispatch endpoints") ---


async def named_driver(
    sessions: async_sessionmaker[AsyncSession],
    created: Created,
    name: str,
    payload: int | None = 3000,
) -> User:
    """A driver account named ``name``; with a vehicle unless ``payload`` is None."""
    user = User(name=name, phone=phone(), password_hash="unused", role=UserRole.DRIVER)
    async with sessions() as session:
        session.add(user)
        await session.commit()
    created.user_ids.append(user.id)
    if payload is not None:
        async with sessions() as session:
            vehicle = await service.create_vehicle_profile(
                session, vehicle_type="Sample tanker", safe_payload_litres=payload
            )
            created.vehicle_ids.append(vehicle.id)
            await service.set_driver_vehicle(
                session, phone=user.phone, vehicle_profile_id=vehicle.id
            )
    return user


def test_driver_list_puts_eligible_drivers_first_with_every_reason(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        tag = secrets.token_hex(4)
        admin = await add_user(sessions, created, UserRole.ADMIN)
        order = await confirmed_order(sessions, created, litres=2000)
        other = await confirmed_order(sessions, created, litres=1000)
        # Created out of name order, so the sort is the service's.
        femi = await named_driver(sessions, created, f"Sample {tag} Femi")
        ada = await named_driver(sessions, created, f"Sample {tag} Ada")
        bola = await named_driver(sessions, created, f"Sample {tag} Bola", payload=1200)
        chi = await named_driver(sessions, created, f"Sample {tag} Chi")
        dayo = await named_driver(sessions, created, f"Sample {tag} Dayo", payload=None)
        eze = await named_driver(sessions, created, f"Sample {tag} Eze")
        async with sessions() as session:
            await service.set_driver_availability(session, phone=chi.phone, available=False)
            await auth_service.set_user_active(session, phone=eze.phone, active=False)
            await service.assign_driver(
                session, order_id=other.id, driver_user_id=femi.id, admin=admin
            )
            choices = await service.list_drivers_for_order(session, reference=order.reference)

        ours = [choice for choice in choices if tag in choice.driver.name]
        assert [(choice.driver.id, choice.reasons) for choice in ours] == [
            (ada.id, []),
            (bola.id, [Ineligibility.OVER_PAYLOAD]),
            (chi.id, [Ineligibility.UNAVAILABLE]),
            (dayo.id, [Ineligibility.NO_DRIVER_PROFILE]),
            (eze.id, [Ineligibility.INACTIVE]),
            (femi.id, [Ineligibility.BUSY]),
        ]
        assert ours[0].vehicle is not None and ours[0].vehicle.safe_payload_litres == 3000
        assert ours[3].vehicle is None
        # Every eligible driver in the database comes before every other one.
        flags = [bool(choice.reasons) for choice in choices]
        assert flags == sorted(flags)

    run(scenario)


def test_offer_by_reference_returns_the_current_detail(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created, payload=3000)
        order = await confirmed_order(sessions, created)
        async with sessions() as session:
            offered, new = await service.offer_order(
                session, reference=order.reference, driver_user_id=driver.id, admin=admin
            )
            # Building the response reads every column, including updated_at,
            # which the transition expired (no async lazy load may happen).
            view = await confirmation_service.confirmation_view(session, offered.staff_order.order)
            payment = await payments_service.payment_view(session, offered.staff_order.order)
            detail = AdminOrderDetail.from_dispatch(
                offered,
                None,
                OrderConfirmationFields.from_view(offered.staff_order.order, view),
                OrderPaymentRead.from_view(payment),
                contact_attempts=await holds.contact_attempt_times(session, order.id),
                lookups=orders_service.ReadLookups(),  # no zone, no quote
            ).model_dump()
            again, repeated_new = await service.offer_order(
                session, reference=order.reference, driver_user_id=driver.id, admin=admin
            )
        assert (new, repeated_new) == (True, False)
        assert detail["status"] is S.ASSIGNED
        assert detail["updated_at"] >= order.updated_at
        assignment = detail["assignment"]
        assert assignment["status"] is AssignmentStatus.OFFERED
        assert assignment["driver"] == {"id": driver.id, "name": driver.name}
        assert assignment["offered_by"] == {"id": admin.id, "name": admin.name}
        assert assignment["vehicle"] == {"type": "Sample tricycle", "safe_payload_litres": 3000}
        assert again.assignment is not None
        assert again.assignment.assignment.id == assignment["id"]

        async with sessions() as session:
            with pytest.raises(APIError) as held:
                await service.offer_order(
                    session, reference=order.reference, driver_user_id=uuid.uuid4(), admin=admin
                )
        assert (held.value.status_code, held.value.code) == (409, "invalid_order_transition")

    run(scenario)


def test_withdraw_refuses_a_job_that_changed_while_the_dialog_was_open(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        order = await confirmed_order(sessions, created)
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=order.id, driver_user_id=driver.id, admin=admin
            )
            # "Withdraw job" on an offer the driver has not accepted.
            with pytest.raises(APIError) as early:
                await holds.withdraw_job(
                    session,
                    reference=order.reference,
                    admin=admin,
                    expected_status=AssignmentStatus.ACCEPTED,
                    note=None,
                )
            # The driver accepts while "Withdraw this offer?" is open.
            await service.accept_assignment(session, order_id=order.id, driver=driver)
            with pytest.raises(APIError) as late:
                await holds.withdraw_job(
                    session,
                    reference=order.reference,
                    admin=admin,
                    expected_status=AssignmentStatus.OFFERED,
                    note="Sample: no answer",
                )
            events_before = len(await orders_service.list_order_events(session, order.id))
        for raised in (early, late):
            assert (raised.value.status_code, raised.value.code) == (
                409,
                "invalid_order_transition",
            )
        assert late.value.details == {"from": "accepted", "to": "confirmed"}
        assert await status_of(sessions, order.id) is S.ACCEPTED

        async with sessions() as session:
            withdrawn = await holds.withdraw_job(
                session,
                reference=order.reference,
                admin=admin,
                expected_status=AssignmentStatus.ACCEPTED,
                note=None,
            )
            events_after = len(await orders_service.list_order_events(session, order.id))
        assert withdrawn.dispatch.staff_order.order.status is S.CONFIRMED
        assert withdrawn.dispatch.assignment is not None
        assert withdrawn.dispatch.assignment.assignment.status is AssignmentStatus.WITHDRAWN
        assert withdrawn.hold is None
        assert events_after == events_before + 1

    run(scenario)


def test_history_names_people_and_reads_the_decline_reason(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        first = await add_driver(sessions, created)
        second = await add_driver(sessions, created)
        order = await confirmed_order(sessions, created)
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=order.id, driver_user_id=first.id, admin=admin
            )
        async with sessions() as session:
            await service.decline_assignment(
                session,
                order_id=order.id,
                driver=first,
                reason=DeclineReason.VEHICLE_CANNOT_CARRY,
                note="Sample: truck at the mechanic",
            )
        async with sessions() as session:
            after_decline = await service.get_dispatch_order(session, reference=order.reference)
        async with sessions() as session:
            await service.assign_driver(
                session, order_id=order.id, driver_user_id=second.id, admin=admin
            )
        async with sessions() as session:
            await holds.withdraw_job(
                session,
                reference=order.reference,
                admin=admin,
                expected_status=AssignmentStatus.OFFERED,
                note="Sample: no answer",
            )
        async with sessions() as session:
            entries = await service.order_history(session, reference=order.reference)
            items = [AdminOrderEvent.from_entry(entry, {}).model_dump() for entry in entries]

        # D3: the latest assignment carries the decline.
        declined = after_decline.assignment
        assert declined is not None
        assert declined.assignment.status is AssignmentStatus.DECLINED
        assert declined.assignment.decline_reason is DeclineReason.VEHICLE_CANNOT_CARRY
        assert declined.assignment.responded_at is not None

        def summary(item: dict[str, object]) -> tuple[object, ...]:
            actor = item["actor"]
            assignment = item["assignment"]
            return (
                item["to_status"],
                item["reason_code"],
                item["note"],
                None if actor is None else actor["name"],  # type: ignore[index]
                None if assignment is None else assignment["driver"]["id"],  # type: ignore[index]
                None if assignment is None else assignment["decline_reason"],  # type: ignore[index]
            )

        customer_name = f"Sample {UserRole.CUSTOMER.value}"
        assert [summary(item) for item in items] == [
            (
                S.CONFIRMED,
                TransitionReason.REASSIGNED,
                "Sample: no answer",
                admin.name,
                second.id,
                None,
            ),
            (S.ASSIGNED, None, None, admin.name, second.id, None),
            (
                S.CONFIRMED,
                TransitionReason.DRIVER_DECLINED,
                "Sample: truck at the mechanic",
                first.name,
                first.id,
                DeclineReason.VEHICLE_CANNOT_CARRY,
            ),
            (S.ASSIGNED, None, None, admin.name, first.id, None),
            (S.CONFIRMED, None, None, customer_name, None, None),
            (S.QUOTE_REQUESTED, None, None, customer_name, None, None),
        ]
        assert items[0]["actor"]["role"] is UserRole.ADMIN  # type: ignore[index]
        assert items[2]["actor"]["role"] is UserRole.DRIVER  # type: ignore[index]

    run(scenario)


def test_admin_views_of_an_unknown_order_are_not_found(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        async with sessions() as session:
            for call in (
                service.get_dispatch_order,
                service.list_drivers_for_order,
                service.order_history,
            ):
                with pytest.raises(APIError) as raised:
                    await call(session, reference="MO-0000000000")
                assert raised.value.code == "order_not_found"

    run(scenario)
