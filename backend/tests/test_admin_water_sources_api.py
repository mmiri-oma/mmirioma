"""The admin water-source endpoints without a database (#309).

docs/api/admin-water-sources.md: who may call them, what they validate, the
shape of the answer and the expiry state. The service functions are replaced
by fakes; the database behaviour is in
test_admin_water_sources_integration.py.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.errors import APIError
from app.modules.auth.models import UserRole
from app.modules.sources import admin
from app.modules.sources.admin_schemas import (
    ActivationStatusWrite,
    ActivationWrite,
    WaterSourceCreate,
    WaterSourceUpdate,
    expiry_for,
)
from app.modules.sources.models import (
    ActivationStatus,
    WaterCategory,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)
from app.modules.sources.service import SourceWithActivations
from app.shared.lagos_time import lagos_today
from tests import test_customer_account_api as account_api
from tests.test_customer_account_api import sign_in

api = account_api.api
fake = account_api.fake  # the customer service fakes the shared client needs

BASE = "/api/v1/admin/water-sources"
SOURCE_ID = uuid.uuid4()
CATEGORY_ID = uuid.uuid4()
UTILITY = WaterCategory(id=CATEGORY_ID, code="utility", label="Utility Water", is_active=True)
POTABLE = WaterCategory(id=uuid.uuid4(), code="potable", label="Potable Water", is_active=True)

ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", BASE, None),
    ("POST", BASE, {"name": "Sample Borehole A", "approximate_location": "Off Ogui Road"}),
    ("PATCH", f"{BASE}/{SOURCE_ID}", {"name": "Sample Borehole B"}),
    (
        "PUT",
        f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
        {
            "approved_until": (lagos_today() + timedelta(days=90)).isoformat(),
            "report_reference": "SAMPLE-LR-0001",
            "cost_per_litre_minor_units": 150,
        },
    ),
    (
        "POST",
        f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}/status",
        {"status": "suspended", "reason": "Pump repair."},
    ),
]


def view(*, approved_until: date, status: ActivationStatus = ActivationStatus.ACTIVATED) -> Any:
    """A source with one activation for Utility Water, as the service returns it."""
    source = WaterSource(
        id=SOURCE_ID,
        name="Sample Borehole A",
        approximate_location="Off Ogui Road, Enugu",
        is_simulated=True,
        kind=WaterSourceKind.BOREHOLE,
        created_at=datetime(2026, 10, 27, 8, 0, tzinfo=UTC),
    )
    activation = WaterSourceCategory(
        source_id=SOURCE_ID,
        water_category_id=CATEGORY_ID,
        status=status,
        approved_until=approved_until,
        report_reference="SAMPLE-LR-0001",
        cost_per_litre_minor_units=150,
        status_reason=None if status is ActivationStatus.ACTIVATED else "Pump repair.",
    )
    return SourceWithActivations(source, [(activation, UTILITY)])


class FakeAdmin:
    """Replaces :mod:`app.modules.sources.admin` and records the calls."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.current = view(approved_until=lagos_today() + timedelta(days=19))

    async def _answer(self, name: str, kwargs: dict[str, Any]) -> SourceWithActivations:
        kwargs.pop("actor", None)
        self.calls.append((name, kwargs))
        return self.current

    async def list_all(self, _: object) -> tuple[list[SourceWithActivations], list[WaterCategory]]:
        self.calls.append(("list_all", {}))
        return [self.current], [POTABLE, UTILITY]

    async def create(self, _: object, **kwargs: Any) -> SourceWithActivations:
        return await self._answer("create", kwargs)

    async def update(self, _: object, **kwargs: Any) -> SourceWithActivations:
        return await self._answer("update", kwargs)

    async def activate(self, _: object, **kwargs: Any) -> SourceWithActivations:
        return await self._answer("activate", kwargs)

    async def set_status(self, _: object, **kwargs: Any) -> SourceWithActivations:
        return await self._answer("set_status", kwargs)


@pytest.fixture
def admin_fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeAdmin]:
    fake_admin = FakeAdmin()
    for name in ("list_all", "create", "update", "activate", "set_status"):
        monkeypatch.setattr(admin, name, getattr(fake_admin, name))
    yield fake_admin


def call(client: TestClient, method: str, path: str, body: Any, headers: dict[str, str]) -> Any:
    return client.request(method, path, json=body, headers=headers)


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


# --- Who may call -------------------------------------------------------------------


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_signed_out_is_not_authenticated(
    api: TestClient, admin_fake: FakeAdmin, method: str, path: str, body: Any
) -> None:
    response = call(api, method, path, body, {})
    assert (response.status_code, error_code(response)) == (401, "not_authenticated")
    assert admin_fake.calls == []


@pytest.mark.parametrize("role", [UserRole.CUSTOMER, UserRole.DRIVER])
@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_customers_and_drivers_are_forbidden(
    api: TestClient, admin_fake: FakeAdmin, role: UserRole, method: str, path: str, body: Any
) -> None:
    response = call(api, method, path, body, sign_in(api, role))
    assert (response.status_code, error_code(response)) == (403, "forbidden")
    assert admin_fake.calls == []
    assert "cost_per_litre" not in response.text


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS[1:])
def test_writes_need_the_csrf_token(
    api: TestClient, admin_fake: FakeAdmin, method: str, path: str, body: Any
) -> None:
    sign_in(api, UserRole.ADMIN)
    response = call(api, method, path, body, {})
    assert response.status_code == 403
    assert admin_fake.calls == []


# --- What they answer ---------------------------------------------------------------


def test_the_list_carries_the_activation_expiry_reasons_and_cost(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    response = api.get(BASE, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    body = response.json()
    assert [c["code"] for c in body["categories"]] == ["potable", "utility"]
    [source] = body["items"]
    assert source["kind"] == "borehole"
    assert source["is_simulated"] is True
    [activation] = source["activations"]
    assert activation["category"]["label"] == "Utility Water"
    assert activation["cost_per_litre_minor_units"] == 150
    assert activation["expiry"] == {"state": "expires_soon", "days_left": 19}
    assert activation["reasons"] == []
    assert activation["status_reason"] is None


def test_a_suspended_activation_names_its_reason_and_why_it_is_not_eligible(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    admin_fake.current = view(
        approved_until=lagos_today() + timedelta(days=90), status=ActivationStatus.SUSPENDED
    )
    [source] = api.get(BASE, headers=sign_in(api, UserRole.ADMIN)).json()["items"]
    [activation] = source["activations"]
    assert activation["status"] == "suspended"
    assert activation["status_reason"] == "Pump repair."
    assert activation["reasons"] == ["suspended"]
    assert activation["expiry"]["state"] == "ok"


def test_adding_a_source_answers_201_with_the_source(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    response = api.post(
        BASE,
        json={
            "name": "  Sample Borehole A ",
            "approximate_location": "Off Ogui Road",
            "kind": None,
        },
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 201
    assert admin_fake.calls == [
        (
            "create",
            {
                "name": "Sample Borehole A",
                "approximate_location": "Off Ogui Road",
                "kind": None,
                "is_simulated": False,
            },
        )
    ]


def test_an_unknown_source_is_a_404_with_the_contract_code(
    api: TestClient, admin_fake: FakeAdmin, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def missing(_: object, **__: Any) -> Any:
        raise APIError(404, "water_source_not_found", "Water source not found")

    monkeypatch.setattr(admin, "update", missing)
    response = api.patch(
        f"{BASE}/{SOURCE_ID}", json={"name": "New"}, headers=sign_in(api, UserRole.ADMIN)
    )
    assert (response.status_code, error_code(response)) == (404, "water_source_not_found")


# --- What they refuse ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", BASE, {"name": " ", "approximate_location": "Somewhere"}),
        ("POST", BASE, {"name": "A", "approximate_location": ""}),
        ("POST", BASE, {"name": "A" * 121, "approximate_location": "Somewhere"}),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "kind": "spring"}),
        ("PATCH", f"{BASE}/{SOURCE_ID}", {}),
        ("PATCH", f"{BASE}/{SOURCE_ID}", {"kind": None}),
        ("PATCH", f"{BASE}/{SOURCE_ID}", {"name": None}),
        (
            "PUT",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {
                "approved_until": (lagos_today() - timedelta(days=1)).isoformat(),
                "report_reference": "SAMPLE-LR-0001",
                "cost_per_litre_minor_units": 150,
            },
        ),
        (
            "PUT",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {
                "approved_until": lagos_today().isoformat(),
                "report_reference": " ",
                "cost_per_litre_minor_units": 150,
            },
        ),
        (
            "PUT",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {
                "approved_until": lagos_today().isoformat(),
                "report_reference": "SAMPLE-LR-0001",
                "cost_per_litre_minor_units": -1,
            },
        ),
        (
            "PUT",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {
                "approved_until": lagos_today().isoformat(),
                "report_reference": "SAMPLE-LR-0001",
                "cost_per_litre_minor_units": 1.5,
            },
        ),
        (
            "POST",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}/status",
            {"status": "activated", "reason": "No."},
        ),
        (
            "POST",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}/status",
            {"status": "revoked", "reason": " "},
        ),
        ("PATCH", f"{BASE}/not-a-uuid", {"name": "New"}),
    ],
)
def test_bad_bodies_are_422_and_nothing_runs(
    api: TestClient, admin_fake: FakeAdmin, method: str, path: str, body: dict[str, Any]
) -> None:
    response = call(api, method, path, body, sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert admin_fake.calls == []


# --- The pure rules -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("days", "state"),
    [(-1, "expired"), (0, "expires_soon"), (1, "expires_soon"), (30, "expires_soon"), (31, "ok")],
)
def test_expiry_counts_the_last_valid_day_and_a_30_day_window(days: int, state: str) -> None:
    today = date(2026, 11, 1)
    result = expiry_for(today + timedelta(days=days), today=today)
    assert (result.state, result.days_left) == (state, days)


def test_a_body_is_trimmed_and_a_patch_may_send_one_field() -> None:
    assert WaterSourceCreate(name=" A ", approximate_location=" B ").name == "A"
    assert WaterSourceUpdate(kind="ninth_mile").model_fields_set == {"kind"}


def test_today_is_a_valid_approved_until_and_yesterday_is_not() -> None:
    today = lagos_today()
    ActivationWrite(approved_until=today, report_reference="R", cost_per_litre_minor_units=0)
    with pytest.raises(ValidationError):
        ActivationWrite(
            approved_until=today - timedelta(days=1),
            report_reference="R",
            cost_per_litre_minor_units=0,
        )


def test_the_status_body_takes_only_suspended_or_revoked() -> None:
    assert ActivationStatusWrite(status="revoked", reason="Withdrawn.").status == "revoked"
    with pytest.raises(ValidationError):
        ActivationStatusWrite(status="activated", reason="No.")
