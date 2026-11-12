"""The admin water-source endpoints without a database (#309, #407).

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
    ActivationCostWrite,
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
from app.modules.sources.service import (
    UNSET,
    SourceLocation,
    SourceWithActivations,
    SupplierDetails,
)
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
    ("PATCH", f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}", {"cost_per_litre_minor_units": 180}),
]


def view(
    *,
    approved_until: date,
    status: ActivationStatus = ActivationStatus.ACTIVATED,
    location: SourceLocation | None = None,
    kind: WaterSourceKind | None = WaterSourceKind.BOREHOLE,
    **supplier: Any,
) -> Any:
    """A source with one activation for Utility Water, as the service returns it.

    Column defaults apply only on insert, so the #407 fields are set here.
    """
    source = WaterSource(
        id=SOURCE_ID,
        name="Sample Borehole A",
        approximate_location="Off Ogui Road, Enugu",
        is_simulated=True,
        kind=kind,
        created_at=datetime(2026, 10, 27, 8, 0, tzinfo=UTC),
        **{
            "contact_name": None,
            "contact_phone": None,
            "min_litres_per_order": None,
            "max_litres_per_order": None,
            "is_available": True,
            "serves_keke": True,
            "serves_tanker": True,
            **supplier,
        },
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
    return SourceWithActivations(source, [(activation, UTILITY)], location)


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

    async def change_cost(self, _: object, **kwargs: Any) -> SourceWithActivations:
        return await self._answer("change_cost", kwargs)


@pytest.fixture
def admin_fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeAdmin]:
    fake_admin = FakeAdmin()
    for name in ("list_all", "create", "update", "activate", "set_status", "change_cost"):
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
                "location": None,
                "details": SupplierDetails(),
            },
        )
    ]


def test_a_source_is_added_with_its_pickup_point_and_read_back_with_it(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    admin_fake.current = view(
        approved_until=lagos_today() + timedelta(days=19),
        location=SourceLocation(latitude=6.4361, longitude=7.5134),
    )
    response = api.post(
        BASE,
        json={
            "name": "Sample Borehole A",
            "approximate_location": "Off Ogui Road",
            "location": {"latitude": 6.436123456, "longitude": 7.5134},
        },
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 201
    assert response.json()["location"] == {"latitude": 6.4361, "longitude": 7.5134}
    # Kept to 6 places, as a delivery point.
    assert admin_fake.calls[0][1]["location"] == SourceLocation(6.436123, 7.5134)


def test_a_source_with_no_pickup_point_reads_back_null(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    [source] = api.get(BASE, headers=sign_in(api, UserRole.ADMIN)).json()["items"]
    assert source["location"] is None


def test_a_patch_sets_clears_or_leaves_the_pickup_point(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    headers = sign_in(api, UserRole.ADMIN)
    api.patch(f"{BASE}/{SOURCE_ID}", json={"name": "New"}, headers=headers)
    api.patch(
        f"{BASE}/{SOURCE_ID}",
        json={"location": {"latitude": 6.4, "longitude": 7.5}},
        headers=headers,
    )
    api.patch(f"{BASE}/{SOURCE_ID}", json={"location": None}, headers=headers)
    kept, set_to, cleared = (kwargs["location"] for _, kwargs in admin_fake.calls)
    assert kept is UNSET
    assert set_to == SourceLocation(6.4, 7.5)
    assert cleared is None


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
        # A pickup point outside the delivery bounds, out of range, or half given.
        (
            "POST",
            BASE,
            {
                "name": "A",
                "approximate_location": "B",
                "location": {"latitude": 51.5, "longitude": -0.1},
            },
        ),
        (
            "POST",
            BASE,
            {
                "name": "A",
                "approximate_location": "B",
                "location": {"latitude": 91, "longitude": 7.5},
            },
        ),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "location": {"latitude": 6.4}}),
        ("PATCH", f"{BASE}/{SOURCE_ID}", {"location": {"latitude": 0, "longitude": 0}}),
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
        # #407: contact, litre limits, availability, vehicles and the cost.
        ("POST", BASE, {"name": "A", "approximate_location": "B", "contact_phone": "+4420"}),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "contact_name": " "}),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "min_litres_per_order": 0}),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "max_litres_per_order": "600"}),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "min_litres_per_order": 6.5}),
        (
            "POST",
            BASE,
            {
                "name": "A",
                "approximate_location": "B",
                "min_litres_per_order": 1000,
                "max_litres_per_order": 999,
            },
        ),
        (
            "POST",
            BASE,
            {"name": "A", "approximate_location": "B", "max_litres_per_order": 2**31},
        ),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "vehicle_kinds": []}),
        ("POST", BASE, {"name": "A", "approximate_location": "B", "vehicle_kinds": ["bus"]}),
        (
            "POST",
            BASE,
            {"name": "A", "approximate_location": "B", "vehicle_kinds": ["keke", "keke"]},
        ),
        ("PATCH", f"{BASE}/{SOURCE_ID}", {"is_available": None}),
        ("PATCH", f"{BASE}/{SOURCE_ID}", {"vehicle_kinds": None}),
        ("PATCH", f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}", {}),
        (
            "PATCH",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {"cost_per_litre_minor_units": None},
        ),
        (
            "PATCH",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {"cost_per_litre_minor_units": -1},
        ),
        (
            "PATCH",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {"cost_per_litre_minor_units": "180"},
        ),
        (
            "PATCH",
            f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
            {"cost_per_litre_minor_units": 180, "status": "activated"},
        ),
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


# --- #407: supplier details, order fit and cost edits ---------------------------------


def test_the_list_carries_the_supplier_details_and_source_reasons(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    admin_fake.current = view(
        approved_until=lagos_today() + timedelta(days=90),
        contact_name="Sample Contact",
        contact_phone="+2348030000000",
        min_litres_per_order=600,
        max_litres_per_order=10_000,
        serves_keke=False,
    )
    [source] = api.get(BASE, headers=sign_in(api, UserRole.ADMIN)).json()["items"]
    assert {
        key: source[key]
        for key in (
            "contact_name",
            "contact_phone",
            "min_litres_per_order",
            "max_litres_per_order",
            "is_available",
            "vehicle_kinds",
            "source_reasons",
        )
    } == {
        "contact_name": "Sample Contact",
        "contact_phone": "+2348030000000",
        "min_litres_per_order": 600,
        "max_litres_per_order": 10_000,
        "is_available": True,
        "vehicle_kinds": ["tanker"],
        "source_reasons": [],
    }


def test_a_source_with_no_kind_or_unavailable_lists_both_source_reasons(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    admin_fake.current = view(
        approved_until=lagos_today() + timedelta(days=90), kind=None, is_available=False
    )
    [source] = api.get(BASE, headers=sign_in(api, UserRole.ADMIN)).json()["items"]
    assert source["source_reasons"] == ["kind_not_set", "unavailable"]
    # The activation keeps the four safety reasons only.
    assert source["activations"][0]["reasons"] == []


def test_adding_a_source_with_supplier_details_normalizes_the_phone_and_vehicles(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    response = api.post(
        BASE,
        json={
            "name": "Sample Borehole A",
            "approximate_location": "Off Ogui Road",
            "kind": "borehole",
            "contact_name": " Sample Contact ",
            "contact_phone": "0803 000 0000",
            "min_litres_per_order": 600,
            "max_litres_per_order": 600,
            "is_available": False,
            "vehicle_kinds": ["tanker", "keke"],
        },
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 201
    assert admin_fake.calls[0][1]["details"] == SupplierDetails(
        contact_name="Sample Contact",
        contact_phone="+2348030000000",
        min_litres_per_order=600,
        max_litres_per_order=600,
        is_available=False,
        vehicle_kinds=("keke", "tanker"),
    )


def test_a_patch_sends_only_the_supplier_fields_given_and_null_clears(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    headers = sign_in(api, UserRole.ADMIN)
    api.patch(f"{BASE}/{SOURCE_ID}", json={"name": "New"}, headers=headers)
    api.patch(
        f"{BASE}/{SOURCE_ID}",
        json={"contact_phone": None, "max_litres_per_order": 5000, "vehicle_kinds": ["keke"]},
        headers=headers,
    )
    untouched, changed = (kwargs["changes"] for _, kwargs in admin_fake.calls)
    assert untouched == {}
    assert changed == {
        "contact_phone": None,
        "max_litres_per_order": 5000,
        "vehicle_kinds": ["keke"],
    }


def test_the_cost_patch_sends_only_the_cost(api: TestClient, admin_fake: FakeAdmin) -> None:
    response = api.patch(
        f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
        json={"cost_per_litre_minor_units": 180},
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 200
    assert admin_fake.calls == [
        (
            "change_cost",
            {
                "source_id": SOURCE_ID,
                "category_id": CATEGORY_ID,
                "cost_per_litre_minor_units": 180,
            },
        )
    ]


@pytest.mark.parametrize(
    "code", ["water_source_not_found", "water_category_not_found", "activation_not_found"]
)
def test_the_cost_patch_passes_on_each_404(
    api: TestClient, admin_fake: FakeAdmin, monkeypatch: pytest.MonkeyPatch, code: str
) -> None:
    async def missing(_: object, **__: Any) -> Any:
        raise APIError(404, code, "Not found")

    monkeypatch.setattr(admin, "change_cost", missing)
    response = api.patch(
        f"{BASE}/{SOURCE_ID}/activations/{CATEGORY_ID}",
        json={"cost_per_litre_minor_units": 180},
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert (response.status_code, error_code(response)) == (404, code)
    assert "180" not in response.text


def test_activating_a_source_with_no_kind_is_409(
    api: TestClient, admin_fake: FakeAdmin, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def no_kind(_: object, **__: Any) -> Any:
        raise APIError(
            409,
            "water_source_kind_required",
            "Set where this source collects water before activating it.",
        )

    monkeypatch.setattr(admin, "activate", no_kind)
    _, path, body = ENDPOINTS[3]
    response = api.put(path, json=body, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (409, "water_source_kind_required")


def test_supplier_bodies_accept_the_boundaries() -> None:
    body = WaterSourceCreate(
        name="A",
        approximate_location="B",
        min_litres_per_order=1,
        max_litres_per_order=1,
        vehicle_kinds=["keke"],
    )
    assert (body.min_litres_per_order, body.max_litres_per_order) == (1, 1)
    assert WaterSourceCreate(name="A", approximate_location="B").vehicle_kinds == [
        "keke",
        "tanker",
    ]
    assert WaterSourceUpdate(contact_name=None).supplier_changes() == {"contact_name": None}
    assert ActivationCostWrite(cost_per_litre_minor_units=0).cost_per_litre_minor_units == 0
