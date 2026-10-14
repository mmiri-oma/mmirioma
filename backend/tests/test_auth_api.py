"""Auth endpoint and dependency tests that need no database.

Session lookup is replaced with an in-memory fake, so these tests cover request
validation, the role guard (FR-001) and CSRF enforcement. Database behavior is
covered in test_auth_integration.py.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.modules.auth import security, service
from app.modules.auth.dependencies import (
    CSRF_HEADER_NAME,
    SESSION_COOKIE_NAME,
    CurrentAdmin,
    CurrentCustomer,
    CurrentUser,
)
from app.modules.auth.models import User, UserRole, UserSession

probe_router = APIRouter(prefix="/api/v1/test-probe")


@probe_router.get("/any")
async def any_role(user: CurrentUser) -> dict[str, str]:
    return {"role": user.role}


@probe_router.get("/admin")
async def admin_only(user: CurrentAdmin) -> dict[str, str]:
    return {"role": user.role}


@probe_router.post("/customer")
async def customer_write(user: CurrentCustomer) -> dict[str, str]:
    return {"role": user.role}


def fake_session(role: UserRole, token: str) -> service.AuthenticatedSession:
    user = User(
        id=uuid.uuid4(), name="Sample", phone="+2348000000001", password_hash="x", role=role
    )
    user_session = UserSession(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash="x",
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    return service.AuthenticatedSession(user=user, session=user_session, token=token)


@pytest.fixture
def probe_client(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Client whose session cookies map to fake users: cookie value = role name."""

    async def lookup(_: object, token: str) -> service.AuthenticatedSession | None:
        try:
            return fake_session(UserRole(token), token)
        except ValueError:
            return None

    monkeypatch.setattr(service, "get_authenticated_session", lookup)
    client.app.include_router(probe_router)  # type: ignore[attr-defined]
    return client


def csrf_for(token: str) -> str:
    return security.csrf_token_for(token, get_settings().session_secret.get_secret_value())


def error_code(response: object) -> str:
    return response.json()["error"]["code"]  # type: ignore[attr-defined]


def test_missing_cookie_is_not_authenticated(probe_client: TestClient) -> None:
    response = probe_client.get("/api/v1/test-probe/any")

    assert response.status_code == 401
    assert error_code(response) == "not_authenticated"


def test_unknown_session_is_not_authenticated(probe_client: TestClient) -> None:
    probe_client.cookies.set(SESSION_COOKIE_NAME, "not-a-session")

    response = probe_client.get("/api/v1/test-probe/any")

    assert response.status_code == 401
    assert error_code(response) == "not_authenticated"


@pytest.mark.parametrize("role", list(UserRole))
def test_any_signed_in_role_passes_current_user(probe_client: TestClient, role: UserRole) -> None:
    probe_client.cookies.set(SESSION_COOKIE_NAME, role.value)

    response = probe_client.get("/api/v1/test-probe/any")

    assert response.status_code == 200
    assert response.json() == {"role": role.value}


@pytest.mark.parametrize("role", [UserRole.CUSTOMER, UserRole.DRIVER])
def test_non_admins_are_forbidden_from_admin_endpoints(
    probe_client: TestClient, role: UserRole
) -> None:
    probe_client.cookies.set(SESSION_COOKIE_NAME, role.value)

    response = probe_client.get("/api/v1/test-probe/admin")

    assert response.status_code == 403
    assert error_code(response) == "forbidden"


def test_admin_passes_admin_guard(probe_client: TestClient) -> None:
    probe_client.cookies.set(SESSION_COOKIE_NAME, "admin")

    assert probe_client.get("/api/v1/test-probe/admin").status_code == 200


def test_unsafe_method_without_csrf_token_is_rejected(probe_client: TestClient) -> None:
    probe_client.cookies.set(SESSION_COOKIE_NAME, "customer")

    response = probe_client.post("/api/v1/test-probe/customer")

    assert response.status_code == 403
    assert error_code(response) == "csrf_failed"


def test_unsafe_method_with_another_sessions_csrf_token_is_rejected(
    probe_client: TestClient,
) -> None:
    probe_client.cookies.set(SESSION_COOKIE_NAME, "customer")

    response = probe_client.post(
        "/api/v1/test-probe/customer", headers={CSRF_HEADER_NAME: csrf_for("admin")}
    )

    assert response.status_code == 403
    assert error_code(response) == "csrf_failed"


def test_unsafe_method_with_valid_csrf_token_passes(probe_client: TestClient) -> None:
    probe_client.cookies.set(SESSION_COOKIE_NAME, "customer")

    response = probe_client.post(
        "/api/v1/test-probe/customer", headers={CSRF_HEADER_NAME: csrf_for("customer")}
    )

    assert response.status_code == 200


def test_csrf_is_checked_before_role(probe_client: TestClient) -> None:
    # A driver with a valid CSRF token reaches the role check and is forbidden.
    probe_client.cookies.set(SESSION_COOKIE_NAME, "driver")

    response = probe_client.post(
        "/api/v1/test-probe/customer", headers={CSRF_HEADER_NAME: csrf_for("driver")}
    )

    assert response.status_code == 403
    assert error_code(response) == "forbidden"


def test_logout_requires_a_session(client: TestClient) -> None:
    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 401
    assert error_code(response) == "not_authenticated"


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"name": "A", "phone": "08000000001", "password": "Pw7!xyz"}, "password"),
        ({"name": "A", "phone": "08000000001", "password": "p" * 129}, "password"),
        ({"name": "   ", "phone": "08000000001", "password": "long enough"}, "name"),
        ({"name": "A", "phone": "12345", "password": "long enough"}, "phone"),
        (
            {"name": "A", "phone": "08000000001", "password": "long enough", "role": "admin"},
            "role",
        ),
    ],
)
def test_register_rejects_invalid_input(
    client: TestClient, body: dict[str, str], field: str
) -> None:
    response = client.post("/api/v1/auth/register", json=body)

    assert response.status_code == 422
    assert error_code(response) == "validation_error"
    assert field in [error["loc"][-1] for error in response.json()["error"]["details"]]
    assert body["password"] not in response.text


def test_login_rejects_invalid_phone_without_echoing_password(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"phone": "not-a-phone", "password": "my secret password"}
    )

    assert response.status_code == 422
    assert "my secret password" not in response.text


def test_cors_allows_the_csrf_header(client: TestClient) -> None:
    response = client.options(
        "/api/v1/auth/logout",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-csrf-token, content-type",
        },
    )

    assert response.status_code == 200
    assert "x-csrf-token" in response.headers["access-control-allow-headers"].lower()


@pytest.mark.parametrize(
    "content_type",
    ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"],
)
@pytest.mark.parametrize("path", ["/api/v1/auth/login", "/api/v1/auth/register"])
def test_session_endpoints_reject_form_encodings(
    client: TestClient, path: str, content_type: str
) -> None:
    # Login and register have no CSRF token. They rely on cross-site HTML forms
    # being unable to send application/json, so other encodings must be rejected.
    body = b'{"name":"A","phone":"08000000001","password":"long enough"}'

    response = client.post(path, content=body, headers={"Content-Type": content_type})

    assert response.status_code == 422
    assert error_code(response) == "validation_error"
