"""Rate limiting of sign-in and registration (NFR-002). No database needed."""

from http import HTTPStatus

import pytest
from fastapi.testclient import TestClient

from app.core.errors import APIError
from app.modules.auth import service
from app.modules.auth.rate_limit import AuthRateLimits, SlidingWindowLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


def test_limiter_refuses_at_limit_and_reports_wait(clock: FakeClock) -> None:
    limiter = SlidingWindowLimiter(limit=3, window_seconds=60, clock=clock)
    for _ in range(2):
        limiter.hit("k")
    assert limiter.retry_after("k") is None

    limiter.hit("k")
    clock.now += 10

    assert limiter.retry_after("k") == 50
    assert limiter.retry_after("other") is None


def test_limiter_window_slides(clock: FakeClock) -> None:
    limiter = SlidingWindowLimiter(limit=2, window_seconds=60, clock=clock)
    limiter.hit("k")
    clock.now += 30
    limiter.hit("k")

    clock.now += 30  # first event leaves the window
    assert limiter.retry_after("k") is None
    limiter.hit("k")
    assert limiter.retry_after("k") == 30


def test_limiter_retry_after_is_at_least_one_second(clock: FakeClock) -> None:
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60, clock=clock)
    limiter.hit("k")
    clock.now += 59.9

    assert limiter.retry_after("k") == 1


def test_limiter_reset_and_undo(clock: FakeClock) -> None:
    limiter = SlidingWindowLimiter(limit=2, window_seconds=60, clock=clock)
    limiter.hit("k")
    limiter.hit("k")

    limiter.undo("k")
    assert limiter.retry_after("k") is None
    limiter.hit("k")
    limiter.reset("k")
    assert limiter.retry_after("k") is None
    limiter.undo("missing")  # no error


def test_limiter_evicts_least_recently_used_keys(clock: FakeClock) -> None:
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60, clock=clock, max_keys=2)
    limiter.hit("a")
    limiter.hit("b")
    limiter.hit("c")

    assert limiter.retry_after("a") is None  # evicted
    assert limiter.retry_after("b") == 60
    assert limiter.retry_after("c") == 60


def test_login_attempts_count_before_they_finish() -> None:
    # Regression guard for the concurrency hole: five attempts still waiting
    # on their password check must already block a sixth.
    limits = AuthRateLimits()
    for _ in range(5):
        limits.begin_login("+2348000000001", "203.0.113.1")

    with pytest.raises(APIError) as exc_info:
        limits.begin_login("+2348000000001", "203.0.113.2")

    assert exc_info.value.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert exc_info.value.code == "too_many_attempts"
    assert exc_info.value.headers is not None
    assert int(exc_info.value.headers["Retry-After"]) > 0


def test_successful_login_clears_phone_but_only_withdraws_one_ip_attempt() -> None:
    limits = AuthRateLimits()
    for _ in range(4):
        limits.begin_login("+2348000000001", "203.0.113.1")
    limits.begin_login("+2348000000001", "203.0.113.1")
    limits.login_succeeded("+2348000000001", "203.0.113.1")

    limits.begin_login("+2348000000001", "203.0.113.1")  # phone counter was cleared
    assert len(limits.login_failures_by_ip._events["203.0.113.1"]) == 5


def test_ip_limit_applies_across_phones() -> None:
    limits = AuthRateLimits()
    for number in range(50):
        limits.begin_login(f"+23480000{number:05d}", "203.0.113.1")

    with pytest.raises(APIError):
        limits.begin_login("+2348099999999", "203.0.113.1")
    limits.begin_login("+2348099999999", "198.51.100.7")  # another IP is unaffected


def invalid_credentials() -> APIError:
    return APIError(
        HTTPStatus.UNAUTHORIZED, "invalid_credentials", "Phone number or password is incorrect"
    )


def test_login_endpoint_returns_429_after_five_failures(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    async def failing_authenticate(*_: object, **__: object) -> None:
        nonlocal calls
        calls += 1
        raise invalid_credentials()

    monkeypatch.setattr(service, "authenticate", failing_authenticate)
    body = {"phone": "08000000001", "password": "guess guess"}

    for _ in range(5):
        assert client.post("/api/v1/auth/login", json=body).status_code == 401
    response = client.post("/api/v1/auth/login", json=body)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_attempts"
    assert int(response.headers["retry-after"]) > 0
    assert response.json()["error"]["details"]["retry_after_seconds"] > 0
    assert calls == 5  # the password is not checked once limited


def test_login_limit_counts_every_phone_format_as_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def failing_authenticate(*_: object, **__: object) -> None:
        raise invalid_credentials()

    monkeypatch.setattr(service, "authenticate", failing_authenticate)
    formats = ["08000000001", "2348000000001", "+2348000000001", "0800 000 0001", "8000000001"]

    for phone in formats:
        client.post("/api/v1/auth/login", json={"phone": phone, "password": "guess guess"})
    response = client.post(
        "/api/v1/auth/login", json={"phone": "08000000001", "password": "guess guess"}
    )

    assert response.status_code == 429


def test_register_endpoint_returns_429_after_twenty_attempts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def conflicting_create_user(*_: object, **__: object) -> None:
        raise APIError(HTTPStatus.CONFLICT, "phone_already_registered", "Taken")

    monkeypatch.setattr(service, "create_user", conflicting_create_user)
    body = {"name": "Sample", "phone": "08000000001", "password": "long enough"}

    for _ in range(20):
        assert client.post("/api/v1/auth/register", json=body).status_code == 409
    response = client.post("/api/v1/auth/register", json=body)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_attempts"
