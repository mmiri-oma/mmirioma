"""Order persistence against a real, migrated database (FR-001, FR-026, FR-027).

Covers acceptance tests T-06 (duplicate checkout) and T-07 (cross-customer
access) at the service level; the HTTP endpoints come with S1-03 part 2.

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Every user and order is created here and deleted afterwards.
"""

import asyncio
import os
import secrets
import uuid
from collections.abc import Awaitable, Callable, Iterator
from http import HTTPStatus

import psycopg
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth.models import User, UserRole
from app.modules.orders import service
from app.modules.orders.models import Order, OrderEvent, OrderStatus
from app.modules.orders.service import NewOrder

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

Scenario = Callable[[async_sessionmaker[AsyncSession]], Awaitable[None]]


def run(scenario: Scenario) -> None:
    """Run an async scenario with its own engine and event loop (see LOG.md)."""

    async def _run() -> None:
        engine = create_async_engine(TEST_DATABASE_URL or "")
        try:
            await scenario(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            await engine.dispose()

    asyncio.run(_run())


@pytest.fixture
def created_user_ids(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[uuid.UUID]]:
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    get_settings.cache_clear()
    user_ids: list[uuid.UUID] = []
    yield user_ids
    if user_ids:
        url = get_settings().sync_database_url.set(drivername="postgresql")
        with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
            # Foreign keys are RESTRICT, so delete children first.
            connection.execute(
                "DELETE FROM order_events WHERE order_id IN "
                "(SELECT id FROM orders WHERE customer_id = ANY(%s))",
                (user_ids,),
            )
            connection.execute("DELETE FROM orders WHERE customer_id = ANY(%s)", (user_ids,))
            connection.execute("DELETE FROM users WHERE id = ANY(%s)", (user_ids,))
    get_settings.cache_clear()


async def add_customer(
    sessions: async_sessionmaker[AsyncSession], user_ids: list[uuid.UUID]
) -> uuid.UUID:
    # A fictional 0809 number; the password hash is never checked here.
    phone = "+234809" + "".join(secrets.choice("0123456789") for _ in range(7))
    user = User(name="Sample Customer", phone=phone, password_hash="unused", role=UserRole.CUSTOMER)
    async with sessions() as session:
        session.add(user)
        await session.commit()
    user_ids.append(user.id)
    return user.id


def new_order(**changes: object) -> NewOrder:
    fields: dict[str, object] = {
        "idempotency_key": uuid.uuid4(),
        "quantity_litres": 200,
        "contact_name": "Sample Customer",
        "contact_phone": "+2348000000001",
        "delivery_address": "12 Sample Close, Independence Layout, Enugu",
        "landmark": "Opposite the blue gate",
    }
    fields.update(changes)
    return NewOrder(**fields)  # type: ignore[arg-type]


async def count_orders(sessions: async_sessionmaker[AsyncSession], customer_id: uuid.UUID) -> int:
    async with sessions() as session:
        total = await session.scalar(
            select(func.count()).select_from(Order).where(Order.customer_id == customer_id)
        )
    return total or 0


def test_create_order_stores_a_quote_request_and_its_creation_event(
    created_user_ids: list[uuid.UUID],
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        customer_id = await add_customer(sessions, created_user_ids)
        async with sessions() as session:
            order, created = await service.create_order(
                session, customer_id=customer_id, request=new_order()
            )
        assert created is True
        assert order.status is OrderStatus.QUOTE_REQUESTED
        assert order.reference.startswith("MO-")
        assert order.is_simulated is False
        assert order.created_at.tzinfo is not None

        async with sessions() as session:
            events = (
                await session.scalars(select(OrderEvent).where(OrderEvent.order_id == order.id))
            ).all()
        assert len(events) == 1
        assert events[0].actor_id == customer_id
        assert events[0].from_status is None
        assert events[0].to_status is OrderStatus.QUOTE_REQUESTED

    run(scenario)


def test_t06_retry_with_same_key_returns_the_existing_order(
    created_user_ids: list[uuid.UUID],
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        customer_id = await add_customer(sessions, created_user_ids)
        request = new_order()
        async with sessions() as session:
            first, first_created = await service.create_order(
                session, customer_id=customer_id, request=request
            )
        async with sessions() as session:
            retry, retry_created = await service.create_order(
                session, customer_id=customer_id, request=request
            )
        assert (first_created, retry_created) == (True, False)
        assert retry.id == first.id
        assert retry.reference == first.reference
        assert await count_orders(sessions, customer_id) == 1

    run(scenario)


def test_t06_concurrent_duplicate_checkouts_create_exactly_one_order(
    created_user_ids: list[uuid.UUID],
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        customer_id = await add_customer(sessions, created_user_ids)
        request = new_order()

        async def submit() -> tuple[Order, bool]:
            async with sessions() as session:
                return await service.create_order(session, customer_id=customer_id, request=request)

        results = await asyncio.gather(*(submit() for _ in range(5)))
        assert len({order.id for order, _ in results}) == 1
        assert sum(created for _, created in results) == 1
        assert await count_orders(sessions, customer_id) == 1

    run(scenario)


def test_same_key_with_different_details_is_rejected(
    created_user_ids: list[uuid.UUID],
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        customer_id = await add_customer(sessions, created_user_ids)
        request = new_order()
        async with sessions() as session:
            await service.create_order(session, customer_id=customer_id, request=request)

        changed = new_order(idempotency_key=request.idempotency_key, quantity_litres=500)
        async with sessions() as session:
            with pytest.raises(APIError) as error:
                await service.create_order(session, customer_id=customer_id, request=changed)
        assert error.value.status_code == HTTPStatus.CONFLICT
        assert error.value.code == "idempotency_key_reused"
        assert await count_orders(sessions, customer_id) == 1

    run(scenario)


def test_idempotency_keys_are_scoped_per_customer(
    created_user_ids: list[uuid.UUID],
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        first_customer = await add_customer(sessions, created_user_ids)
        second_customer = await add_customer(sessions, created_user_ids)
        request = new_order()
        async with sessions() as session:
            first, _ = await service.create_order(
                session, customer_id=first_customer, request=request
            )
        async with sessions() as session:
            second, created = await service.create_order(
                session, customer_id=second_customer, request=request
            )
        # Another customer's key never returns (or reveals) someone else's order.
        assert created is True
        assert second.id != first.id

    run(scenario)


def test_database_rejects_a_duplicate_idempotency_key_directly(
    created_user_ids: list[uuid.UUID],
) -> None:
    # FR-026 must hold even for code that bypasses the service lookup.
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        customer_id = await add_customer(sessions, created_user_ids)
        key = uuid.uuid4()

        def row() -> Order:
            return Order(
                reference=service.generate_order_reference(),
                customer_id=customer_id,
                idempotency_key=key,
                status=OrderStatus.QUOTE_REQUESTED,
                quantity_litres=100,
                contact_name="Sample Customer",
                contact_phone="+2348000000001",
                delivery_address="12 Sample Close, Enugu",
            )

        async with sessions() as session:
            session.add(row())
            await session.commit()
        async with sessions() as session:
            session.add(row())
            with pytest.raises(IntegrityError):
                await session.commit()

    run(scenario)


@pytest.mark.parametrize("quantity_litres", [0, -1, 100_001])
def test_database_rejects_out_of_range_quantities(
    created_user_ids: list[uuid.UUID], quantity_litres: int
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        customer_id = await add_customer(sessions, created_user_ids)
        async with sessions() as session:
            with pytest.raises(IntegrityError):
                await service.create_order(
                    session,
                    customer_id=customer_id,
                    request=new_order(quantity_litres=quantity_litres),
                )

    run(scenario)


def test_t07_customer_cannot_read_another_customers_order(
    created_user_ids: list[uuid.UUID],
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        owner = await add_customer(sessions, created_user_ids)
        other = await add_customer(sessions, created_user_ids)
        async with sessions() as session:
            order, _ = await service.create_order(session, customer_id=owner, request=new_order())

        async with sessions() as session:
            found = await service.get_customer_order(
                session, customer_id=owner, reference=order.reference
            )
            assert found.id == order.id

            # Someone else's order and a non-existent one look the same.
            errors = []
            for reference in (order.reference, "MO-0000000000"):
                with pytest.raises(APIError) as error:
                    await service.get_customer_order(
                        session, customer_id=other, reference=reference
                    )
                errors.append((error.value.status_code, error.value.code, error.value.message))
        assert (
            errors[0] == errors[1] == (HTTPStatus.NOT_FOUND, "order_not_found", "Order not found")
        )

    run(scenario)


def test_list_returns_only_own_orders_newest_first(
    created_user_ids: list[uuid.UUID],
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        customer_id = await add_customer(sessions, created_user_ids)
        other = await add_customer(sessions, created_user_ids)
        references = []
        for _ in range(3):
            async with sessions() as session:
                order, _ = await service.create_order(
                    session, customer_id=customer_id, request=new_order()
                )
            references.append(order.reference)
        async with sessions() as session:
            await service.create_order(session, customer_id=other, request=new_order())

        async with sessions() as session:
            page, total = await service.list_customer_orders(
                session, customer_id=customer_id, limit=2, offset=0
            )
            rest, _ = await service.list_customer_orders(
                session, customer_id=customer_id, limit=2, offset=2
            )
        assert total == 3
        assert [order.reference for order in page + rest] == references[::-1]

    run(scenario)
