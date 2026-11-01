"""Phone verification endpoints and helpers that need no database (FR-003, FR-004).

The service calls are replaced with fakes; database rules (limits, expiry,
attempts) are covered in test_phone_verification_integration.py.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.modules.auth import phone_verification, security, service
from app.modules.auth.dependencies import CSRF_HEADER_NAME, SESSION_COOKIE_NAME
from app.modules.auth.models import User, UserRole, UserSession, VerificationPurpose
from app.shared.phone import format_phone_for_display

USERS = {
    role: User(
        id=uuid.uuid4(),
        name="Sample",
        phone="+2348000000001",
        password_hash=security.hash_password("correct horse battery"),
        role=role,
        phone_verified_at=None,
    )
    for role in UserRole
}
SENT = phone_verification.CodeSent(
    phone="+2348000000001",
    expires_at=datetime(2026, 10, 17, 9, 5, tzinfo=UTC),
    resend_available_at=datetime(2026, 10, 17, 9, 1, tzinfo=UTC),
)


@pytest.fixture
def calls(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    recorded: list[tuple[str, dict[str, Any]]] = []

    async def lookup(_: object, token: str) -> service.AuthenticatedSession | None:
        try:
            user = USERS[UserRole(token)]
        except ValueError:
            return None
        user_session = UserSession(
            id=uuid.uuid4(), user_id=user.id, token_hash="x", expires_at=datetime.now(UTC)
        )
        return service.AuthenticatedSession(user=user, session=user_session, token=token)

    async def send_code(_: object, **kwargs: Any) -> phone_verification.CodeSent:
        recorded.append(("send_code", kwargs))
        return SENT

    async def verify_code(_: object, **kwargs: Any) -> User:
        recorded.append(("verify_code", kwargs))
        return kwargs["user"]

    monkeypatch.setattr(service, "get_authenticated_session", lookup)
    monkeypatch.setattr(phone_verification, "send_code", send_code)
    monkeypatch.setattr(phone_verification, "verify_code", verify_code)
    return recorded


def headers(client: TestClient, role: UserRole) -> dict[str, str]:
    client.cookies.set(SESSION_COOKIE_NAME, role.value)
    secret = get_settings().session_secret.get_secret_value()
    return {CSRF_HEADER_NAME: security.csrf_token_for(role.value, secret)}


def test_request_code_returns_202_with_times(client: TestClient, calls: list) -> None:
    response = client.post(
        "/api/v1/auth/phone-verification", headers=headers(client, UserRole.CUSTOMER)
    )

    assert response.status_code == 202
    assert response.json() == {
        "phone": "+2348000000001",
        "expires_at": "2026-10-17T09:05:00Z",
        "resend_available_at": "2026-10-17T09:01:00Z",
        # The provider took the SMS; that is not proof it arrived.
        "delivery_status": "accepted",
    }
    assert calls[0][1]["purpose"] is VerificationPurpose.ACCOUNT_PHONE


@pytest.mark.parametrize("delivery", ["accepted", "delivered", "failed"])
def test_status_endpoint_reports_delivery(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, calls: list, delivery: str
) -> None:
    async def delivery_status(_: object, **kwargs: Any) -> phone_verification.CodeStatus:
        calls.append(("delivery_status", kwargs))
        return phone_verification.CodeStatus(
            delivery_status=delivery,
            expires_at=SENT.expires_at,
            resend_available_at=SENT.resend_available_at,
        )

    monkeypatch.setattr(phone_verification, "delivery_status", delivery_status)
    client.cookies.set(SESSION_COOKIE_NAME, UserRole.CUSTOMER.value)

    response = client.get("/api/v1/auth/phone-verification/status")

    assert response.status_code == 200
    assert response.json() == {
        "delivery_status": delivery,
        "expires_at": "2026-10-17T09:05:00Z",
        "resend_available_at": "2026-10-17T09:01:00Z",
    }
    assert calls[-1][1]["purpose"] is VerificationPurpose.ACCOUNT_PHONE


def test_status_endpoint_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/v1/auth/phone-verification/status").status_code == 401
    assert client.get("/api/v1/auth/phone-change/status").status_code == 401


@pytest.mark.parametrize(
    ("path", "role"),
    [
        ("/api/v1/auth/phone-verification", UserRole.ADMIN),
        ("/api/v1/auth/phone-verification/verify", UserRole.ADMIN),
        ("/api/v1/auth/phone-change", UserRole.ADMIN),
        ("/api/v1/auth/phone-change/verify", UserRole.ADMIN),
        # Partners verify their phone before approval, but never change it
        # here (docs/api/auth.md, partner amendment).
        ("/api/v1/auth/phone-change", UserRole.DRIVER),
        ("/api/v1/auth/phone-change/verify", UserRole.DRIVER),
    ],
)
def test_staff_verify_no_phones_and_partners_change_none(
    client: TestClient, calls: list, path: str, role: UserRole
) -> None:
    response = client.post(path, json={}, headers=headers(client, role))
    assert response.status_code == 403
    assert calls == []


def test_csrf_is_required(client: TestClient, calls: list) -> None:
    headers(client, UserRole.CUSTOMER)
    response = client.post("/api/v1/auth/phone-verification")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


@pytest.mark.parametrize("code", ["12345", "1234567", "12a456", "", " 12 34 56"])
def test_code_must_be_six_digits(client: TestClient, calls: list, code: str) -> None:
    response = client.post(
        "/api/v1/auth/phone-verification/verify",
        json={"code": code},
        headers=headers(client, UserRole.CUSTOMER),
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "code"]
    assert calls == []


def test_code_is_trimmed(client: TestClient, calls: list) -> None:
    response = client.post(
        "/api/v1/auth/phone-verification/verify",
        json={"code": " 042917 "},
        headers=headers(client, UserRole.CUSTOMER),
    )
    assert response.status_code == 200
    assert calls[0][1]["code"] == "042917"


def test_code_requests_are_limited_per_ip(client: TestClient, calls: list) -> None:
    auth = headers(client, UserRole.CUSTOMER)
    statuses = [
        client.post("/api/v1/auth/phone-verification", headers=auth).status_code for _ in range(11)
    ]
    assert statuses == [202] * 10 + [429]


def test_code_checks_are_limited_per_ip(client: TestClient, calls: list) -> None:
    auth = headers(client, UserRole.CUSTOMER)
    statuses = [
        client.post(
            "/api/v1/auth/phone-verification/verify", json={"code": "123456"}, headers=auth
        ).status_code
        for _ in range(31)
    ]
    assert statuses == [200] * 30 + [429]


def test_phone_change_checks_the_password_first(client: TestClient, calls: list) -> None:
    auth = headers(client, UserRole.CUSTOMER)
    wrong = client.post(
        "/api/v1/auth/phone-change",
        json={"phone": "0809 000 0002", "password": "wrong password"},
        headers=auth,
    )
    assert wrong.status_code == 403
    assert wrong.json()["error"]["code"] == "password_incorrect"
    assert calls == []

    right = client.post(
        "/api/v1/auth/phone-change",
        json={"phone": "0809 000 0002", "password": "correct horse battery"},
        headers=auth,
    )
    assert right.status_code == 202
    assert calls[0][1]["purpose"] is VerificationPurpose.PHONE_CHANGE
    assert calls[0][1]["new_phone"] == "+2348090000002"


def test_wrong_passwords_on_phone_change_are_rate_limited(client: TestClient, calls: list) -> None:
    auth = headers(client, UserRole.CUSTOMER)
    body = {"phone": "08090000002", "password": "wrong password"}
    statuses = [
        client.post("/api/v1/auth/phone-change", json=body, headers=auth).status_code
        for _ in range(6)
    ]
    assert statuses == [403] * 5 + [429]


# --- Helpers ----------------------------------------------------------------------


def test_codes_are_six_random_digits() -> None:
    codes = {phone_verification.generate_code() for _ in range(200)}
    assert all(len(code) == 6 and code.isdigit() for code in codes)
    assert len(codes) > 150


def test_code_hash_is_keyed_and_bound_to_the_row() -> None:
    first, second = uuid.uuid4(), uuid.uuid4()
    digest = phone_verification.hash_code(first, "123456", "secret-a")
    assert len(digest) == 64 and "123456" not in digest
    assert digest == phone_verification.hash_code(first, "123456", "secret-a")
    assert digest != phone_verification.hash_code(second, "123456", "secret-a")
    assert digest != phone_verification.hash_code(first, "123456", "secret-b")


def test_code_message_fits_one_sms_and_names_support() -> None:
    message = phone_verification.code_message("042917")
    assert "042917" in message
    assert "5 minutes" in message
    assert "+234 813 377 4902" in message
    assert len(message) <= 160


def test_timing_rules_match_the_srs() -> None:
    assert phone_verification.CODE_LIFETIME == timedelta(minutes=5)
    assert phone_verification.RESEND_COOLDOWN == timedelta(seconds=60)
    assert phone_verification.CODES_PER_PHONE_PER_HOUR == 3


def test_format_phone_for_display() -> None:
    assert format_phone_for_display("+2348133774902") == "+234 813 377 4902"
    assert format_phone_for_display("+14155550100") == "+14155550100"
