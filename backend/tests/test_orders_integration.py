"""Orders against a real, migrated database (FR-001, FR-026, FR-027, FR-030).

Covers acceptance tests T-06 (duplicate checkout) and T-07 (cross-customer
access) at the service level and through the HTTP endpoints, plus the admin
filters (Lagos date bounds, ``is_simulated``).

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
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.errors import APIError
from app.main import create_app
from app.modules.auth import service as auth_service
from app.modules.auth.dependencies import CSRF_HEADER_NAME
from app.modules.auth.models import User, UserRole
from app.modules.orders import service
from app.modules.orders.models import Order, OrderEvent, OrderStatus
from app.modules.orders.service import IDEMPOTENCY_KEY_REUSED_MESSAGE, NewOrder

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


# --- HTTP endpoints ---------------------------------------------------------------

PASSWORD = "correct horse battery"


@pytest.fixture
def http(created_user_ids: list[uuid.UUID]) -> Iterator[TestClient]:
    # created_user_ids points the settings at TEST_DATABASE_URL first.
    with TestClient(create_app()) as test_client:
        yield test_client


def add_account(user_ids: list[uuid.UUID], role: UserRole) -> str:
    """Create an account with a real password hash; return its phone."""
    phone = "+234809" + "".join(secrets.choice("0123456789") for _ in range(7))

    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        async with sessions() as session:
            user = await auth_service.create_user(
                session, name=f"Sample {role.value}", phone=phone, password=PASSWORD, role=role
            )
        user_ids.append(user.id)

    run(scenario)
    return phone


def sign_in(client: TestClient, phone: str) -> dict[str, str]:
    """Sign in as ``phone`` (replacing any session); return the CSRF header."""
    client.cookies.clear()
    response = client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {CSRF_HEADER_NAME: response.json()["csrf_token"]}


def order_body(**changes: object) -> dict[str, object]:
    body: dict[str, object] = {
        "idempotency_key": str(uuid.uuid4()),
        "quantity_litres": 200,
        "contact_name": "Sample Customer",
        "contact_phone": "08000000001",
        "delivery_address": "12 Sample Close, Independence Layout, Enugu",
    }
    body.update(changes)
    return body


def set_created_at(reference: str, created_at: str, *, is_simulated: bool = False) -> None:
    """Back-date an order (and optionally flag it simulated) directly in the database."""
    url = get_settings().sync_database_url.set(drivername="postgresql")
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        connection.execute(
            "UPDATE orders SET created_at = %s, is_simulated = %s WHERE reference = %s",
            (created_at, is_simulated, reference),
        )


def test_t06_http_duplicate_checkout_creates_one_order(
    http: TestClient, created_user_ids: list[uuid.UUID]
) -> None:
    headers = sign_in(http, add_account(created_user_ids, UserRole.CUSTOMER))
    body = order_body()

    first = http.post("/api/v1/orders", json=body, headers=headers)
    retry = http.post("/api/v1/orders", json=body, headers=headers)
    changed = http.post("/api/v1/orders", json={**body, "quantity_litres": 500}, headers=headers)

    assert first.status_code == 201, first.text
    assert first.json()["status"] == "quote_requested"
    assert first.json()["contact_phone"] == "+2348000000001"
    assert retry.status_code == 200
    assert retry.json() == first.json()
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "idempotency_key_reused"
    assert changed.json()["error"]["message"] == IDEMPOTENCY_KEY_REUSED_MESSAGE
    page = http.get("/api/v1/orders").json()
    assert page["total"] == 1
    assert page["items"] == [first.json()]


def test_t07_http_customer_cannot_read_another_customers_order(
    http: TestClient, created_user_ids: list[uuid.UUID]
) -> None:
    owner_headers = sign_in(http, add_account(created_user_ids, UserRole.CUSTOMER))
    created = http.post("/api/v1/orders", json=order_body(), headers=owner_headers)
    reference = created.json()["reference"]
    assert http.get(f"/api/v1/orders/{reference}").status_code == 200

    sign_in(http, add_account(created_user_ids, UserRole.CUSTOMER))
    others = http.get(f"/api/v1/orders/{reference}")
    missing = http.get("/api/v1/orders/MO-0000000000")

    assert others.status_code == missing.status_code == 404
    assert others.json() == missing.json()
    assert others.json()["error"]["code"] == "order_not_found"
    assert http.get("/api/v1/orders").json()["total"] == 0

    sign_in(http, add_account(created_user_ids, UserRole.DRIVER))
    driver = http.get(f"/api/v1/admin/orders/{reference}")
    assert driver.status_code == 403
    assert driver.json()["error"]["code"] == "forbidden"


def test_admin_sees_any_order_with_its_customer(
    http: TestClient, created_user_ids: list[uuid.UUID]
) -> None:
    customer_phone = add_account(created_user_ids, UserRole.CUSTOMER)
    headers = sign_in(http, customer_phone)
    order = http.post("/api/v1/orders", json=order_body(), headers=headers).json()

    sign_in(http, add_account(created_user_ids, UserRole.ADMIN))
    response = http.get(f"/api/v1/admin/orders/{order['reference']}")

    assert response.status_code == 200
    detail = response.json()
    assert {key: detail[key] for key in order} == order
    assert detail["is_simulated"] is False
    assert detail["customer"]["phone"] == customer_phone
    assert detail["customer"]["phone_verified"] is False


def test_admin_filters_by_status_lagos_dates_and_simulated_flag(
    http: TestClient, created_user_ids: list[uuid.UUID]
) -> None:
    headers = sign_in(http, add_account(created_user_ids, UserRole.CUSTOMER))
    refs = [
        http.post("/api/v1/orders", json=order_body(), headers=headers).json()["reference"]
        for _ in range(3)
    ]
    # Dates no other data uses. Lagos is UTC+1, so 23:00 UTC on 1 January is
    # already 2 January in Lagos.
    set_created_at(refs[0], "2001-01-01T22:59:59+00:00")  # Lagos 1 Jan 23:59:59
    set_created_at(refs[1], "2001-01-01T23:00:00+00:00")  # Lagos 2 Jan 00:00
    set_created_at(refs[2], "2001-01-02T22:59:59+00:00", is_simulated=True)  # 2 Jan 23:59:59

    sign_in(http, add_account(created_user_ids, UserRole.ADMIN))

    def found(query: str) -> list[str]:
        response = http.get(f"/api/v1/admin/orders?{query}")
        assert response.status_code == 200, response.text
        return [item["reference"] for item in response.json()["items"]]

    jan_2 = "created_from=2001-01-02&created_to=2001-01-02"
    assert found(jan_2) == [refs[2], refs[1]]
    assert found(f"{jan_2}&is_simulated=true") == [refs[2]]
    assert found(f"{jan_2}&is_simulated=false") == [refs[1]]
    assert found("created_from=2001-01-01&created_to=2001-01-01") == [refs[0]]
    assert found(f"{jan_2}&status=quote_requested&status=confirmed") == [refs[2], refs[1]]
    assert found(f"{jan_2}&status=confirmed") == []
    assert found(f"{jan_2}&limit=1&offset=1") == [refs[1]]
