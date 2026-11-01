"""Phone verification and phone change against a real, migrated database (FR-003, FR-004).

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first). Every
account uses a random fictional phone number and is deleted afterwards (its
verification rows go with it, ON DELETE CASCADE). SMS goes to an in-memory mock
provider; time-dependent rules use the service's ``now`` parameter.
"""

import asyncio
import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.main import create_app
from app.modules.auth import phone_verification
from app.modules.auth.dependencies import CSRF_HEADER_NAME
from app.modules.auth.models import PhoneVerification, User, VerificationPurpose
from app.modules.messaging.sms import (
    MockSmsProvider,
    SmsDeliveryStatus,
    SmsFailureReason,
    get_sms_provider,
)
from tests.test_auth_integration import (
    PASSWORD,
    TEST_DATABASE_URL,
    e164,
    random_phone,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

T0 = datetime(2026, 10, 17, 9, 0, tzinfo=UTC)
ORDER = {
    "idempotency_key": "5b0e2c3a-7d1f-4e8a-b6c9-0a1b2c3d4e5f",
    "quantity_litres": 1200,
    "contact_name": "Sample Customer",
    "contact_phone": "08000000001",
    "delivery_address": "12 Sample Close, Independence Layout, Enugu",
}


@pytest.fixture
def phones() -> Iterator[list[str]]:
    """E.164 phones whose accounts are deleted after the test."""
    created: list[str] = []
    yield created
    if created:
        url = get_settings().sync_database_url.set(drivername="postgresql")
        with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
            # Order history first: orders and events are RESTRICT foreign keys.
            connection.execute(
                "DELETE FROM order_events WHERE order_id IN (SELECT o.id FROM orders o "
                "JOIN users u ON u.id = o.customer_id WHERE u.phone = ANY(%s))",
                (created,),
            )
            connection.execute(
                "DELETE FROM orders WHERE customer_id IN "
                "(SELECT id FROM users WHERE phone = ANY(%s))",
                (created,),
            )
            connection.execute("DELETE FROM users WHERE phone = ANY(%s)", (created,))


@pytest.fixture
def sms() -> MockSmsProvider:
    return MockSmsProvider()


@pytest.fixture
def http(monkeypatch: pytest.MonkeyPatch, sms: MockSmsProvider) -> Iterator[TestClient]:
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL or "")
    get_settings.cache_clear()
    app = create_app()
    app.dependency_overrides[get_sms_provider] = lambda: sms
    with TestClient(app) as client:
        yield client
    get_settings.cache_clear()


def last_code(sms: MockSmsProvider) -> str:
    match = re.search(r"\b(\d{6})\b", sms.outbox[-1].text)
    assert match, sms.outbox[-1].text
    return match.group(1)


def register(http: TestClient, phones: list[str]) -> tuple[str, dict[str, str]]:
    """Register a customer; return its E.164 phone and CSRF headers."""
    local = random_phone()
    phones.append(e164(local))
    response = http.post(
        "/api/v1/auth/register",
        json={"name": "Sample Customer", "phone": local, "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    return e164(local), {CSRF_HEADER_NAME: response.json()["csrf_token"]}


def other_code(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


# --- HTTP flows ----------------------------------------------------------------


def test_t16_verify_phone_then_order(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    phone, headers = register(http, phones)

    blocked = http.post("/api/v1/orders", json=ORDER, headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "phone_not_verified"

    sent = http.post("/api/v1/auth/phone-verification", headers=headers)
    assert sent.status_code == 202, sent.text
    assert sent.json()["phone"] == phone
    assert sms.outbox[-1].phone == phone
    assert "+234 813 377 4902" in sms.outbox[-1].text  # support number (FR-055)
    code = last_code(sms)

    wrong = http.post(
        "/api/v1/auth/phone-verification/verify", json={"code": other_code(code)}, headers=headers
    )
    assert wrong.status_code == 400
    assert wrong.json()["error"] == {
        "code": "verification_code_invalid",
        "message": "That code is not right.",
        "details": {"attempts_remaining": 4},
    }

    right = http.post(
        "/api/v1/auth/phone-verification/verify", json={"code": code}, headers=headers
    )
    assert right.status_code == 200, right.text
    assert right.json()["phone_verified"] is True
    assert http.get("/api/v1/auth/me").json()["user"]["phone_verified"] is True

    placed = http.post("/api/v1/orders", json=ORDER, headers=headers)
    assert placed.status_code == 201, placed.text

    again = http.post("/api/v1/auth/phone-verification", headers=headers)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "phone_already_verified"


def test_resend_within_60_seconds_is_refused(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    _, headers = register(http, phones)
    assert http.post("/api/v1/auth/phone-verification", headers=headers).status_code == 202

    resend = http.post("/api/v1/auth/phone-verification", headers=headers)

    assert resend.status_code == 429
    wait = resend.json()["error"]["details"]["retry_after_seconds"]
    assert 50 <= wait <= 60
    assert resend.headers["Retry-After"] == str(wait)
    assert len(sms.outbox) == 1


def test_sms_failure_stores_nothing(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    phone, headers = register(http, phones)
    sms.fail = True

    failed = http.post("/api/v1/auth/phone-verification", headers=headers)
    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "sms_unavailable"
    assert run(lambda session: count_rows(session, phone)) == 0

    # Not counted against the cooldown: the customer can retry at once.
    sms.fail = False
    assert http.post("/api/v1/auth/phone-verification", headers=headers).status_code == 202


def test_phone_change_verifies_the_new_number(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    old_phone, headers = register(http, phones)
    new_local = random_phone()
    phones.append(e164(new_local))

    wrong_password = http.post(
        "/api/v1/auth/phone-change",
        json={"phone": new_local, "password": "not the password"},
        headers=headers,
    )
    assert wrong_password.status_code == 403
    assert wrong_password.json()["error"]["code"] == "password_incorrect"

    same = http.post(
        "/api/v1/auth/phone-change",
        json={"phone": old_phone, "password": PASSWORD},
        headers=headers,
    )
    assert same.status_code == 409
    assert same.json()["error"]["code"] == "phone_unchanged"

    sent = http.post(
        "/api/v1/auth/phone-change",
        json={"phone": new_local, "password": PASSWORD},
        headers=headers,
    )
    assert sent.status_code == 202, sent.text
    assert sms.outbox[-1].phone == e164(new_local)
    # The account keeps its number until the new one is verified (FR-004).
    assert http.get("/api/v1/auth/me").json()["user"]["phone"] == old_phone

    changed = http.post(
        "/api/v1/auth/phone-change/verify", json={"code": last_code(sms)}, headers=headers
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["phone"] == e164(new_local)
    assert changed.json()["phone_verified"] is True

    rows = run(lambda session: verification_rows(session, e164(new_local)))
    assert [row.replaced_phone for row in rows] == [old_phone]

    http.post("/api/v1/auth/logout", headers=headers)
    login = http.post("/api/v1/auth/login", json={"phone": new_local, "password": PASSWORD})
    assert login.status_code == 200


def test_phone_change_to_a_registered_number_is_refused(
    http: TestClient, phones: list[str]
) -> None:
    taken_phone, _ = register(http, phones)
    http.cookies.clear()
    _, headers = register(http, phones)

    response = http.post(
        "/api/v1/auth/phone-change",
        json={"phone": taken_phone, "password": PASSWORD},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "phone_already_registered"


# --- Service rules with a controlled clock ---------------------------------------


def run(call):  # type: ignore[no-untyped-def]
    async def _run():  # type: ignore[no-untyped-def]
        engine = create_async_engine(TEST_DATABASE_URL or "")
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                return await call(session)
        finally:
            await engine.dispose()

    return asyncio.run(_run())


async def count_rows(session: AsyncSession, phone: str) -> int:
    return len(await verification_rows(session, phone))


async def verification_rows(session: AsyncSession, phone: str) -> list[PhoneVerification]:
    return list(
        await session.scalars(select(PhoneVerification).where(PhoneVerification.phone == phone))
    )


def new_customer(http: TestClient, phones: list[str]) -> str:
    phone, _ = register(http, phones)
    http.cookies.clear()
    return phone


async def _user(session: AsyncSession, phone: str) -> User:
    user = await session.scalar(select(User).where(User.phone == phone))
    assert user is not None
    return user


def send(phone: str, sms: MockSmsProvider, now: datetime) -> str:
    async def call(session: AsyncSession) -> None:
        await phone_verification.send_code(
            session,
            user=await _user(session, phone),
            purpose=VerificationPurpose.ACCOUNT_PHONE,
            sms=sms,
            now=now,
        )

    run(call)
    return last_code(sms)


def verify(phone: str, code: str, now: datetime) -> str:
    """Return "ok" or the error code."""

    async def call(session: AsyncSession) -> str:
        try:
            await phone_verification.verify_code(
                session,
                user=await _user(session, phone),
                purpose=VerificationPurpose.ACCOUNT_PHONE,
                code=code,
                now=now,
            )
        except phone_verification.APIError as error:
            return error.code
        return "ok"

    return run(call)


def test_at_most_three_codes_per_hour(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    phone = new_customer(http, phones)
    for minutes in (0, 2, 4):
        send(phone, sms, T0 + timedelta(minutes=minutes))

    async def fourth(session: AsyncSession) -> object:
        try:
            await phone_verification.send_code(
                session,
                user=await _user(session, phone),
                purpose=VerificationPurpose.ACCOUNT_PHONE,
                sms=sms,
                now=T0 + timedelta(minutes=6),
            )
        except phone_verification.APIError as error:
            return error.status_code, error.details
        return None

    # The first code ages out of the hour at T0 + 60 min, 54 minutes later.
    assert run(fourth) == (429, {"retry_after_seconds": 54 * 60})
    send(phone, sms, T0 + timedelta(minutes=60, seconds=1))
    assert len(sms.outbox) == 4


def test_code_expires_after_five_minutes(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    phone = new_customer(http, phones)
    code = send(phone, sms, T0)

    assert verify(phone, code, T0 + timedelta(minutes=5)) == "verification_code_expired"
    assert verify(phone, code, T0 + timedelta(minutes=4, seconds=59)) == "ok"


def test_fifth_wrong_code_voids_it(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    phone = new_customer(http, phones)
    code = send(phone, sms, T0)

    results = [verify(phone, other_code(code), T0 + timedelta(seconds=10)) for _ in range(5)]
    assert results == ["verification_code_invalid"] * 5
    assert verify(phone, code, T0 + timedelta(seconds=20)) == "verification_code_expired"


def test_new_code_replaces_the_old_one_and_codes_work_once(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    phone = new_customer(http, phones)
    first = send(phone, sms, T0)
    second = send(phone, sms, T0 + timedelta(seconds=61))

    if first != second:
        assert verify(phone, first, T0 + timedelta(seconds=70)) == "verification_code_invalid"
    assert verify(phone, second, T0 + timedelta(seconds=71)) == "ok"
    assert verify(phone, second, T0 + timedelta(seconds=72)) == "verification_code_expired"

    rows = run(lambda session: verification_rows(session, phone))
    assert all(len(row.code_hash) == 64 and second not in row.code_hash for row in rows)
    assert sorted(row.invalidated_at is not None for row in rows) == [False, True]


# --- Delivery status: accepted is not delivered ---------------------------------


def test_a_sent_code_is_accepted_not_delivered(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    phone, headers = register(http, phones)
    sms.status = SmsDeliveryStatus.ACCEPTED

    sent = http.post("/api/v1/auth/phone-verification", headers=headers)
    status = http.get("/api/v1/auth/phone-verification/status")

    assert sent.json()["delivery_status"] == "accepted"
    assert status.status_code == 200
    assert status.json()["delivery_status"] == "accepted"
    rows = run(lambda session: verification_rows(session, phone))
    assert [(r.sms_status, r.sms_message_id) for r in rows] == [("accepted", "mock-1")]


def test_delivery_report_moves_the_code_to_delivered(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    _, headers = register(http, phones)
    http.post("/api/v1/auth/phone-verification", headers=headers)
    sms.status = SmsDeliveryStatus.DELIVERED

    assert (
        http.get("/api/v1/auth/phone-verification/status").json()["delivery_status"] == "delivered"
    )


def test_failed_delivery_is_reported_and_keeps_every_limit(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    """A code the carrier refused is shown as failed, but cooldown and expiry stand (FR-003)."""
    _, headers = register(http, phones)
    http.post("/api/v1/auth/phone-verification", headers=headers)
    sms.status = SmsDeliveryStatus.FAILED

    status = http.get("/api/v1/auth/phone-verification/status")

    assert status.json()["delivery_status"] == "failed"
    resend = http.post("/api/v1/auth/phone-verification", headers=headers)
    assert resend.status_code == 429
    assert len(sms.outbox) == 1


def test_status_without_a_code_is_expired(http: TestClient, phones: list[str]) -> None:
    register(http, phones)

    response = http.get("/api/v1/auth/phone-verification/status")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "verification_code_expired"


def test_provider_refusal_reason_is_not_shown_to_the_customer(
    http: TestClient, phones: list[str], sms: MockSmsProvider
) -> None:
    _, headers = register(http, phones)
    sms.fail = True
    sms.fail_reason = SmsFailureReason.SENDER_ID

    failed = http.post("/api/v1/auth/phone-verification", headers=headers)

    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "sms_unavailable"
    assert "sender" not in failed.text.lower()
