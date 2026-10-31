"""Order confirmation endpoint tests that need no database (#113).

Contract: docs/api/deliveries.md, "Order confirmation endpoints" (agreed,
PR #111). Session lookup and the confirmation and hold services are faked,
so these cover roles (FR-001), CSRF, request validation, the ``to``
discriminator on the shared transition endpoint, response shapes against the
contract's examples, and the SMS and money formatting. Database behaviour is
in test_confirmation_integration.py.
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
from app.modules.confirmation.service import (
    CategoryOptions,
    ConfirmInput,
    SourceOption,
    confirmation_message,
    format_sms_naira,
    format_window,
)
from app.modules.deliveries import holds
from app.modules.dispatch import service as dispatch_service
from app.modules.messaging.sms import MockSmsProvider, get_sms_provider
from app.modules.orders.models import ConfirmationSmsStatus, Order, OrderStatus
from app.modules.orders.service import StaffOrder
from app.modules.pricing.models import AgreementMethod
from app.modules.sources.eligibility import EligibilityReason
from app.modules.sources.models import (
    ActivationStatus,
    WaterCategory,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)
from tests.test_dispatch_api import confirmed_view, keys

EXAMPLES = Path(__file__).resolve().parents[2] / "docs" / "api" / "examples"
REFERENCE = "MO-7KQ2M9XH4T"
BASE = f"/api/v1/admin/orders/{REFERENCE}"
TRANSITION = f"{BASE}/transition"
OPTIONS = f"{BASE}/confirmation-options"

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
ADMIN = USERS[UserRole.ADMIN]


def example(name: str) -> Any:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


REQUEST = example("order-confirm-request.json")


def order() -> Order:
    return Order(
        id=uuid.uuid4(),
        reference=REFERENCE,
        customer_id=USERS[UserRole.CUSTOMER].id,
        idempotency_key=uuid.uuid4(),
        status=OrderStatus.CONFIRMED,
        quantity_litres=2000,
        contact_name="Sample Customer",
        contact_phone="+2348000000001",
        delivery_address="12 Sample Close, Independence Layout, Enugu",
        landmark=None,
        delivery_instructions=None,
        preferred_delivery_date=None,
        is_simulated=True,
        created_at=datetime(2026, 10, 19, 7, 40, tzinfo=UTC),
        updated_at=datetime(2026, 10, 19, 8, 51, tzinfo=UTC),
        delivery_window_start_at=datetime(2026, 10, 20, 9, tzinfo=UTC),
        delivery_window_end_at=datetime(2026, 10, 20, 11, tzinfo=UTC),
        confirmation_sms_status=ConfirmationSmsStatus.NOT_ACCEPTED,
        confirmation_sms_attempted_at=datetime(2026, 10, 19, 8, 51, 2, tzinfo=UTC),
    )


class Fake:
    """Records the calls the router makes."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.error: APIError | None = None

    async def confirm_order(self, _session: object, **kwargs: Any) -> None:
        self.calls.append(("confirm_order", kwargs))
        if self.error:
            raise self.error

    async def transition_with_holds(self, _session: object, **kwargs: Any) -> holds.OrderDetail:
        self.calls.append(("transition_with_holds", kwargs))
        return await self.get_order_detail(None)

    async def get_order_detail(self, _session: object, **_kwargs: Any) -> holds.OrderDetail:
        return holds.OrderDetail(
            dispatch=dispatch_service.DispatchOrder(
                staff_order=StaffOrder(order=order(), customer=USERS[UserRole.CUSTOMER]),
                assignment=None,
            ),
            hold=None,
            confirmation=confirmed_view(),
            contact_attempts=(),
        )

    async def confirmation_options(self, _session: object, **kwargs: Any) -> list[CategoryOptions]:
        self.calls.append(("confirmation_options", kwargs))
        if self.error:
            raise self.error
        potable = WaterCategory(id=uuid.uuid4(), code="potable", label="Potable Water")
        source = WaterSource(
            id=uuid.uuid4(),
            name="Sample Borehole A",
            approximate_location="X",
            is_simulated=False,
            kind=WaterSourceKind.BOREHOLE,
        )
        activation = WaterSourceCategory(
            source_id=source.id,
            water_category_id=potable.id,
            status=ActivationStatus.ACTIVATED,
            approved_until=datetime(2027, 1, 30).date(),
            report_reference="LR-0001",
            cost_per_litre_minor_units=150,
        )
        return [CategoryOptions(potable, [SourceOption(source, activation, [])])]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Fake:
    fake = Fake()
    monkeypatch.setattr(confirmation_service, "confirm_order", fake.confirm_order)
    monkeypatch.setattr(confirmation_service, "confirmation_options", fake.confirmation_options)
    monkeypatch.setattr(holds, "transition_with_holds", fake.transition_with_holds)
    monkeypatch.setattr(holds, "get_order_detail", fake.get_order_detail)
    return fake


@pytest.fixture
def api(client: TestClient, monkeypatch: pytest.MonkeyPatch, fake: Fake) -> TestClient:
    """Client whose session cookie value names the signed-in role; mock SMS."""

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
    # A zero-argument factory: FastAPI would read a dataclass's fields as body fields.
    sms = MockSmsProvider()
    client.app.dependency_overrides[get_sms_provider] = lambda: sms  # type: ignore[attr-defined]
    return client


def sign_in(client: TestClient, role: UserRole) -> dict[str, str]:
    client.cookies.set(SESSION_COOKIE_NAME, role.value)
    secret = get_settings().session_secret.get_secret_value()
    return {CSRF_HEADER_NAME: security.csrf_token_for(role.value, secret)}


def error_of(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["error"]["code"]


# --- Access ------------------------------------------------------------------------


@pytest.mark.parametrize("role", [UserRole.CUSTOMER, UserRole.DRIVER])
def test_only_admins(api: TestClient, fake: Fake, role: UserRole) -> None:
    headers = sign_in(api, role)
    assert error_of(api.post(TRANSITION, json=REQUEST, headers=headers)) == (403, "forbidden")
    assert error_of(api.get(OPTIONS, headers=headers)) == (403, "forbidden")
    assert fake.calls == []


def test_signed_out(api: TestClient) -> None:
    assert error_of(api.get(OPTIONS)) == (401, "not_authenticated")


def test_confirm_needs_csrf(api: TestClient, fake: Fake) -> None:
    sign_in(api, UserRole.ADMIN)
    assert error_of(api.post(TRANSITION, json=REQUEST)) == (403, "csrf_failed")
    assert fake.calls == []


# --- Confirm -----------------------------------------------------------------------


def test_confirm_passes_the_request_and_returns_the_detail(api: TestClient, fake: Fake) -> None:
    response = api.post(TRANSITION, json=REQUEST, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    body = response.json()
    # Just confirmed: not offered to a driver yet, unlike the example.
    # The fake detail's order has no payment fields (the real confirmation
    # sets them; test_payments_integration.py covers that).
    expected = keys(example("admin-order-detail.json")) | {"assignment": None, "payment": None}
    assert keys(body) == expected
    assert body["assignment"] is None
    assert body["price"]["total_minor_units"] == 4_500_000
    assert body["price"]["manual"] is True
    assert body["confirmation_sms"]["status"] == "not_accepted"
    name, call = fake.calls[0]
    assert name == "confirm_order"
    assert call["reference"] == REFERENCE
    assert call["admin"].id == ADMIN.id
    assert isinstance(call["sms"], MockSmsProvider)
    assert call["data"] == ConfirmInput(
        expected_status=OrderStatus.QUOTE_REQUESTED,
        water_category_id=uuid.UUID(REQUEST["water_category_id"]),
        source_id=uuid.UUID(REQUEST["source_id"]),
        window_start_at=datetime(2026, 10, 20, 9, tzinfo=UTC),
        window_end_at=datetime(2026, 10, 20, 11, tzinfo=UTC),
        total_minor_units=4_500_000,
        agreement_method=AgreementMethod.PHONE_CALL,
        agreed_at=datetime(2026, 10, 19, 8, 45, tzinfo=UTC),
        note="Customer asked the driver to call on arrival.",
    )


def test_fail_and_cancel_still_reach_the_hold_review(api: TestClient, fake: Fake) -> None:
    body = {"to": "failed", "expected_status": "collected", "reason_code": "other", "note": "x"}
    response = api.post(TRANSITION, json=body, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert [name for name, _ in fake.calls] == ["transition_with_holds"]


def with_(**changes: Any) -> dict[str, Any]:
    body = json.loads(json.dumps(REQUEST))
    for path, value in changes.items():
        target = body
        *parents, leaf = path.split("__")
        for parent in parents:
            target = target[parent]
        if value is ...:
            del target[leaf]
        else:
            target[leaf] = value
    return body


def test_a_quoted_order_is_confirmed_without_a_manual_total(api: TestClient, fake: Fake) -> None:
    # Order details question 14 (#21): the quote's total is confirmed as it is.
    body = with_(expected_status="awaiting_confirmation", manual_quote_total_minor_units=...)
    response = api.post(TRANSITION, json=body, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    data = fake.calls[0][1]["data"]
    assert (data.expected_status, data.total_minor_units) == (
        OrderStatus.AWAITING_CONFIRMATION,
        None,
    )


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (with_(expected_status="confirmed"), "expected_status"),
        # A quote request needs the manual total; a quoted order refuses one
        # (its quote's total is confirmed, order details question 14).
        (with_(manual_quote_total_minor_units=...), "manual_quote_total_minor_units"),
        (with_(expected_status="awaiting_confirmation"), "manual_quote_total_minor_units"),
        (with_(manual_quote_total_minor_units=4_500_050), "manual_quote_total_minor_units"),
        (with_(manual_quote_total_minor_units=0), "manual_quote_total_minor_units"),
        (with_(manual_quote_total_minor_units=45000.5), "manual_quote_total_minor_units"),
        (with_(manual_quote_total_minor_units="4500000"), "manual_quote_total_minor_units"),
        (with_(delivery_window__end_at="2026-10-20T09:00:00Z"), "delivery_window"),
        (with_(delivery_window__start_at="2026-10-20T09:00:00"), "start_at"),
        (with_(customer_agreement__disclosures_confirmed=False), "disclosures_confirmed"),
        (with_(customer_agreement__method="sms"), "method"),
        (with_(customer_agreement__method="other", note=None), "body"),
        (with_(note="x" * 501), "note"),
        (with_(source_id=...), "source_id"),
        (with_(price=1), "price"),
    ],
)
def test_confirm_validation(api: TestClient, fake: Fake, body: dict[str, Any], field: str) -> None:
    response = api.post(TRANSITION, json=body, headers=sign_in(api, UserRole.ADMIN))
    assert error_of(response) == (422, "validation_error")
    locs = [
        ".".join(str(part) for part in item["loc"]) for item in response.json()["error"]["details"]
    ]
    assert any(field in loc for loc in locs), locs
    assert fake.calls == []


def test_no_maximum_quote(api: TestClient, fake: Fake) -> None:
    # Decision 7: whole naira, at least 1.00, no upper limit.
    body = with_(manual_quote_total_minor_units=10**15)
    assert api.post(TRANSITION, json=body, headers=sign_in(api, UserRole.ADMIN)).status_code == 200
    assert fake.calls[0][1]["data"].total_minor_units == 10**15


@pytest.mark.parametrize(
    "error",
    [
        APIError(
            409, "invalid_order_transition", "x", details={"from": "confirmed", "to": "confirmed"}
        ),
        APIError(
            409, "transition_requirements_unmet", "x", details={"missing": ["source_eligible"]}
        ),
        APIError(404, "order_not_found", "Order not found"),
    ],
)
def test_confirm_errors_pass_through(api: TestClient, fake: Fake, error: APIError) -> None:
    fake.error = error
    response = api.post(TRANSITION, json=REQUEST, headers=sign_in(api, UserRole.ADMIN))
    assert error_of(response) == (error.status_code, error.code)
    assert response.json()["error"]["details"] == error.details


# --- Options -----------------------------------------------------------------------


def test_options_match_the_contract_example(api: TestClient, fake: Fake) -> None:
    response = api.get(OPTIONS, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    body = response.json()
    assert keys(body) == keys(example("confirmation-options.json"))
    source = body["categories"][0]["sources"][0]
    assert source["report_reference"] == "LR-0001"
    assert source["approved_until"] == "2027-01-30"
    # Amendment #72: the kind, so a quoted Tanker order shows only matching sources.
    assert source["kind"] == "borehole"
    assert "cost" not in json.dumps(body)


def test_options_not_found(api: TestClient, fake: Fake) -> None:
    fake.error = APIError(404, "order_not_found", "Order not found")
    assert error_of(api.get(OPTIONS, headers=sign_in(api, UserRole.ADMIN))) == (
        404,
        "order_not_found",
    )


def test_example_reasons_are_contract_reasons() -> None:
    reasons = {
        reason
        for category in example("confirmation-options.json")["categories"]
        for source in category["sources"]
        for reason in source["reasons"]
    }
    assert reasons <= {reason.value for reason in EligibilityReason}


# --- SMS and formatting -------------------------------------------------------------


def test_sms_naira() -> None:
    assert format_sms_naira(4_500_000) == "N45,000.00"
    assert format_sms_naira(100) == "N1.00"
    assert format_sms_naira(123_456_789_00) == "N123,456,789.00"


def test_window_in_lagos_time() -> None:
    start = datetime(2026, 10, 27, 9, tzinfo=UTC)  # 10:00 am in Lagos
    assert (
        format_window(start, start + timedelta(hours=2)) == "Tue 27 Oct 2026, 10:00 am to 12:00 pm"
    )
    late = datetime(2026, 10, 27, 22, 30, tzinfo=UTC)  # 11:30 pm in Lagos
    assert format_window(late, late + timedelta(hours=2)) == (
        "Tue 27 Oct 2026, 11:30 pm to Wed 28 Oct 2026, 1:30 am"
    )


def test_confirmation_message_is_the_agreed_wording() -> None:
    text = confirmation_message(
        reference="MO-7KQ2M9XH4T",
        window_start_at=datetime(2026, 10, 27, 9, tzinfo=UTC),
        window_end_at=datetime(2026, 10, 27, 11, tzinfo=UTC),
        total_minor_units=4_500_000,
    )
    assert text == (
        "MmiriOma: order MO-7KQ2M9XH4T is confirmed for Tue 27 Oct 2026, 10:00 am to "
        "12:00 pm. Total N45,000.00, pay cash after unloading. Help: +234 813 377 4902"
    )
    # GSM-7 only: no "₦", no water-quality claim.
    assert text.isascii()
    assert "safe" not in text.lower() and "potable" not in text.lower()


def test_ineligible_reason_type() -> None:
    # The options carry the shared check's reasons unchanged.
    option = SourceOption(
        WaterSource(name="x", approximate_location="y"), None, [EligibilityReason.NOT_ACTIVATED]
    )
    assert option.reasons == [EligibilityReason.NOT_ACTIVATED]
