"""Driver location boundary/API checks without a database (#410, T-07)."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth.models import User, UserRole
from app.modules.partners import location
from app.modules.partners.location_schemas import DriverLocationRead, DriverLocationUpdate
from tests.test_partners_api import api as partner_api
from tests.test_partners_api import fake, sign_in  # noqa: F401

api = partner_api

BODY = {
    "location": {"latitude": 6.452713, "longitude": 7.510348},
    "accuracy_metres": 0.4,
    "grant": 1,
}
ENDPOINTS = [
    ("POST", "/api/v1/driver/location/sharing", None),
    ("PUT", "/api/v1/driver/location", BODY),
    ("DELETE", "/api/v1/driver/location", None),
]


def test_freshness_boundary_and_config(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 11, 12, tzinfo=UTC)
    monkeypatch.setenv("DRIVER_LOCATION_FRESHNESS_SECONDS", "60")
    get_settings.cache_clear()
    try:
        assert location.freshness(None, now=now) == "none"
        assert location.freshness(now - timedelta(seconds=60), now=now) == "stale"
        assert location.freshness(now - timedelta(seconds=60, microseconds=-1), now=now) == "fresh"
        assert location.freshness(now - timedelta(seconds=61), now=now) == "stale"
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("value", [0, -1, 100000.1, float("inf"), float("nan"), True, "25"])
def test_accuracy_rejects_invalid_values(value: Any) -> None:
    with pytest.raises(ValidationError):
        DriverLocationUpdate.model_validate({**BODY, "accuracy_metres": value})


@pytest.mark.parametrize("value", [0, -1, True, "1", 1.1])
def test_grant_requires_positive_integer(value: Any) -> None:
    with pytest.raises(ValidationError):
        DriverLocationUpdate.model_validate({**BODY, "grant": value})


@pytest.mark.parametrize("seconds", [0, -1])
def test_freshness_setting_must_be_positive(seconds: int) -> None:
    from tests.test_config import make_settings

    with pytest.raises(ValidationError):
        make_settings(driver_location_freshness_seconds=seconds)


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
@pytest.mark.parametrize("role", [None, UserRole.CUSTOMER, UserRole.ADMIN, UserRole.DRIVER])
def test_location_access_and_csrf(
    api: TestClient, method: str, path: str, body: Any, role: UserRole | None
) -> None:
    if role:
        sign_in(api, role)
    response = api.request(method, path, json=body)
    assert response.status_code == (401 if role is None else 403)
    assert response.json()["error"]["code"] == (
        "not_authenticated" if role is None else "csrf_failed"
    )


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
@pytest.mark.parametrize("role", [UserRole.CUSTOMER, UserRole.ADMIN])
def test_other_roles_are_forbidden_even_with_csrf(
    api: TestClient, method: str, path: str, body: Any, role: UserRole
) -> None:
    response = api.request(method, path, json=body, headers=sign_in(api, role))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_location_routes_success_and_no_coordinates(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    async def grant(db: Any, user: User) -> int:
        calls.append("grant")
        return 1

    async def confirm(db: Any, user: User, body: DriverLocationUpdate) -> DriverLocationRead:
        calls.append("point")
        assert body.grant == 1 and body.accuracy_metres == 0.4
        return DriverLocationRead(state="fresh", sharing=True, accuracy_metres=1)

    async def withdraw(db: Any, user: User) -> None:
        calls.append("withdraw")

    monkeypatch.setattr(location, "grant_sharing", grant)
    monkeypatch.setattr(location, "confirm_location", confirm)
    monkeypatch.setattr(location, "withdraw_sharing", withdraw)
    headers = sign_in(api, UserRole.DRIVER)
    assert api.post(ENDPOINTS[0][1], headers=headers).json() == {"grant": 1}
    result = api.put(ENDPOINTS[1][1], json=BODY, headers=headers)
    assert result.status_code == 200 and result.json()["accuracy_metres"] == 1
    assert not {"latitude", "longitude", "grant"} & result.json().keys()
    assert api.delete(ENDPOINTS[2][1], headers=headers).status_code == 204
    assert calls == ["grant", "point", "withdraw"]


def test_location_outside_bounds_has_contract_error(api: TestClient) -> None:
    response = api.put(
        ENDPOINTS[1][1],
        json={**BODY, "location": {"latitude": 0, "longitude": 0}},
        headers=sign_in(api, UserRole.DRIVER),
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "location"]
    assert (
        response.json()["error"]["details"][0]["msg"]
        == "This location is outside the area we deliver in."
    )


@pytest.mark.parametrize(
    "code,status",
    [("driver_offline", 409), ("location_sharing_withdrawn", 409), ("partner_not_approved", 403)],
)
def test_domain_errors_use_envelope(
    api: TestClient, monkeypatch: pytest.MonkeyPatch, code: str, status: int
) -> None:
    async def refuse(*args: Any) -> DriverLocationRead:
        raise APIError(status, code, "Sample refusal")

    monkeypatch.setattr(location, "confirm_location", refuse)
    response = api.put(ENDPOINTS[1][1], json=BODY, headers=sign_in(api, UserRole.DRIVER))
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


@pytest.mark.parametrize("accuracy", [0.4, 25, 25.1, 100000])
def test_supported_accuracy_and_coordinate_precision(accuracy: float) -> None:
    value = DriverLocationUpdate.model_validate(
        {
            **BODY,
            "accuracy_metres": accuracy,
            "location": {"latitude": 6.4527134, "longitude": 7.5103484},
        }
    )
    assert value.accuracy_metres == accuracy
    assert (value.location.latitude, value.location.longitude) == (6.452713, 7.510348)


def test_unknown_coordinate_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        DriverLocationUpdate.model_validate(
            {**BODY, "location": {**BODY["location"], "source": "device_location"}}
        )
