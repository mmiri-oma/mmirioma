"""Demo seed against a real, migrated database (S1-18, BR-09).

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Before and after each test, every account in the reserved demo phone block
(and its orders) is deleted, so do not point TEST_DATABASE_URL at a database
whose demo data you want to keep; re-run the seed afterwards.
"""

import asyncio
import os
from collections.abc import Awaitable, Callable, Iterator

import psycopg
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.demo.seed import (
    DEMO_ACCOUNTS,
    DEMO_PHONE_PREFIX,
    DemoSeedError,
    seed_demo_data,
)
from app.modules.orders.models import Order, OrderStatus

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

PASSWORD = "demo password for tests"


def delete_demo_block() -> None:
    url = get_settings().sync_database_url.set(drivername="postgresql")
    params = {"prefix": DEMO_PHONE_PREFIX + "%"}
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        # Foreign keys are RESTRICT, so delete children first.
        connection.execute(
            "DELETE FROM order_events WHERE order_id IN (SELECT o.id FROM orders o "
            "JOIN users u ON u.id = o.customer_id WHERE u.phone LIKE %(prefix)s)",
            params,
        )
        connection.execute(
            "DELETE FROM orders WHERE customer_id IN "
            "(SELECT id FROM users WHERE phone LIKE %(prefix)s)",
            params,
        )
        connection.execute("DELETE FROM users WHERE phone LIKE %(prefix)s", params)


@pytest.fixture(autouse=True)
def clean_demo_block(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    get_settings.cache_clear()
    delete_demo_block()
    yield
    delete_demo_block()
    get_settings.cache_clear()


def run[T](call: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run ``call`` with its own engine and event loop (LOG.md, 2026-10-14)."""

    async def _run() -> T:
        engine = create_async_engine(TEST_DATABASE_URL or "")
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                return await call(session)
        finally:
            await engine.dispose()

    return asyncio.run(_run())


async def demo_rows(session: AsyncSession) -> tuple[list[User], list[Order]]:
    users = list(
        await session.scalars(select(User).where(User.phone.startswith(DEMO_PHONE_PREFIX)))
    )
    orders = list(
        await session.scalars(
            select(Order).where(Order.customer_id.in_([user.id for user in users]))
        )
    )
    return users, orders


def test_seed_creates_flagged_demo_dataset() -> None:
    report = run(lambda session: seed_demo_data(session, password=PASSWORD))
    users, orders = run(demo_rows)

    assert sorted(report.accounts_created) == sorted(spec.phone for spec in DEMO_ACCOUNTS)
    assert {(user.phone, user.name, user.role) for user in users} == {
        (spec.phone, spec.name, spec.role) for spec in DEMO_ACCOUNTS
    }
    expected_orders = sum(len(spec.orders) for spec in DEMO_ACCOUNTS)
    assert len(orders) == len(report.orders_created) == expected_orders
    assert all(order.is_simulated for order in orders)
    assert all(order.status is OrderStatus.QUOTE_REQUESTED for order in orders)
    customer_ids = {user.id for user in users if user.role is UserRole.CUSTOMER}
    assert {order.customer_id for order in orders} == customer_ids

    admin = next(spec for spec in DEMO_ACCOUNTS if spec.role is UserRole.ADMIN)
    signed_in = run(
        lambda session: auth_service.authenticate(session, phone=admin.phone, password=PASSWORD)
    )
    assert signed_in.role is UserRole.ADMIN


def test_running_the_seed_again_creates_nothing() -> None:
    run(lambda session: seed_demo_data(session, password=PASSWORD))
    before = run(demo_rows)

    report = run(lambda session: seed_demo_data(session, password="a different password"))
    after = run(demo_rows)

    assert report.accounts_created == []
    assert report.orders_created == []
    assert len(report.accounts_existing) == len(DEMO_ACCOUNTS)
    assert len(report.customers_skipped) == 2
    assert {user.id for user in after[0]} == {user.id for user in before[0]}
    assert {order.id for order in after[1]} == {order.id for order in before[1]}
    # Existing passwords are not changed.
    admin = next(spec for spec in DEMO_ACCOUNTS if spec.role is UserRole.ADMIN)
    run(lambda session: auth_service.authenticate(session, phone=admin.phone, password=PASSWORD))


def test_seed_stops_if_a_reserved_phone_belongs_to_someone_else() -> None:
    taken = DEMO_ACCOUNTS[-1].phone
    run(
        lambda session: auth_service.create_user(
            session, name="Real Person", phone=taken, password=PASSWORD, role=UserRole.CUSTOMER
        )
    )

    with pytest.raises(DemoSeedError, match="Nothing was changed"):
        run(lambda session: seed_demo_data(session, password=PASSWORD))

    users, orders = run(demo_rows)
    assert [user.name for user in users] == ["Real Person"]
    assert orders == []
