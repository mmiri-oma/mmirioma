"""Admin dispatch endpoint tests that need no database (docs/api/deliveries.md).

Session lookup and the dispatch service are replaced with in-memory fakes,
so these cover roles (FR-001, T-07), CSRF, request validation, status codes
and response shapes against the contract's examples. Database behaviour is
in test_dispatch_integration.py.

The order detail, withdraw and history are served by the deliveries admin
router since the hold review (#93); here the hold lookups are faked too (no
open hold), so these tests keep checking the agreed dispatch shapes. Holds
themselves are covered in test_hold_review_api.py.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth import security
from app.modules.auth import service as auth_service
from app.modules.auth.dependencies import CSRF_HEADER_NAME, SESSION_COOKIE_NAME
from app.modules.auth.models import User, UserRole, UserSession
from app.modules.confirmation import service as confirmation_service
from app.modules.deliveries import holds
from app.modules.dispatch import service
from app.modules.dispatch.models import (
    Assignment,
    AssignmentStatus,
    DeclineReason,
    VehicleProfile,
)
from app.modules.dispatch.service import Ineligibility
from app.modules.orders.models import (
    ConfirmationSmsStatus,
    Order,
    OrderEvent,
    OrderStatus,
    TransitionReason,
)
from app.modules.orders.service import StaffOrder
from app.modules.pricing.models import AgreementMethod, OrderPriceSnapshot
from app.modules.sources.models import WaterCategory, WaterSource

EXAMPLES = Path(__file__).resolve().parents[2] / "docs" / "api" / "examples"
REFERENCE = "MO-7KQ2M9XH4T"
BASE = f"/api/v1/admin/orders/{REFERENCE}"
OFFERED_AT = datetime(2026, 10, 19, 9, 5, tzinfo=UTC)

USERS = {
    role: User(
        id=uuid.uuid4(),
        name=f"Sample {role.value}",
        phone="+2348000000001",
        password_hash="x",
        role=role,
        phone_verified_at=datetime(2026, 10, 1, tzinfo=UTC),
    )
    for role in UserRole
}
DRIVER = USERS[UserRole.DRIVER]
ADMIN = USERS[UserRole.ADMIN]
TRUCK = VehicleProfile(id=uuid.uuid4(), vehicle_type="Tanker truck", safe_payload_litres=3000)

ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", BASE, None),
    ("GET", f"{BASE}/drivers", None),
    ("POST", f"{BASE}/assign", {"driver_id": str(DRIVER.id)}),
    ("POST", f"{BASE}/withdraw", {"expected_status": "offered"}),
    ("GET", f"{BASE}/history", None),
]
POSTS = [endpoint for endpoint in ENDPOINTS if endpoint[0] == "POST"]


def make_order(**changes: Any) -> Order:
    created = datetime(2026, 10, 19, 7, 40, tzinfo=UTC)
    fields: dict[str, Any] = {
        "id": uuid.uuid4(),
        "reference": REFERENCE,
        "customer_id": USERS[UserRole.CUSTOMER].id,
        "idempotency_key": uuid.uuid4(),
        "status": OrderStatus.ASSIGNED,
        "quantity_litres": 2000,
        "contact_name": "Sample Customer",
        "contact_phone": "+2348000000001",
        "delivery_address": "12 Sample Close, Independence Layout, Enugu",
        "landmark": None,
        "delivery_instructions": None,
        "preferred_delivery_date": None,
        "is_simulated": True,
        "created_at": created,
        "updated_at": OFFERED_AT,
        # Confirmed before it was offered (order confirmation, #113).
        "delivery_window_start_at": datetime(2026, 10, 20, 9, tzinfo=UTC),
        "delivery_window_end_at": datetime(2026, 10, 20, 11, tzinfo=UTC),
        "confirmation_sms_status": ConfirmationSmsStatus.ACCEPTED,
        "confirmation_sms_attempted_at": datetime(2026, 10, 19, 8, 51, 2, tzinfo=UTC),
    }
    fields.update(changes)
    return Order(**fields)


POTABLE = WaterCategory(id=uuid.uuid4(), code="potable", label="Potable Water")
BOREHOLE = WaterSource(id=uuid.uuid4(), name="Sample Borehole A", approximate_location="Ugwuaji")


def confirmed_view() -> confirmation_service.ConfirmationView:
    """What the detail shows for an order confirmed with a manual quote."""
    snapshot = OrderPriceSnapshot(
        id=uuid.uuid4(),
        order_id=uuid.uuid4(),
        event_id=uuid.uuid4(),
        total_minor_units=4_500_000,
        currency="NGN",
        is_manual=True,
        water_category_id=POTABLE.id,
        water_category_label=POTABLE.label,
        source_id=BOREHOLE.id,
        delivery_window_start_at=datetime(2026, 10, 20, 9, tzinfo=UTC),
        delivery_window_end_at=datetime(2026, 10, 20, 11, tzinfo=UTC),
        entered_by=ADMIN.id,
        entered_at=datetime(2026, 10, 19, 8, 51, tzinfo=UTC),
        customer_agreement_method=AgreementMethod.PHONE_CALL,
        customer_agreed_at=datetime(2026, 10, 19, 8, 45, tzinfo=UTC),
    )
    return confirmation_service.ConfirmationView(
        water_category=POTABLE,
        source=confirmation_service.ConfirmedSource(
            source=BOREHOLE, report_reference="LR-0001", reasons=[]
        ),
        snapshot=snapshot,
        entered_by=ADMIN,
    )


def make_assignment(**changes: Any) -> Assignment:
    fields: dict[str, Any] = {
        "id": uuid.uuid4(),
        "order_id": uuid.uuid4(),
        "driver_user_id": DRIVER.id,
        "status": AssignmentStatus.OFFERED,
        "offered_by": ADMIN.id,
        "responded_at": None,
        "ended_at": None,
        "decline_reason": None,
        "decline_note": None,
        "created_at": OFFERED_AT,
        "updated_at": OFFERED_AT,
    }
    fields.update(changes)
    return Assignment(**fields)


def dispatch_order(assignment: Assignment | None) -> service.DispatchOrder:
    view = (
        None
        if assignment is None
        else service.AssignmentView(
            assignment=assignment, driver=DRIVER, vehicle=TRUCK, offered_by=ADMIN
        )
    )
    return service.DispatchOrder(
        staff_order=StaffOrder(order=make_order(), customer=USERS[UserRole.CUSTOMER]),
        assignment=view,
    )


class FakeDispatch:
    """Records service calls and returns canned results."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.error: APIError | None = None
        self.created = True
        self.order = dispatch_order(make_assignment())
        self.attempts: tuple[datetime, ...] = ()

    def _record(self, name: str, kwargs: dict[str, Any]) -> None:
        self.calls.append((name, kwargs))
        if self.error:
            raise self.error

    async def get_dispatch_order(self, _: object, **kwargs: Any) -> service.DispatchOrder:
        self._record("get_dispatch_order", kwargs)
        return self.order

    async def list_drivers_for_order(self, _: object, **kwargs: Any) -> list[service.DriverChoice]:
        self._record("list_drivers_for_order", kwargs)
        return [
            service.DriverChoice(driver=DRIVER, vehicle=TRUCK, reasons=[]),
            service.DriverChoice(
                driver=USERS[UserRole.CUSTOMER],
                vehicle=None,
                reasons=[Ineligibility.NO_DRIVER_PROFILE],
            ),
        ]

    async def offer_order(self, _: object, **kwargs: Any) -> tuple[service.DispatchOrder, bool]:
        self._record("offer_order", kwargs)
        return self.order, self.created

    async def withdraw_job(self, _: object, **kwargs: Any) -> holds.OrderDetail:
        self._record("withdraw_job", kwargs)
        return holds.OrderDetail(
            dispatch=self.order,
            hold=None,
            confirmation=confirmed_view(),
            contact_attempts=self.attempts,
        )

    async def contact_attempt_times(self, _: object, order_id: uuid.UUID) -> tuple[datetime, ...]:
        return self.attempts

    async def current_holds(self, _: object, order_ids: object) -> dict[uuid.UUID, Any]:
        return {}

    async def order_history(self, _: object, **kwargs: Any) -> list[service.HistoryEntry]:
        self._record("order_history", kwargs)
        declined = make_assignment(
            status=AssignmentStatus.DECLINED, decline_reason=DeclineReason.VEHICLE_CANNOT_CARRY
        )
        decline = OrderEvent(
            id=uuid.uuid4(),
            order_id=uuid.uuid4(),
            actor_id=DRIVER.id,
            from_status=OrderStatus.ASSIGNED,
            to_status=OrderStatus.CONFIRMED,
            reason_code=TransitionReason.DRIVER_DECLINED,
            note="Truck is at the mechanic.",
            assignment_id=declined.id,
            created_at=OFFERED_AT,
        )
        created = OrderEvent(
            id=uuid.uuid4(),
            order_id=uuid.uuid4(),
            actor_id=None,
            from_status=None,
            to_status=OrderStatus.QUOTE_REQUESTED,
            reason_code=None,
            note=None,
            assignment_id=None,
            created_at=OFFERED_AT - timedelta(hours=1),
        )
        return [
            service.HistoryEntry(
                event=decline,
                actor=DRIVER,
                assignment=declined,
                assignment_driver=DRIVER,
                decline_reason=DeclineReason.VEHICLE_CANNOT_CARRY,
            ),
            service.HistoryEntry(
                event=created,
                actor=None,
                assignment=None,
                assignment_driver=None,
                decline_reason=None,
            ),
        ]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeDispatch:
    fake = FakeDispatch()
    for name in (
        "get_dispatch_order",
        "list_drivers_for_order",
        "offer_order",
        "order_history",
    ):
        monkeypatch.setattr(service, name, getattr(fake, name))
    monkeypatch.setattr(holds, "withdraw_job", fake.withdraw_job)
    monkeypatch.setattr(holds, "current_holds", fake.current_holds)
    monkeypatch.setattr(holds, "contact_attempt_times", fake.contact_attempt_times)

    async def view(*_args: object, **_kwargs: object) -> confirmation_service.ConfirmationView:
        return confirmed_view()

    async def lines(*_args: object, **_kwargs: object) -> dict[uuid.UUID, object]:
        return {}

    monkeypatch.setattr(confirmation_service, "confirmation_view", view)
    monkeypatch.setattr(confirmation_service, "confirmation_lines", lines)
    return fake


@pytest.fixture
def api(client: TestClient, monkeypatch: pytest.MonkeyPatch, fake: FakeDispatch) -> TestClient:
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


def call(
    client: TestClient,
    method: str,
    path: str,
    body: dict[str, Any] | None,
    headers: dict[str, str],
) -> Any:
    if method == "POST":
        return client.post(path, json=body, headers=headers)
    return client.get(path, headers=headers)


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


def keys(value: Any) -> Any:
    """The nested key structure of a JSON value, for comparing shapes."""
    if isinstance(value, dict):
        return {key: keys(item) for key, item in value.items()}
    if isinstance(value, list):
        return [keys(value[0])] if value else []
    return None


# --- Access (FR-001, T-07) ---------------------------------------------------


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_signed_out_requests_are_not_authenticated(
    api: TestClient, fake: FakeDispatch, method: str, path: str, body: dict[str, Any] | None
) -> None:
    response = call(api, method, path, body, {})
    assert (response.status_code, error_code(response)) == (401, "not_authenticated")
    assert fake.calls == []


@pytest.mark.parametrize("role", [UserRole.CUSTOMER, UserRole.DRIVER])
@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_t07_only_admins_may_dispatch(
    api: TestClient,
    fake: FakeDispatch,
    role: UserRole,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    response = call(api, method, path, body, sign_in(api, role))
    assert (response.status_code, error_code(response)) == (403, "forbidden")
    assert fake.calls == []


@pytest.mark.parametrize(("method", "path", "body"), POSTS)
def test_posts_require_the_csrf_token(
    api: TestClient, fake: FakeDispatch, method: str, path: str, body: dict[str, Any] | None
) -> None:
    sign_in(api, UserRole.ADMIN)
    response = call(api, method, path, body, {})
    assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert fake.calls == []


# --- Detail (D2-D4) ------------------------------------------------------------


def test_detail_matches_the_contract_example(api: TestClient, fake: FakeDispatch) -> None:
    response = api.get(BASE, headers=sign_in(api, UserRole.ADMIN))

    assert response.status_code == 200
    body = response.json()
    example = json.loads((EXAMPLES / "admin-order-detail.json").read_text(encoding="utf-8"))
    # The fixture order has no payment status (not built through confirmation),
    # so its payment card is null; the example's is a confirmed order's.
    assert keys(body) == keys(example) | {"payment": None}
    assert body["payment"] is None
    assert body["assignment"]["status"] == "offered"
    assert body["assignment"]["driver"] == {"id": str(DRIVER.id), "name": DRIVER.name}
    assert body["assignment"]["vehicle"] == {"type": "Tanker truck", "safe_payload_litres": 3000}
    assert body["assignment"]["offered_by"] == {"id": str(ADMIN.id), "name": ADMIN.name}
    assert body["assignment"]["offered_at"] == "2026-10-19T09:05:00Z"
    assert fake.calls == [("get_dispatch_order", {"reference": REFERENCE})]


def test_detail_of_an_order_never_offered_has_no_assignment(
    api: TestClient, fake: FakeDispatch
) -> None:
    fake.order = dispatch_order(None)
    response = api.get(BASE, headers=sign_in(api, UserRole.ADMIN))
    assert response.json()["assignment"] is None


def test_detail_not_found(api: TestClient, fake: FakeDispatch) -> None:
    fake.error = APIError(404, "order_not_found", "Order not found")
    response = api.get(BASE, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (404, "order_not_found")


# --- Drivers (D1) --------------------------------------------------------------


def test_driver_list_matches_the_contract_example(api: TestClient) -> None:
    response = api.get(f"{BASE}/drivers", headers=sign_in(api, UserRole.ADMIN))

    assert response.status_code == 200
    items = response.json()["items"]
    example = json.loads((EXAMPLES / "dispatch-drivers.json").read_text(encoding="utf-8"))
    assert keys(items[0]) == keys(example["items"][0])
    assert items[0]["reasons"] == []
    assert items[1] == {
        "id": str(USERS[UserRole.CUSTOMER].id),
        "name": USERS[UserRole.CUSTOMER].name,
        "vehicle": None,
        "reasons": ["no_driver_profile"],
    }


# --- Assign (D1, row 8) ------------------------------------------------------------


ATTEMPTS = (datetime(2026, 10, 20, 9, 44, tzinfo=UTC), datetime(2026, 10, 20, 9, 49, tzinfo=UTC))


def test_detail_sends_the_contact_attempts_oldest_first(
    api: TestClient, fake: FakeDispatch
) -> None:
    """#280: a failed delivery's attempts reach the dispatcher as times only."""
    fake.attempts = ATTEMPTS
    body = api.get(BASE, headers=sign_in(api, UserRole.ADMIN)).json()

    assert body["contact_attempts"] == [
        {"attempted_at": "2026-10-20T09:44:00Z"},
        {"attempted_at": "2026-10-20T09:49:00Z"},
    ]


def test_detail_sends_an_empty_list_when_no_attempt_was_recorded(
    api: TestClient, fake: FakeDispatch
) -> None:
    assert api.get(BASE, headers=sign_in(api, UserRole.ADMIN)).json()["contact_attempts"] == []


def test_detail_matches_the_failed_order_example(api: TestClient, fake: FakeDispatch) -> None:
    fake.attempts = ATTEMPTS
    body = api.get(BASE, headers=sign_in(api, UserRole.ADMIN)).json()
    example = json.loads((EXAMPLES / "admin-order-detail-failed.json").read_text(encoding="utf-8"))

    assert keys(body) == keys(example) | {"payment": None}
    assert body["contact_attempts"] == example["contact_attempts"]


def test_assign_carries_the_contact_attempts_too(api: TestClient, fake: FakeDispatch) -> None:
    """The admin client replaces its cached detail with every response (#280)."""
    fake.attempts = ATTEMPTS
    response = api.post(
        f"{BASE}/assign", json={"driver_id": str(DRIVER.id)}, headers=sign_in(api, UserRole.ADMIN)
    )

    assert response.status_code == 201
    assert len(response.json()["contact_attempts"]) == 2


def test_withdraw_carries_the_contact_attempts_too(api: TestClient, fake: FakeDispatch) -> None:
    fake.attempts = ATTEMPTS
    response = api.post(
        f"{BASE}/withdraw",
        json={"expected_status": "offered"},
        headers=sign_in(api, UserRole.ADMIN),
    )

    assert response.status_code == 200
    assert len(response.json()["contact_attempts"]) == 2


def test_assign_returns_201_with_the_order(api: TestClient, fake: FakeDispatch) -> None:
    response = api.post(
        f"{BASE}/assign", json={"driver_id": str(DRIVER.id)}, headers=sign_in(api, UserRole.ADMIN)
    )

    assert response.status_code == 201
    assert response.json()["status"] == "assigned"
    assert response.json()["assignment"]["status"] == "offered"
    name, kwargs = fake.calls[0]
    assert name == "offer_order"
    assert kwargs["reference"] == REFERENCE
    assert kwargs["driver_user_id"] == DRIVER.id
    assert kwargs["admin"] is ADMIN


def test_a_repeated_offer_returns_200(api: TestClient, fake: FakeDispatch) -> None:
    fake.created = False
    response = api.post(
        f"{BASE}/assign", json={"driver_id": str(DRIVER.id)}, headers=sign_in(api, UserRole.ADMIN)
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "body",
    [{}, {"driver_id": "not-a-uuid"}, {"driver_id": str(uuid.uuid4()), "extra": 1}],
)
def test_invalid_assign_bodies_are_rejected(
    api: TestClient, fake: FakeDispatch, body: dict[str, Any]
) -> None:
    response = api.post(f"{BASE}/assign", json=body, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert fake.calls == []


def test_an_ineligible_driver_is_refused_with_the_reasons(
    api: TestClient, fake: FakeDispatch
) -> None:
    example = json.loads((EXAMPLES / "error-driver-not-eligible.json").read_text(encoding="utf-8"))
    fake.error = service._not_eligible([Ineligibility.BUSY])
    response = api.post(
        f"{BASE}/assign", json={"driver_id": str(DRIVER.id)}, headers=sign_in(api, UserRole.ADMIN)
    )
    assert response.status_code == 409
    assert response.json() == example


# --- Withdraw (D5, rows 10, 11) -------------------------------------------------------


@pytest.mark.parametrize(
    ("expected", "status"),
    [("offered", AssignmentStatus.OFFERED), ("accepted", AssignmentStatus.ACCEPTED)],
)
def test_withdraw_passes_the_expected_status(
    api: TestClient, fake: FakeDispatch, expected: str, status: AssignmentStatus
) -> None:
    response = api.post(
        f"{BASE}/withdraw",
        json={"expected_status": expected, "note": "  No answer after 25 minutes.  "},
        headers=sign_in(api, UserRole.ADMIN),
    )

    assert response.status_code == 200
    name, kwargs = fake.calls[0]
    assert name == "withdraw_job"
    assert kwargs["expected_status"] is status
    assert kwargs["note"] == "No answer after 25 minutes."


def test_a_blank_withdraw_note_is_stored_as_null(api: TestClient, fake: FakeDispatch) -> None:
    api.post(
        f"{BASE}/withdraw",
        json={"expected_status": "offered", "note": "   "},
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert fake.calls[0][1]["note"] is None


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"expected_status": "declined"},
        {"expected_status": "offered", "note": "x" * 501},
        {"expected_status": "offered", "extra": True},
    ],
)
def test_invalid_withdraw_bodies_are_rejected(
    api: TestClient, fake: FakeDispatch, body: dict[str, Any]
) -> None:
    response = api.post(f"{BASE}/withdraw", json=body, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert fake.calls == []


def test_nothing_to_withdraw_uses_the_contract_message(api: TestClient, fake: FakeDispatch) -> None:
    example = json.loads((EXAMPLES / "error-assignment-not-found.json").read_text(encoding="utf-8"))
    fake.error = APIError(404, "assignment_not_found", "This order has no driver assigned")
    response = api.post(
        f"{BASE}/withdraw",
        json={"expected_status": "offered"},
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 404
    assert response.json() == example


# --- History (H1) ------------------------------------------------------------------


def test_history_matches_the_contract_example(api: TestClient) -> None:
    response = api.get(f"{BASE}/history", headers=sign_in(api, UserRole.ADMIN))

    assert response.status_code == 200
    items = response.json()["items"]
    example = json.loads((EXAMPLES / "admin-order-history.json").read_text(encoding="utf-8"))
    declined = next(item for item in example["items"] if item["reason_code"] == "driver_declined")
    assert keys(items[0]) == keys(declined)
    assert items[0]["actor"] == {"id": str(DRIVER.id), "role": "driver", "name": DRIVER.name}
    assert items[0]["assignment"]["driver"] == {"id": str(DRIVER.id), "name": DRIVER.name}
    assert items[0]["assignment"]["decline_reason"] == "vehicle_cannot_carry"
    assert items[0]["note"] == "Truck is at the mechanic."
    # A system or unlinked event has neither actor nor assignment.
    assert (items[1]["actor"], items[1]["assignment"]) == (None, None)
