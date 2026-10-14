"""Auth flows against a real, migrated database (FR-001, FR-002, FR-003).

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first). Every
account uses a random phone number and is deleted afterwards.
"""

import asyncio
import os
import secrets
from collections.abc import Awaitable, Callable, Iterator

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.main import create_app
from app.modules.auth import service
from app.modules.auth.dependencies import CSRF_HEADER_NAME, SESSION_COOKIE_NAME
from app.modules.auth.models import UserRole
from app.modules.auth.rate_limit import get_auth_rate_limits

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

PASSWORD = "correct horse battery"


def random_phone() -> str:
    # 0809 prefix plus random digits; fictional, and unlikely to collide.
    return "0809" + "".join(secrets.choice("0123456789") for _ in range(7))


def e164(local: str) -> str:
    return "+234" + local[1:]


@pytest.fixture
def created_phones() -> Iterator[list[str]]:
    phones: list[str] = []
    yield phones
    if phones:
        url = get_settings().sync_database_url.set(drivername="postgresql")
        with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
            # Sessions are removed by ON DELETE CASCADE.
            connection.execute(
                "DELETE FROM users WHERE phone = ANY(%s)", ([e164(p) for p in phones],)
            )


@pytest.fixture
def db_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()


def register(client: TestClient, phones: list[str], name: str = "Sample Customer") -> dict:
    phone = random_phone()
    phones.append(phone)
    response = client.post(
        "/api/v1/auth/register", json={"name": name, "phone": phone, "password": PASSWORD}
    )
    assert response.status_code == 201, response.text
    return {"phone": phone, **response.json()}


def run_service(call: Callable[[AsyncSession], Awaitable[object]]) -> object:
    """Run a service call in its own event loop and engine.

    The app's cached engine belongs to the TestClient's event loop, so it must
    not be shared here.
    """

    async def _run() -> object:
        engine = create_async_engine(TEST_DATABASE_URL or "")
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                return await call(session)
        finally:
            await engine.dispose()

    return asyncio.run(_run())


def test_register_creates_customer_session(
    db_client: TestClient, created_phones: list[str]
) -> None:
    session = register(db_client, created_phones, name="  Sample Customer  ")

    assert session["user"]["role"] == "customer"
    assert session["user"]["name"] == "Sample Customer"
    assert session["user"]["phone"] == e164(session["phone"])
    assert session["user"]["phone_verified"] is False
    assert session["csrf_token"]
    cookie = db_client.cookies.get(SESSION_COOKIE_NAME)
    assert cookie and cookie != session["csrf_token"]

    me = db_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"] == session["user"]
    assert me.json()["csrf_token"] == session["csrf_token"]


def test_session_cookie_flags(db_client: TestClient, created_phones: list[str]) -> None:
    phone = random_phone()
    created_phones.append(phone)

    response = db_client.post(
        "/api/v1/auth/register", json={"name": "Sample", "phone": phone, "password": PASSWORD}
    )

    set_cookie = response.headers["set-cookie"].lower()
    assert set_cookie.startswith(f"{SESSION_COOKIE_NAME}=")
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/" in set_cookie
    assert f"max-age={get_settings().session_max_age_seconds}" in set_cookie


def test_password_is_stored_hashed(db_client: TestClient, created_phones: list[str]) -> None:
    session = register(db_client, created_phones)
    url = get_settings().sync_database_url.set(drivername="postgresql")

    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        row = connection.execute(
            "SELECT password_hash FROM users WHERE phone = %s", (session["user"]["phone"],)
        ).fetchone()

    assert row is not None
    assert row[0].startswith("scrypt$")
    assert PASSWORD not in row[0]


def test_duplicate_phone_in_any_format_conflicts(
    db_client: TestClient, created_phones: list[str]
) -> None:
    session = register(db_client, created_phones)

    response = db_client.post(
        "/api/v1/auth/register",
        json={"name": "Other", "phone": session["user"]["phone"], "password": PASSWORD},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "phone_already_registered"


def test_login_with_any_phone_format(db_client: TestClient, created_phones: list[str]) -> None:
    session = register(db_client, created_phones)
    db_client.cookies.clear()

    response = db_client.post(
        "/api/v1/auth/login",
        json={"phone": session["user"]["phone"].removeprefix("+"), "password": PASSWORD},
    )

    assert response.status_code == 200
    assert response.json()["user"]["id"] == session["user"]["id"]
    # A new session means a new CSRF token.
    assert response.json()["csrf_token"] != session["csrf_token"]


def test_login_failures_are_indistinguishable(
    db_client: TestClient, created_phones: list[str]
) -> None:
    session = register(db_client, created_phones)
    db_client.cookies.clear()

    wrong_password = db_client.post(
        "/api/v1/auth/login", json={"phone": session["phone"], "password": "wrong password"}
    )
    unknown_phone = db_client.post(
        "/api/v1/auth/login", json={"phone": random_phone(), "password": PASSWORD}
    )

    for response in (wrong_password, unknown_phone):
        assert response.status_code == 401
        assert response.json() == {
            "error": {
                "code": "invalid_credentials",
                "message": "Phone number or password is incorrect",
                "details": None,
            }
        }
        assert SESSION_COOKIE_NAME not in response.headers.get("set-cookie", "")


def test_me_without_session(db_client: TestClient) -> None:
    response = db_client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_logout_needs_csrf_then_revokes_session(
    db_client: TestClient, created_phones: list[str]
) -> None:
    session = register(db_client, created_phones)
    cookie = db_client.cookies.get(SESSION_COOKIE_NAME)

    without_csrf = db_client.post("/api/v1/auth/logout")
    assert without_csrf.status_code == 403
    assert without_csrf.json()["error"]["code"] == "csrf_failed"

    response = db_client.post(
        "/api/v1/auth/logout", headers={CSRF_HEADER_NAME: session["csrf_token"]}
    )
    assert response.status_code == 204
    assert f'{SESSION_COOKIE_NAME}=""' in response.headers["set-cookie"]

    # Replaying the old cookie after logout must fail: the session is revoked server-side.
    db_client.cookies.set(SESSION_COOKIE_NAME, cookie or "")
    assert db_client.get("/api/v1/auth/me").status_code == 401


def test_deactivation_blocks_login_and_existing_sessions(
    db_client: TestClient, created_phones: list[str]
) -> None:
    # FR-002: deactivated accounts cannot access future data.
    session = register(db_client, created_phones)
    phone = session["user"]["phone"]

    run_service(lambda db: service.set_user_active(db, phone=phone, active=False))

    assert db_client.get("/api/v1/auth/me").status_code == 401
    db_client.cookies.clear()
    login = db_client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert login.status_code == 401
    assert login.json()["error"]["code"] == "invalid_credentials"

    run_service(lambda db: service.set_user_active(db, phone=phone, active=True))

    login = db_client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert login.status_code == 200


def test_expired_session_is_rejected(db_client: TestClient, created_phones: list[str]) -> None:
    session = register(db_client, created_phones)
    url = get_settings().sync_database_url.set(drivername="postgresql")

    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        connection.execute(
            "UPDATE user_sessions SET expires_at = now() - interval '1 second' WHERE user_id = %s",
            (session["user"]["id"],),
        )

    assert db_client.get("/api/v1/auth/me").status_code == 401


def test_staff_created_by_service_can_sign_in_with_their_role(
    db_client: TestClient, created_phones: list[str]
) -> None:
    phone = random_phone()
    created_phones.append(phone)

    run_service(
        lambda db: service.create_user(
            db, name="Sample Driver", phone=e164(phone), password=PASSWORD, role=UserRole.DRIVER
        )
    )

    response = db_client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "driver"


def test_login_lockout_after_five_failures_then_success_after_wait(
    db_client: TestClient, created_phones: list[str]
) -> None:
    # NFR-002: even the right password is refused while the phone is limited.
    session = register(db_client, created_phones)
    db_client.cookies.clear()
    phone = session["phone"]

    for _ in range(5):
        wrong = db_client.post("/api/v1/auth/login", json={"phone": phone, "password": "nope nope"})
        assert wrong.status_code == 401
    limited = db_client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert limited.status_code == 429

    get_auth_rate_limits().login_failures_by_phone.reset(e164(phone))  # the window passing
    assert (
        db_client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    ).status_code == 200
