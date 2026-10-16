"""Order endpoint tests that need no database (docs/api/orders.md).

Session lookup and the orders service are replaced with in-memory fakes, so
these cover roles (FR-001), CSRF, request and query validation, status codes
and response shapes. Database behavior is in test_orders_integration.py.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth import security
from app.modules.auth import service as auth_service
from app.modules.auth.dependencies import CSRF_HEADER_NAME, SESSION_COOKIE_NAME
from app.modules.auth.models import User, UserRole, UserSession
from app.modules.orders import service
from app.modules.orders.models import Order, OrderStatus
from app.modules.orders.service import NewOrder, StaffOrder
from app.shared import lagos_time

USERS = {
    role: User(
        id=uuid.uuid4(),
        name=f"Sample {role.value}",
        phone="+2348000000001",
        password_hash="x",
        role=role,
        phone_verified_at=None,
    )
    for role in UserRole
}

CUSTOMER_ENDPOINTS = [("POST", "/api/v1/orders"), ("GET", "/api/v1/orders")]
CUSTOMER_ENDPOINTS.append(("GET", "/api/v1/orders/MO-7KQ2M9XH4T"))
ADMIN_ENDPOINTS = [("GET", "/api/v1/admin/orders"), ("GET", "/api/v1/admin/orders/MO-7KQ2M9XH4T")]

VALID_BODY: dict[str, Any] = {
    "idempotency_key": "5b0e2c3a-7d1f-4e8a-b6c9-0a1b2c3d4e5f",
    "quantity_litres": 200,
    "contact_name": "Sample Customer",
    "contact_phone": "08000000001",
    "delivery_address": "12 Sample Close, Independence Layout, Enugu",
    "landmark": "Opposite the blue gate",
    "delivery_instructions": "Tank is behind the house",
}


def make_order(**changes: Any) -> Order:
    created = datetime(2026, 10, 14, 9, 30, tzinfo=UTC)
    fields: dict[str, Any] = {
        "id": uuid.uuid4(),
        "reference": "MO-7KQ2M9XH4T",
        "customer_id": USERS[UserRole.CUSTOMER].id,
        "idempotency_key": uuid.uuid4(),
        "status": OrderStatus.QUOTE_REQUESTED,
        "quantity_litres": 200,
        "contact_name": "Sample Customer",
        "contact_phone": "+2348000000001",
        "delivery_address": "12 Sample Close, Independence Layout, Enugu",
        "landmark": None,
        "delivery_instructions": None,
        "preferred_delivery_date": None,
        "is_simulated": False,
        "created_at": created,
        "updated_at": created,
    }
    fields.update(changes)
    return Order(**fields)


class FakeOrders:
    """Records service calls and returns canned results."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.created = True
        self.error: APIError | None = None

    async def create_order(self, _: object, **kwargs: Any) -> tuple[Order, bool]:
        self.calls.append(("create_order", kwargs))
        if self.error:
            raise self.error
        return make_order(), self.created

    async def list_customer_orders(self, _: object, **kwargs: Any) -> tuple[list[Order], int]:
        self.calls.append(("list_customer_orders", kwargs))
        return [make_order()], 1

    async def get_customer_order(self, _: object, **kwargs: Any) -> Order:
        self.calls.append(("get_customer_order", kwargs))
        if self.error:
            raise self.error
        return make_order()

    async def list_orders_for_staff(self, _: object, **kwargs: Any) -> tuple[list[StaffOrder], int]:
        self.calls.append(("list_orders_for_staff", kwargs))
        item = StaffOrder(order=make_order(is_simulated=True), customer=USERS[UserRole.CUSTOMER])
        return [item], 1

    async def get_order_for_staff(self, _: object, **kwargs: Any) -> StaffOrder:
        self.calls.append(("get_order_for_staff", kwargs))
        if self.error:
            raise self.error
        return StaffOrder(order=make_order(), customer=USERS[UserRole.CUSTOMER])


@pytest.fixture
def fake_orders(monkeypatch: pytest.MonkeyPatch) -> FakeOrders:
    fake = FakeOrders()
    for name in (
        "create_order",
        "list_customer_orders",
        "get_customer_order",
        "list_orders_for_staff",
        "get_order_for_staff",
    ):
        monkeypatch.setattr(service, name, getattr(fake, name))
    return fake


@pytest.fixture
def api(client: TestClient, monkeypatch: pytest.MonkeyPatch, fake_orders: FakeOrders) -> TestClient:
    """Client whose session cookie value names the signed-in role."""

    async def lookup(_: object, token: str) -> auth_service.AuthenticatedSession | None:
        try:
            user = USERS[UserRole(token)]
        except ValueError:
            return None
        user_session = UserSession(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash="x",
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        return auth_service.AuthenticatedSession(user=user, session=user_session, token=token)

    monkeypatch.setattr(auth_service, "get_authenticated_session", lookup)
    return client


def sign_in(client: TestClient, role: UserRole) -> dict[str, str]:
    """Set the role's cookie and return headers including its CSRF token."""
    client.cookies.set(SESSION_COOKIE_NAME, role.value)
    secret = get_settings().session_secret.get_secret_value()
    return {CSRF_HEADER_NAME: security.csrf_token_for(role.value, secret)}


def call(client: TestClient, method: str, path: str, headers: dict[str, str]) -> Any:
    if method == "POST":
        return client.post(path, json=VALID_BODY, headers=headers)
    return client.get(path, headers=headers)


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


# --- Authentication and roles (FR-001) --------------------------------------


@pytest.mark.parametrize(("method", "path"), CUSTOMER_ENDPOINTS + ADMIN_ENDPOINTS)
def test_signed_out_requests_are_not_authenticated(api: TestClient, method: str, path: str) -> None:
    response = call(api, method, path, {})
    assert response.status_code == 401
    assert error_code(response) == "not_authenticated"


@pytest.mark.parametrize(("method", "path"), CUSTOMER_ENDPOINTS + ADMIN_ENDPOINTS)
def test_t07_drivers_are_forbidden_everywhere(api: TestClient, method: str, path: str) -> None:
    response = call(api, method, path, sign_in(api, UserRole.DRIVER))
    assert response.status_code == 403
    assert error_code(response) == "forbidden"


@pytest.mark.parametrize(("method", "path"), ADMIN_ENDPOINTS)
def test_customers_cannot_use_admin_endpoints(api: TestClient, method: str, path: str) -> None:
    response = call(api, method, path, sign_in(api, UserRole.CUSTOMER))
    assert response.status_code == 403
    assert error_code(response) == "forbidden"


@pytest.mark.parametrize(("method", "path"), CUSTOMER_ENDPOINTS)
def test_admins_cannot_use_customer_endpoints(api: TestClient, method: str, path: str) -> None:
    response = call(api, method, path, sign_in(api, UserRole.ADMIN))
    assert response.status_code == 403
    assert error_code(response) == "forbidden"


def test_create_requires_csrf_token(api: TestClient, fake_orders: FakeOrders) -> None:
    sign_in(api, UserRole.CUSTOMER)
    response = api.post("/api/v1/orders", json=VALID_BODY)
    assert response.status_code == 403
    assert error_code(response) == "csrf_failed"
    assert fake_orders.calls == []


# --- POST /orders -------------------------------------------------------------


def test_create_returns_201_and_normalizes_input(api: TestClient, fake_orders: FakeOrders) -> None:
    body = {
        **VALID_BODY,
        "contact_name": "  Sample Customer  ",
        "landmark": "   ",
        "preferred_delivery_date": lagos_time.lagos_today().isoformat(),
    }
    response = api.post("/api/v1/orders", json=body, headers=sign_in(api, UserRole.CUSTOMER))

    assert response.status_code == 201
    name, kwargs = fake_orders.calls[0]
    assert name == "create_order"
    assert kwargs["customer_id"] == USERS[UserRole.CUSTOMER].id
    assert kwargs["request"] == NewOrder(
        idempotency_key=uuid.UUID(VALID_BODY["idempotency_key"]),
        quantity_litres=200,
        contact_name="Sample Customer",
        contact_phone="+2348000000001",
        delivery_address=VALID_BODY["delivery_address"],
        landmark=None,
        delivery_instructions="Tank is behind the house",
        preferred_delivery_date=lagos_time.lagos_today(),
    )
    # A normal customer's order is real (BR-09).
    assert kwargs["is_simulated"] is False


@pytest.mark.parametrize(
    ("name", "phone", "simulated"),
    [
        ("Demo Customer One", "+2348000090011", True),
        ("Demo Customer One", "+2348000000011", False),  # not a reserved number
        ("Real Person", "+2348000090011", False),  # reserved number, real name
    ],
)
def test_orders_from_demo_accounts_are_simulated(
    api: TestClient,
    fake_orders: FakeOrders,
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    phone: str,
    simulated: bool,
) -> None:
    customer = USERS[UserRole.CUSTOMER]
    monkeypatch.setattr(customer, "name", name)
    monkeypatch.setattr(customer, "phone", phone)

    response = api.post("/api/v1/orders", json=VALID_BODY, headers=sign_in(api, UserRole.CUSTOMER))

    assert response.status_code == 201
    assert fake_orders.calls[0][1]["is_simulated"] is simulated


def test_t06_idempotent_retry_returns_200(api: TestClient, fake_orders: FakeOrders) -> None:
    fake_orders.created = False
    response = api.post("/api/v1/orders", json=VALID_BODY, headers=sign_in(api, UserRole.CUSTOMER))
    assert response.status_code == 200
    assert response.json()["reference"] == "MO-7KQ2M9XH4T"


def test_reused_key_with_different_details_is_409(api: TestClient, fake_orders: FakeOrders) -> None:
    fake_orders.error = APIError(409, "idempotency_key_reused", "Already submitted")
    response = api.post("/api/v1/orders", json=VALID_BODY, headers=sign_in(api, UserRole.CUSTOMER))
    assert response.status_code == 409
    assert error_code(response) == "idempotency_key_reused"


def test_customer_response_matches_contract(api: TestClient) -> None:
    response = api.post("/api/v1/orders", json=VALID_BODY, headers=sign_in(api, UserRole.CUSTOMER))
    order = response.json()
    assert set(order) == {
        "reference",
        "status",
        "quantity_litres",
        "contact_name",
        "contact_phone",
        "delivery_address",
        "landmark",
        "delivery_instructions",
        "preferred_delivery_date",
        "created_at",
        "updated_at",
    }
    assert order["status"] == "quote_requested"
    assert order["created_at"] == "2026-10-14T09:30:00Z"


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"quantity_litres": 0}, "quantity_litres"),
        ({"quantity_litres": 100_001}, "quantity_litres"),
        ({"quantity_litres": "200"}, "quantity_litres"),
        ({"quantity_litres": 200.5}, "quantity_litres"),
        ({"quantity_litres": True}, "quantity_litres"),
        ({"contact_name": "   "}, "contact_name"),
        ({"contact_name": "x" * 101}, "contact_name"),
        ({"contact_phone": "12345"}, "contact_phone"),
        ({"delivery_address": "  abc  "}, "delivery_address"),
        ({"delivery_address": "x" * 501}, "delivery_address"),
        ({"landmark": "x" * 201}, "landmark"),
        ({"delivery_instructions": "x" * 501}, "delivery_instructions"),
        ({"idempotency_key": "not-a-uuid"}, "idempotency_key"),
        ({"is_simulated": True}, "is_simulated"),
        ({"status": "confirmed"}, "status"),
        ({"total_minor_units": 1}, "total_minor_units"),
    ],
)
def test_invalid_create_bodies_are_rejected(
    api: TestClient, fake_orders: FakeOrders, changes: dict[str, Any], field: str
) -> None:
    body = {**VALID_BODY, **changes}
    response = api.post("/api/v1/orders", json=body, headers=sign_in(api, UserRole.CUSTOMER))

    assert response.status_code == 422
    assert error_code(response) == "validation_error"
    assert ["body", field] in [detail["loc"][:2] for detail in response.json()["error"]["details"]]
    assert fake_orders.calls == []


@pytest.mark.parametrize("missing", ["idempotency_key", "quantity_litres", "contact_name"])
def test_required_fields_are_required(api: TestClient, missing: str) -> None:
    body = {key: value for key, value in VALID_BODY.items() if key != missing}
    response = api.post("/api/v1/orders", json=body, headers=sign_in(api, UserRole.CUSTOMER))
    assert response.status_code == 422


def test_preferred_date_in_the_past_is_rejected(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lagos_time, "lagos_today", lambda: date(2026, 10, 16))
    body = {**VALID_BODY, "preferred_delivery_date": "2026-10-15"}
    response = api.post("/api/v1/orders", json=body, headers=sign_in(api, UserRole.CUSTOMER))

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "preferred_delivery_date"]


# --- Customer reads -------------------------------------------------------------


def test_list_my_orders_uses_defaults_and_page_shape(
    api: TestClient, fake_orders: FakeOrders
) -> None:
    response = api.get("/api/v1/orders", headers=sign_in(api, UserRole.CUSTOMER))

    assert response.status_code == 200
    page = response.json()
    assert (page["total"], page["limit"], page["offset"]) == (1, 50, 0)
    assert "is_simulated" not in page["items"][0]
    assert fake_orders.calls[0][1] == {
        "customer_id": USERS[UserRole.CUSTOMER].id,
        "limit": 50,
        "offset": 0,
    }


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1", "limit=abc"])
def test_invalid_paging_is_rejected(api: TestClient, query: str) -> None:
    response = api.get(f"/api/v1/orders?{query}", headers=sign_in(api, UserRole.CUSTOMER))
    assert response.status_code == 422
    assert error_code(response) == "validation_error"


def test_order_not_found_passes_through(api: TestClient, fake_orders: FakeOrders) -> None:
    fake_orders.error = APIError(404, "order_not_found", "Order not found")
    response = api.get("/api/v1/orders/MO-0000000000", headers=sign_in(api, UserRole.CUSTOMER))
    assert response.status_code == 404
    assert error_code(response) == "order_not_found"
    assert fake_orders.calls[0][1]["customer_id"] == USERS[UserRole.CUSTOMER].id


# --- Admin reads ------------------------------------------------------------------


def test_admin_list_passes_filters(api: TestClient, fake_orders: FakeOrders) -> None:
    response = api.get(
        "/api/v1/admin/orders?status=quote_requested&status=confirmed"
        "&created_from=2026-10-01&created_to=2026-10-14&is_simulated=false&limit=20&offset=40",
        headers=sign_in(api, UserRole.ADMIN),
    )

    assert response.status_code == 200
    assert fake_orders.calls[0][1] == {
        "statuses": [OrderStatus.QUOTE_REQUESTED, OrderStatus.CONFIRMED],
        "created_from": date(2026, 10, 1),
        "created_to": date(2026, 10, 14),
        "is_simulated": False,
        "limit": 20,
        "offset": 40,
    }
    assert (response.json()["limit"], response.json()["offset"]) == (20, 40)


def test_admin_list_without_filters_means_all(api: TestClient, fake_orders: FakeOrders) -> None:
    api.get("/api/v1/admin/orders", headers=sign_in(api, UserRole.ADMIN))
    assert fake_orders.calls[0][1] == {
        "statuses": [],
        "created_from": None,
        "created_to": None,
        "is_simulated": None,
        "limit": 50,
        "offset": 0,
    }


def test_admin_order_includes_customer_and_simulated_flag(api: TestClient) -> None:
    response = api.get("/api/v1/admin/orders", headers=sign_in(api, UserRole.ADMIN))

    item = response.json()["items"][0]
    customer = USERS[UserRole.CUSTOMER]
    assert item["is_simulated"] is True
    assert item["customer"] == {
        "id": str(customer.id),
        "name": customer.name,
        "phone": customer.phone,
        "phone_verified": False,
    }
    assert uuid.UUID(item["id"])


@pytest.mark.parametrize(
    ("query", "parameter"),
    [
        ("status=draft", "status"),
        ("created_from=2026-13-01", "created_from"),
        ("created_from=2026-10-14&created_to=2026-10-13", "created_to"),
        ("is_simulated=maybe", "is_simulated"),
        ("limit=101", "limit"),
    ],
)
def test_invalid_admin_filters_name_the_parameter(
    api: TestClient, fake_orders: FakeOrders, query: str, parameter: str
) -> None:
    response = api.get(f"/api/v1/admin/orders?{query}", headers=sign_in(api, UserRole.ADMIN))

    assert response.status_code == 422
    assert error_code(response) == "validation_error"
    assert parameter in response.json()["error"]["details"][0]["loc"]
    assert fake_orders.calls == []


def test_admin_detail_not_found(api: TestClient, fake_orders: FakeOrders) -> None:
    fake_orders.error = APIError(404, "order_not_found", "Order not found")
    response = api.get("/api/v1/admin/orders/MO-0000000000", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 404
    assert error_code(response) == "order_not_found"
