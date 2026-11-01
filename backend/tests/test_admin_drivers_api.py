"""Admin driver directory endpoints that need no database (#45, part 2).

docs/api/admin-directory.md, "Drivers": roles (FR-001), the CSRF header on the
two writes, the query rules, the approval and activation body rules (a reason of
5-500 characters to suspend or deactivate, no vehicle with a suspension, never
back to ``pending``, each transfer method once, the payload range), and bodies
equal to the contract examples, with the directory service faked. The queries
and the rules that need data run against a real database in
test_admin_drivers_integration.py.
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.errors import APIError
from app.modules.auth.dependencies import CSRF_HEADER_NAME
from app.modules.auth.models import User, UserRole
from app.modules.dispatch.models import (
    ApprovalStatus,
    DeliveryType,
    DriverProfile,
    VehicleProfile,
)
from app.modules.partners import directory
from app.modules.pricing.models import ServiceZone
from tests import test_customer_account_api as account_api
from tests.test_customer_account_api import sign_in

api = account_api.api
fake = account_api.fake  # the customer service fakes the shared client needs

EXAMPLES = Path(__file__).resolve().parents[2] / "docs" / "api" / "examples"


def example(name: str) -> Any:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


PAGE = example("admin-drivers-page.json")
DRIVER = PAGE["items"][0]
APPROVE = example("admin-driver-approval-request.json")
SUSPEND = example("admin-driver-suspension-request.json")
DEACTIVATE = example("admin-driver-activation-request.json")
PHONE_ERROR = example("error-partner-phone-not-verified.json")

LIST_PATH = "/api/v1/admin/drivers"
DETAIL_PATH = f"{LIST_PATH}/{DRIVER['id']}"
APPROVAL_PATH = f"{DETAIL_PATH}/approval"
ACTIVATION_PATH = f"{DETAIL_PATH}/activation"
ENDPOINTS = [
    ("GET", LIST_PATH, None),
    ("GET", DETAIL_PATH, None),
    ("POST", APPROVAL_PATH, APPROVE),
    ("POST", ACTIVATION_PATH, DEACTIVATE),
]


def at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def row_from(body: dict[str, Any]) -> directory.DriverRow:
    vehicle = body["vehicle"]
    user = User(
        id=uuid.UUID(body["id"]),
        name=body["name"],
        phone=body["phone"],
        role=UserRole.DRIVER,
        is_active=body["is_active"],
        phone_verified_at=at(body["created_at"]) if body["phone_verified"] else None,
        created_at=at(body["created_at"]),
    )
    profile = DriverProfile(
        approval_status=ApprovalStatus(body["approval_status"]),
        is_available=body["is_available"],
        delivery_type=DeliveryType(vehicle["delivery_type"]) if vehicle["delivery_type"] else None,
        plate=vehicle["plate"],
        declared_capacity_gallons=vehicle["declared_capacity_gallons"],
        transfer_methods=vehicle["transfer_methods"],
    )
    verified = (
        VehicleProfile(
            vehicle_type=vehicle["description"], safe_payload_litres=vehicle["safe_payload_litres"]
        )
        if vehicle["description"] is not None
        else None
    )
    zones = [ServiceZone(id=uuid.UUID(z["id"]), name=z["name"]) for z in body["zones"]]
    return directory.DriverRow(
        user=user,
        profile=profile,
        vehicle=verified,
        zones=zones,
        live_jobs=body["live_jobs"],
        completed_jobs=body["completed_jobs"],
        delivered_jobs=body["delivered_jobs"],
    )


class FakeDirectory:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.raises: APIError | None = None

    async def list_drivers(self, _: object, **kwargs: Any) -> directory.DriverPage:
        self.calls.append(("list_drivers", kwargs))
        return directory.DriverPage(
            rows=[row_from(item) for item in PAGE["items"]],
            total=PAGE["total"],
            counts=directory.DriverCounts(**PAGE["counts"]),
        )

    async def get_driver(self, _: object, driver_id: uuid.UUID) -> directory.DriverRow:
        self.calls.append(("get_driver", {"driver_id": driver_id}))
        if self.raises:
            raise self.raises
        return row_from(DRIVER)

    async def set_approval(self, _: object, **kwargs: Any) -> directory.DriverRow:
        self.calls.append(("set_approval", kwargs))
        if self.raises:
            raise self.raises
        return row_from(DRIVER)

    async def set_activation(self, _: object, **kwargs: Any) -> directory.DriverRow:
        self.calls.append(("set_activation", kwargs))
        if self.raises:
            raise self.raises
        return row_from(DRIVER)


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> FakeDirectory:
    fake_directory = FakeDirectory()
    for name in ("list_drivers", "get_driver", "set_approval", "set_activation"):
        monkeypatch.setattr(directory, name, getattr(fake_directory, name))
    return fake_directory


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_signed_out_is_not_authenticated(
    api: TestClient, service: FakeDirectory, method: str, path: str, body: Any
) -> None:
    response = api.request(method, path, json=body)
    assert (response.status_code, error_code(response)) == (401, "not_authenticated")
    assert service.calls == []


@pytest.mark.parametrize("role", [UserRole.CUSTOMER, UserRole.DRIVER])
@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_customers_and_drivers_are_forbidden(
    api: TestClient, service: FakeDirectory, role: UserRole, method: str, path: str, body: Any
) -> None:
    response = api.request(method, path, json=body, headers=sign_in(api, role))
    assert (response.status_code, error_code(response)) == (403, "forbidden")
    assert service.calls == []


def test_the_list_matches_the_example_and_passes_the_defaults(
    api: TestClient, service: FakeDirectory
) -> None:
    response = api.get(LIST_PATH, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json() == PAGE
    assert service.calls == [
        (
            "list_drivers",
            {
                "delivery_type": None,
                "approval_status": None,
                "is_active": None,
                "q": None,
                "limit": 50,
                "offset": 0,
            },
        )
    ]


def test_the_filters_and_trimmed_search_reach_the_service(
    api: TestClient, service: FakeDirectory
) -> None:
    api.get(
        LIST_PATH,
        params={
            "delivery_type": "keke",
            "approval_status": "pending",
            "is_active": "false",
            "q": "  tanker ",
            "limit": 10,
            "offset": 5,
        },
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert service.calls[0][1] == {
        "delivery_type": DeliveryType.KEKE,
        "approval_status": ApprovalStatus.PENDING,
        "is_active": False,
        "q": "tanker",
        "limit": 10,
        "offset": 5,
    }


@pytest.mark.parametrize(
    "query",
    [
        {"delivery_type": "truck"},
        {"approval_status": "inactive"},
        {"is_active": "maybe"},
        {"q": ""},
        {"q": "x" * 101},
        {"limit": 0},
        {"limit": 101},
        {"offset": -1},
    ],
)
def test_bad_list_queries_are_validation_errors(
    api: TestClient, service: FakeDirectory, query: dict[str, Any]
) -> None:
    response = api.get(LIST_PATH, params=query, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert service.calls == []


def test_the_detail_matches_the_first_example_driver(
    api: TestClient, service: FakeDirectory
) -> None:
    response = api.get(DETAIL_PATH, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json() == DRIVER


def test_an_unknown_driver_is_404_driver_not_found(api: TestClient, service: FakeDirectory) -> None:
    service.raises = APIError(404, "driver_not_found", "Driver not found")
    response = api.get(DETAIL_PATH, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (404, "driver_not_found")


def test_approving_passes_the_verified_vehicle_and_returns_the_driver(
    api: TestClient, service: FakeDirectory
) -> None:
    response = api.post(APPROVAL_PATH, json=APPROVE, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json() == DRIVER
    kwargs = service.calls[0][1]
    assert kwargs["driver_id"] == uuid.UUID(DRIVER["id"])
    assert kwargs["approval_status"] is ApprovalStatus.APPROVED
    assert kwargs["reason"] is None
    assert kwargs["admin"].role is UserRole.ADMIN
    assert kwargs["vehicle"] == directory.VehicleInput(
        description="Tanker truck",
        safe_payload_litres=12000,
        transfer_methods=["ground", "overhead"],
    )


def test_suspending_passes_the_reason_and_no_vehicle(
    api: TestClient, service: FakeDirectory
) -> None:
    response = api.post(APPROVAL_PATH, json=SUSPEND, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    kwargs = service.calls[0][1]
    assert kwargs["approval_status"] is ApprovalStatus.SUSPENDED
    assert kwargs["reason"] == SUSPEND["reason"]
    assert kwargs["vehicle"] is None


@pytest.mark.parametrize(
    ("code", "status", "message"),
    [
        ("partner_phone_not_verified", 409, PHONE_ERROR["error"]["message"]),
        ("driver_inactive", 409, "This account is deactivated. Activate it first."),
        ("driver_has_accepted_job", 409, "This driver has a job in progress."),
    ],
)
def test_the_services_refusals_use_the_error_envelope(
    api: TestClient, service: FakeDirectory, code: str, status: int, message: str
) -> None:
    service.raises = APIError(status, code, message)
    response = api.post(APPROVAL_PATH, json=APPROVE, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == status
    assert response.json() == {"error": {"code": code, "message": message, "details": None}}


@pytest.mark.parametrize(
    "changes",
    [
        {"approval_status": "pending"},  # never back to pending
        {"approval_status": "inactive"},
        {"approval_status": "suspended", "reason": None, "vehicle": None},  # reason required
        {"approval_status": "suspended", "reason": "bad", "vehicle": None},  # 5 characters at least
        {"approval_status": "suspended", "reason": "x" * 501, "vehicle": None},
        {
            "approval_status": "suspended",
            "reason": "Papers expired",
        },  # no vehicle with a suspension
        {"reason": "x" * 501},
        {"is_active": False},  # unknown fields are refused
        {"vehicle": {**APPROVE["vehicle"], "description": ""}},
        {"vehicle": {**APPROVE["vehicle"], "description": "x" * 51}},
        {"vehicle": {**APPROVE["vehicle"], "safe_payload_litres": 0}},
        {"vehicle": {**APPROVE["vehicle"], "safe_payload_litres": 100_001}},
        {"vehicle": {**APPROVE["vehicle"], "safe_payload_litres": 1200.5}},
        {"vehicle": {**APPROVE["vehicle"], "transfer_methods": ["ground", "ground"]}},
        {"vehicle": {**APPROVE["vehicle"], "transfer_methods": ["pump"]}},
        {"vehicle": {**APPROVE["vehicle"], "plate": "ENU-1"}},  # the plate is the partner's own
    ],
)
def test_a_bad_approval_body_is_a_validation_error(
    api: TestClient, service: FakeDirectory, changes: dict[str, Any]
) -> None:
    body = {**APPROVE, **changes}
    response = api.post(APPROVAL_PATH, json=body, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert service.calls == []


def test_the_vehicle_may_have_no_transfer_methods_and_the_reason_is_trimmed(
    api: TestClient, service: FakeDirectory
) -> None:
    body = {
        "approval_status": "approved",
        "reason": "  Checked in person  ",
        "vehicle": {**APPROVE["vehicle"], "transfer_methods": []},
    }
    api.post(APPROVAL_PATH, json=body, headers=sign_in(api, UserRole.ADMIN))
    kwargs = service.calls[0][1]
    assert kwargs["reason"] == "Checked in person"
    assert kwargs["vehicle"].transfer_methods == []


def test_deactivating_passes_the_reason(api: TestClient, service: FakeDirectory) -> None:
    response = api.post(ACTIVATION_PATH, json=DEACTIVATE, headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json() == DRIVER
    assert service.calls[0][1] == {
        "admin": service.calls[0][1]["admin"],
        "driver_id": uuid.UUID(DRIVER["id"]),
        "is_active": False,
        "reason": DEACTIVATE["reason"],
    }


def test_activating_needs_no_reason(api: TestClient, service: FakeDirectory) -> None:
    api.post(ACTIVATION_PATH, json={"is_active": True}, headers=sign_in(api, UserRole.ADMIN))
    assert service.calls[0][1]["is_active"] is True
    assert service.calls[0][1]["reason"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"is_active": False},
        {"is_active": False, "reason": None},
        {"is_active": False, "reason": "bad"},
        {"is_active": False, "reason": "x" * 501},
        {"is_active": True, "reason": "x" * 501},
        {"reason": "Vehicle papers expired"},
        {"is_active": "yes please", "reason": "Vehicle papers expired"},
        {"is_active": False, "reason": "Vehicle papers expired", "approval_status": "suspended"},
    ],
)
def test_a_bad_activation_body_is_a_validation_error(
    api: TestClient, service: FakeDirectory, body: dict[str, Any]
) -> None:
    response = api.post(ACTIVATION_PATH, json=body, headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert service.calls == []


@pytest.mark.parametrize(
    ("path", "body"), [(APPROVAL_PATH, APPROVE), (ACTIVATION_PATH, DEACTIVATE)]
)
def test_the_writes_need_the_csrf_header(
    api: TestClient, service: FakeDirectory, path: str, body: Any
) -> None:
    headers = sign_in(api, UserRole.ADMIN)
    headers.pop(CSRF_HEADER_NAME)
    response = api.post(path, json=body, headers=headers)
    assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert service.calls == []


def test_staff_cannot_create_drivers(api: TestClient, service: FakeDirectory) -> None:
    # Decided 2026-10-26: partners sign themselves up, so there is no create endpoint.
    response = api.post(
        LIST_PATH,
        json={"name": "Sample", "phone": "08000000011"},
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code in (404, 405)
    assert service.calls == []
