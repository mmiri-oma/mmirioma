"""Admin hold review endpoint tests that need no database (docs/api/deliveries.md, #93).

Session lookup and :mod:`app.modules.deliveries.holds` are replaced with
in-memory fakes, so these cover roles (FR-001, T-23), CSRF, request
validation, error codes, status codes and response shapes. Database
behaviour is in test_hold_review_integration.py.
"""

import uuid
from datetime import UTC, datetime, timedelta
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
from app.modules.deliveries.models import (
    AlternativeProofReason,
    CustomerAcknowledgementMethod,
    DeliveryCode,
    ExceptionCategory,
    HoldKind,
    HoldResolution,
    OrderException,
    SmsStatus,
)
from app.modules.dispatch import service as dispatch_service
from app.modules.orders.models import Order, OrderEvent, OrderStatus, TransitionReason
from app.modules.orders.service import StaffOrder
from app.modules.payments import service as payments_service

REFERENCE = "MO-7KQ2M9XH4T"
BASE = f"/api/v1/admin/orders/{REFERENCE}"
SINCE = datetime(2026, 10, 20, 8, 48, tzinfo=UTC)
HOLD_ID = uuid.uuid4()

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
DRIVER = USERS[UserRole.DRIVER]

APPROVE = {
    "hold_id": str(HOLD_ID),
    "decision": "approve",
    "customer_acknowledgment": {
        "method": "phone_call",
        "confirmed_at": "2026-10-20T09:15:00Z",
    },
    "note": "Customer confirmed by phone.",
}
DECISION = {"hold_id": str(HOLD_ID), "note": "Customer moved the tank to the gate."}
FAIL = {
    "to": "failed",
    "expected_status": "collected",
    "reason_code": "source_quality_concern",
    "note": "Source flooded.",
    "hold_id": str(HOLD_ID),
}

POSTS: list[tuple[str, dict[str, Any]]] = [
    (f"{BASE}/proof-overrides", APPROVE),
    (f"{BASE}/hold/continue", DECISION),
    (f"{BASE}/hold/resume", DECISION),
    (f"{BASE}/transition", FAIL),
]
GETS = [
    "/api/v1/admin/orders",
    f"{BASE}/hold",
    f"{BASE}/cancellation-outcome?reason_code=mmirioma_unable",
    f"{BASE}/history?include=holds",
]


def make_order(status: OrderStatus = OrderStatus.UNLOADING) -> Order:
    created = datetime(2026, 10, 20, 7, 0, tzinfo=UTC)
    return Order(
        id=uuid.uuid4(),
        reference=REFERENCE,
        customer_id=USERS[UserRole.CUSTOMER].id,
        idempotency_key=uuid.uuid4(),
        status=status,
        quantity_litres=1200,
        contact_name="Sample Customer",
        contact_phone="+2348000000001",
        delivery_address="14 Sample Road, Enugu",
        landmark=None,
        delivery_instructions=None,
        preferred_delivery_date=None,
        is_simulated=True,
        created_at=created,
        updated_at=created,
    )


def make_hold(kind: HoldKind = HoldKind.PROOF_REVIEW) -> OrderException:
    return OrderException(
        id=HOLD_ID,
        order_id=uuid.uuid4(),
        category=ExceptionCategory.ALTERNATIVE_PROOF,
        hold_kind=kind,
        note=None,
        created_at=SINCE,
        updated_at=SINCE,
    )


def detail(hold: OrderException | None = None) -> holds.OrderDetail:
    return holds.OrderDetail(
        dispatch=dispatch_service.DispatchOrder(
            staff_order=StaffOrder(order=make_order(), customer=USERS[UserRole.CUSTOMER]),
            assignment=None,
        ),
        hold=hold,
        confirmation=confirmation_service.EMPTY_VIEW,
        contact_attempts=(),
    )


class FakeHolds:
    """Records service calls and returns canned results."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.error: APIError | None = None
        self.driver: User | None = None

    def _record(self, name: str, kwargs: dict[str, Any]) -> None:
        self.calls.append((name, kwargs))
        if self.error:
            raise self.error

    async def list_orders(self, _: object, **kwargs: Any) -> tuple[list[holds.HeldOrder], int]:
        self._record("list_orders", kwargs)
        item = holds.HeldOrder(
            staff_order=StaffOrder(order=make_order(), customer=USERS[UserRole.CUSTOMER]),
            hold=make_hold(),
            driver=self.driver,
        )
        return [item], 1

    async def get_order_detail(self, _: object, **kwargs: Any) -> holds.OrderDetail:
        self._record("get_order_detail", kwargs)
        return detail(make_hold())

    async def get_hold_review(self, _: object, **kwargs: Any) -> holds.HoldReview:
        self._record("get_hold_review", kwargs)
        code = DeliveryCode(
            id=uuid.uuid4(),
            order_id=uuid.uuid4(),
            code_hash="never-returned",
            issued_at=SINCE - timedelta(minutes=4),
            expires_at=SINCE + timedelta(minutes=6),
            attempts=3,
            sms_status=SmsStatus.ACCEPTED,
            issued_by=DRIVER.id,
        )
        return holds.HoldReview(
            hold=make_hold(),
            order=make_order(),
            driver=DRIVER,
            proof=holds.ProofEvidence(
                delivered_litres=1000,
                reason=AlternativeProofReason.CUSTOMER_CANNOT_RECEIVE_CODE,
                driver_note="Customer's phone is off.",
                arrived_at=SINCE - timedelta(minutes=28),
                unloading_completed_at=SINCE - timedelta(minutes=4),
                sent_at=SINCE,
                delivery_code=code,
                code_expired=True,
                contact_attempts=(SINCE - timedelta(minutes=2),),
                location=None,
            ),
            pickup=None,
            source_eligibility=None,
            report=None,
            incidents=[],
            withdraw_allowed=False,
        )

    async def decide_proof(self, _: object, **kwargs: Any) -> holds.OrderDetail:
        self._record("decide_proof", kwargs)
        return detail()

    async def continue_source(self, _: object, **kwargs: Any) -> holds.OrderDetail:
        self._record("continue_source", kwargs)
        return detail()

    async def resume_unsafe(self, _: object, **kwargs: Any) -> holds.OrderDetail:
        self._record("resume_unsafe", kwargs)
        return detail()

    async def transition_with_holds(self, _: object, **kwargs: Any) -> holds.OrderDetail:
        self._record("transition_with_holds", kwargs)
        return detail()

    async def cancellation_outcome(self, _: object, **kwargs: Any) -> holds.CancellationOutcome:
        self._record("cancellation_outcome", kwargs)
        return holds.CancellationOutcome(
            reason_code=TransitionReason.MMIRIOMA_UNABLE,
            customer_charge_minor_units=0,
            message=holds.NO_CHARGE_MESSAGE,
        )

    async def order_history(self, _: object, **kwargs: Any) -> list[holds.HistoryItem]:
        self._record("order_history", kwargs)
        event = OrderEvent(
            id=uuid.uuid4(),
            order_id=uuid.uuid4(),
            actor_id=DRIVER.id,
            from_status=OrderStatus.ARRIVED,
            to_status=OrderStatus.UNLOADING,
            reason_code=None,
            note=None,
            assignment_id=None,
            created_at=SINCE - timedelta(minutes=10),
        )
        status_entry = dispatch_service.HistoryEntry(
            event=event, actor=DRIVER, assignment=None, assignment_driver=None, decline_reason=None
        )
        if not kwargs["include_holds"]:
            return [status_entry]
        decided = holds.HoldEntry(
            kind=holds.HistoryKind.HOLD_DECIDED,
            hold_id=HOLD_ID,
            hold_kind=HoldKind.PROOF_REVIEW,
            category=ExceptionCategory.ALTERNATIVE_PROOF,
            decision=HoldResolution.PROOF_REJECTED,
            actor=ADMIN,
            note="The person who answered is not the customer.",
            created_at=SINCE + timedelta(minutes=43),
        )
        return [decided, status_entry]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeHolds:
    fake = FakeHolds()
    for name in (
        "list_orders",
        "get_order_detail",
        "get_hold_review",
        "decide_proof",
        "continue_source",
        "resume_unsafe",
        "transition_with_holds",
        "cancellation_outcome",
        "order_history",
    ):
        monkeypatch.setattr(holds, name, getattr(fake, name))

    async def no_confirmations(*_args: object, **_kwargs: object) -> dict[uuid.UUID, object]:
        return {}

    monkeypatch.setattr(confirmation_service, "confirmation_lines", no_confirmations)

    async def no_cash_history(*_args: object, **_kwargs: object) -> list[object]:
        return []

    monkeypatch.setattr(payments_service, "cash_history", no_cash_history)
    return fake


@pytest.fixture
def api(client: TestClient, monkeypatch: pytest.MonkeyPatch, fake: FakeHolds) -> TestClient:
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
    client.cookies.set(SESSION_COOKIE_NAME, role.value)
    secret = get_settings().session_secret.get_secret_value()
    return {CSRF_HEADER_NAME: security.csrf_token_for(role.value, secret)}


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


# --- Access (FR-001, T-23) ---------------------------------------------------------


@pytest.mark.parametrize("role", [UserRole.CUSTOMER, UserRole.DRIVER])
def test_t23_only_admins_may_review_holds(api: TestClient, fake: FakeHolds, role: UserRole) -> None:
    headers = sign_in(api, role)
    for path, body in POSTS:
        response = api.post(path, json=body, headers=headers)
        assert (response.status_code, error_code(response)) == (403, "forbidden"), path
    for path in GETS:
        response = api.get(path, headers=headers)
        assert (response.status_code, error_code(response)) == (403, "forbidden"), path
    assert fake.calls == []


@pytest.mark.parametrize(("path", "body"), POSTS)
def test_decisions_require_the_csrf_token(
    api: TestClient, fake: FakeHolds, path: str, body: dict[str, Any]
) -> None:
    sign_in(api, UserRole.ADMIN)
    response = api.post(path, json=body, headers={})
    assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert fake.calls == []


# --- R0: list and detail ------------------------------------------------------------


def test_the_list_carries_holds_and_passes_the_on_hold_filter(
    api: TestClient, fake: FakeHolds
) -> None:
    response = api.get("/api/v1/admin/orders?on_hold=true", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json()["items"][0]["hold"] == {
        "id": str(HOLD_ID),
        "kind": "proof_review",
        "since": "2026-10-20T08:48:00Z",
    }
    assert fake.calls[0][1]["on_hold"] is True


def test_the_list_names_each_orders_live_driver_or_null(api: TestClient, fake: FakeHolds) -> None:
    """#204: the Rider column reads ``driver``; an order without a live driver says null."""
    fake.driver = DRIVER
    response = api.get("/api/v1/admin/orders", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json()["items"][0]["driver"] == {"id": str(DRIVER.id), "name": DRIVER.name}

    fake.driver = None
    response = api.get("/api/v1/admin/orders", headers=sign_in(api, UserRole.ADMIN))
    assert response.json()["items"][0]["driver"] is None


def test_the_detail_has_no_driver_field_only_the_assignment(api: TestClient) -> None:
    """Contract #204: the list carries ``driver``; the detail keeps ``assignment`` as it was."""
    response = api.get(BASE, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert "driver" not in response.json()


def test_the_detail_carries_the_hold(api: TestClient) -> None:
    response = api.get(BASE, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json()["hold"]["kind"] == "proof_review"


# --- R1: evidence and decisions --------------------------------------------------------


def test_the_evidence_never_includes_the_code(api: TestClient) -> None:
    response = api.get(f"{BASE}/hold", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "proof_review"
    assert body["driver"] == {"id": str(DRIVER.id), "name": DRIVER.name}
    assert body["proof"]["delivery_code"] == {
        "issued_at": "2026-10-20T08:44:00Z",
        "sms_status": "accepted",
        "attempts_used": 3,
        "attempts_limit": 5,
        "expired": True,
    }
    assert body["proof"]["contact_attempts"] == [{"attempted_at": "2026-10-20T08:46:00Z"}]
    assert "never-returned" not in response.text
    assert (body["pickup"], body["report"], body["source_eligibility"]) == (None, None, None)


def test_approve_passes_the_acknowledgment(api: TestClient, fake: FakeHolds) -> None:
    response = api.post(
        f"{BASE}/proof-overrides", json=APPROVE, headers=sign_in(api, UserRole.ADMIN)
    )
    assert response.status_code == 200
    name, kwargs = fake.calls[0]
    assert name == "decide_proof"
    assert kwargs["decision"] is holds.ProofDecision.APPROVE
    assert kwargs["hold_id"] == HOLD_ID
    assert kwargs["admin"].id == ADMIN.id
    assert kwargs["acknowledgment"].method is CustomerAcknowledgementMethod.PHONE_CALL
    assert response.json()["hold"] is None


@pytest.mark.parametrize(
    "body",
    [
        {**APPROVE, "customer_acknowledgment": None},
        {**APPROVE, "decision": "reject"},
        {**APPROVE, "note": "   "},
        {**APPROVE, "note": "x" * 501},
        {**APPROVE, "decision": "maybe"},
        {
            **APPROVE,
            "customer_acknowledgment": {"method": "other", "confirmed_at": "2026-10-20T09:15:00Z"},
        },
        {
            **APPROVE,
            "customer_acknowledgment": {"method": "phone_call", "confirmed_at": "2026-10-20T09:15"},
        },
        {**APPROVE, "extra": True},
    ],
)
def test_invalid_proof_override_bodies_are_rejected(
    api: TestClient, fake: FakeHolds, body: dict[str, Any]
) -> None:
    response = api.post(f"{BASE}/proof-overrides", json=body, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert fake.calls == []


@pytest.mark.parametrize(
    ("status", "code", "message"),
    [
        (403, "own_delivery_override", "You can't approve proof for a delivery you made."),
        (409, "hold_not_open", "This hold has already been decided or has changed"),
    ],
)
def test_decision_refusals_keep_their_codes(
    api: TestClient, fake: FakeHolds, status: int, code: str, message: str
) -> None:
    fake.error = APIError(status, code, message)
    response = api.post(
        f"{BASE}/proof-overrides", json=APPROVE, headers=sign_in(api, UserRole.ADMIN)
    )
    assert response.status_code == status
    assert response.json() == {"error": {"code": code, "message": message, "details": None}}


# --- R2, R3, FAIL, CANCEL ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "service"), [("continue", "continue_source"), ("resume", "resume_unsafe")]
)
def test_continue_and_resume_need_a_note(
    api: TestClient, fake: FakeHolds, path: str, service: str
) -> None:
    headers = sign_in(api, UserRole.ADMIN)
    refused = api.post(f"{BASE}/hold/{path}", json={**DECISION, "note": ""}, headers=headers)
    assert (refused.status_code, error_code(refused)) == (422, "validation_error")
    accepted = api.post(f"{BASE}/hold/{path}", json=DECISION, headers=headers)
    assert accepted.status_code == 200
    assert fake.calls[0][0] == service


def test_continue_refused_for_an_ineligible_source(api: TestClient, fake: FakeHolds) -> None:
    fake.error = APIError(
        409,
        "source_not_eligible",
        "This order has no water category.",
        details={"answer": "cannot_check"},
    )
    response = api.post(
        f"{BASE}/hold/continue", json=DECISION, headers=sign_in(api, UserRole.ADMIN)
    )
    assert (response.status_code, error_code(response)) == (409, "source_not_eligible")
    assert response.json()["error"]["details"] == {"answer": "cannot_check"}


def test_transition_passes_fail_and_cancel(api: TestClient, fake: FakeHolds) -> None:
    response = api.post(f"{BASE}/transition", json=FAIL, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    kwargs = fake.calls[0][1]
    assert kwargs["target"] is OrderStatus.FAILED
    assert kwargs["expected_status"] is OrderStatus.COLLECTED
    assert kwargs["reason_code"] is TransitionReason.SOURCE_QUALITY_CONCERN
    assert kwargs["hold_id"] == HOLD_ID


@pytest.mark.parametrize(
    "body",
    [
        {**FAIL, "to": "delivered"},
        {key: value for key, value in FAIL.items() if key != "expected_status"},
        {**FAIL, "reason_code": "not_a_reason"},
        {**FAIL, "note": "x" * 501},
    ],
)
def test_invalid_transition_bodies_are_rejected(
    api: TestClient, fake: FakeHolds, body: dict[str, Any]
) -> None:
    response = api.post(f"{BASE}/transition", json=body, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert fake.calls == []


def test_cancellation_outcome_is_free_and_in_kobo(api: TestClient) -> None:
    response = api.get(
        f"{BASE}/cancellation-outcome?reason_code=mmirioma_unable",
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 200
    assert response.json() == {
        "reason_code": "mmirioma_unable",
        "customer_charge_minor_units": 0,
        "message": "The customer is not charged for this cancellation.",
    }


# --- History (decision 8) ---------------------------------------------------------------


def test_history_without_include_keeps_the_agreed_shape(api: TestClient, fake: FakeHolds) -> None:
    # Regression: the shipped dispatch screens draw a badge from every
    # to_status, so the default response must never carry hold entries.
    response = api.get(f"{BASE}/history", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert set(items[0]) == {
        "id",
        "from_status",
        "to_status",
        "actor",
        "reason_code",
        "note",
        "created_at",
        "assignment",
        # Additive, from the order confirmation contract (PR #111); null here.
        "confirmation",
    }
    assert items[0]["confirmation"] is None
    assert fake.calls[0][1]["include_holds"] is False


def test_history_with_holds_adds_hold_entries(api: TestClient) -> None:
    response = api.get(f"{BASE}/history?include=holds", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    decided, status_change = response.json()["items"]
    assert decided["kind"] == "hold_decided"
    assert (decided["from_status"], decided["to_status"]) == (None, None)
    assert decided["hold"] == {
        "id": str(HOLD_ID),
        "kind": "proof_review",
        "category": "alternative_proof",
        "decision": "proof_rejected",
    }
    assert decided["id"] != str(HOLD_ID)
    assert decided["actor"] == {"id": str(ADMIN.id), "role": "admin", "name": ADMIN.name}
    assert status_change["kind"] == "status_change"
    assert status_change["hold"] is None
    assert status_change["to_status"] == "unloading"


def test_history_refuses_an_unknown_include(api: TestClient, fake: FakeHolds) -> None:
    response = api.get(f"{BASE}/history?include=everything", headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert fake.calls == []


def test_hold_kind_names_match_the_deliveries_enumeration() -> None:
    # orders.schemas repeats the hold kinds because orders cannot import
    # deliveries; keep the two equal.
    from typing import get_args

    from app.modules.orders.schemas import HoldKindName

    assert set(get_args(HoldKindName)) == {kind.value for kind in HoldKind}
