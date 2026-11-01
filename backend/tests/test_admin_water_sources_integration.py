"""The admin water-source endpoints against a real, migrated database (#309).

docs/api/admin-water-sources.md, through HTTP: add, edit, activate or renew,
suspend and revoke, each with the audit row the command line writes, the 404
codes, and the boundary of the supplier's cost per litre (a customer and a
driver never see it). Runs only when TEST_DATABASE_URL is set
(``alembic upgrade head`` first). Every row is created here and deleted
afterwards.
"""

import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.modules.audit.models import AuditLog
from app.modules.auth.models import UserRole
from app.shared.lagos_time import lagos_today
from tests.test_orders_integration import (
    TEST_DATABASE_URL,
    add_account,
    created_user_ids,  # noqa: F401
    http,  # noqa: F401
    run,
    sign_in,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

BASE = "/api/v1/admin/water-sources"
COST_KEY = "cost_per_litre"


@pytest.fixture
def source_ids(created_user_ids: list[uuid.UUID]) -> Iterator[list[uuid.UUID]]:  # noqa: F811
    """Source ids a test creates; their rows go before the users the audit rows name."""
    ids: list[uuid.UUID] = []
    yield ids
    url = get_settings().sync_database_url.set(drivername="postgresql")
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        connection.execute("DELETE FROM water_source_categories WHERE source_id = ANY(%s)", (ids,))
        connection.execute("DELETE FROM audit_logs WHERE actor_id = ANY(%s)", (created_user_ids,))
        connection.execute("DELETE FROM water_sources WHERE id = ANY(%s)", (ids,))


def audit_rows(source_id: str) -> list[tuple[str, dict[str, Any]]]:
    """``(action, details)`` of the source's audit rows, oldest first."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    rows: list[tuple[str, dict[str, Any]]] = []

    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        async with sessions() as session:
            found = await session.scalars(
                select(AuditLog)
                .where(AuditLog.target_id == uuid.UUID(source_id))
                .order_by(AuditLog.created_at, AuditLog.id)
            )
            rows.extend((log.action, log.details) for log in found)

    run(scenario)
    return rows


def signed_in_admin(client: TestClient, user_ids: list[uuid.UUID]) -> dict[str, str]:
    return sign_in(client, add_account(user_ids, UserRole.ADMIN))


def category_id(client: TestClient, headers: dict[str, str], code: str) -> str:
    categories = client.get(BASE, headers=headers).json()["categories"]
    return next(c["id"] for c in categories if c["code"] == code)


def test_an_admin_runs_a_source_from_adding_it_to_revoking_it(
    http: TestClient,  # noqa: F811
    created_user_ids: list[uuid.UUID],  # noqa: F811
    source_ids: list[uuid.UUID],
) -> None:
    headers = signed_in_admin(http, created_user_ids)
    utility = category_id(http, headers, "utility")

    added = http.post(
        BASE,
        json={"name": "Sample Borehole A", "approximate_location": "Off Ogui Road"},
        headers=headers,
    )
    assert added.status_code == 201, added.text
    source = added.json()
    source_ids.append(uuid.UUID(source["id"]))
    assert (source["kind"], source["is_simulated"], source["activations"]) == (None, False, [])
    path = f"{BASE}/{source['id']}"

    edited = http.patch(
        path, json={"name": "Sample Borehole B", "kind": "borehole"}, headers=headers
    )
    assert edited.status_code == 200, edited.text
    assert (edited.json()["name"], edited.json()["kind"]) == ("Sample Borehole B", "borehole")
    # The same values again change nothing and write nothing.
    again = http.patch(path, json={"name": "Sample Borehole B"}, headers=headers)
    assert again.status_code == 200
    assert len(audit_rows(source["id"])) == 2

    until = lagos_today() + timedelta(days=10)
    activated = http.put(
        f"{path}/activations/{utility}",
        json={
            "approved_until": until.isoformat(),
            "report_reference": "SAMPLE-LR-0001",
            "cost_per_litre_minor_units": 150,
        },
        headers=headers,
    )
    assert activated.status_code == 200, activated.text
    [activation] = activated.json()["activations"]
    assert activation["status"] == "activated"
    assert activation["cost_per_litre_minor_units"] == 150
    assert activation["report_reference"] == "SAMPLE-LR-0001"
    assert activation["expiry"] == {"state": "expires_soon", "days_left": 10}
    assert activation["reasons"] == []

    suspended = http.post(
        f"{path}/activations/{utility}/status",
        json={"status": "suspended", "reason": "Pump repair."},
        headers=headers,
    )
    assert suspended.status_code == 200, suspended.text
    [activation] = suspended.json()["activations"]
    assert (activation["status"], activation["status_reason"]) == ("suspended", "Pump repair.")
    assert activation["reasons"] == ["suspended"]

    # Renewing reinstates it and clears the reason.
    renewed = http.put(
        f"{path}/activations/{utility}",
        json={
            "approved_until": (until + timedelta(days=60)).isoformat(),
            "report_reference": "SAMPLE-LR-0002",
            "cost_per_litre_minor_units": 175,
        },
        headers=headers,
    )
    [activation] = renewed.json()["activations"]
    assert (activation["status"], activation["status_reason"]) == ("activated", None)
    assert (activation["expiry"]["state"], activation["cost_per_litre_minor_units"]) == ("ok", 175)

    revoked = http.post(
        f"{path}/activations/{utility}/status",
        json={"status": "revoked", "reason": "Withdrawn."},
        headers=headers,
    )
    assert revoked.json()["activations"][0]["reasons"] == ["revoked"]
    # A revoked activation may be moved to suspended (decided 2026-11-01).
    moved = http.post(
        f"{path}/activations/{utility}/status",
        json={"status": "suspended", "reason": "Under review."},
        headers=headers,
    )
    assert moved.json()["activations"][0]["status"] == "suspended"

    listed = http.get(BASE, headers=headers).json()
    assert source["id"] in [item["id"] for item in listed["items"]]

    rows = audit_rows(source["id"])
    assert [action for action, _ in rows] == [
        "water_source_added",
        "water_source_updated",
        "water_source_activated",
        "water_source_suspended",
        "water_source_activated",
        "water_source_revoked",
        "water_source_suspended",
    ]
    assert rows[1][1] == {"fields": ["name", "kind"]}
    assert rows[2][1] == {"water_category_id": utility, "status": "activated"}
    # Audit details hold ids, kinds and field names: never a value typed in.
    stored = " ".join(str(details) for _, details in rows)
    for typed in ("Sample Borehole", "SAMPLE-LR", "Pump repair", "Withdrawn", "150", "175"):
        assert typed not in stored


def test_unknown_records_are_404_with_the_contract_codes(
    http: TestClient,  # noqa: F811
    created_user_ids: list[uuid.UUID],  # noqa: F811
    source_ids: list[uuid.UUID],
) -> None:
    headers = signed_in_admin(http, created_user_ids)
    utility = category_id(http, headers, "utility")
    added = http.post(
        BASE, json={"name": "Sample Borehole A", "approximate_location": "Here"}, headers=headers
    )
    source_id = added.json()["id"]
    source_ids.append(uuid.UUID(source_id))
    unknown = str(uuid.uuid4())
    body = {
        "approved_until": lagos_today().isoformat(),
        "report_reference": "SAMPLE-LR-0001",
        "cost_per_litre_minor_units": 0,
    }

    def code(response: Any) -> tuple[int, str]:
        return response.status_code, response.json()["error"]["code"]

    assert code(http.patch(f"{BASE}/{unknown}", json={"name": "X"}, headers=headers)) == (
        404,
        "water_source_not_found",
    )
    assert code(
        http.put(f"{BASE}/{unknown}/activations/{utility}", json=body, headers=headers)
    ) == (404, "water_source_not_found")
    assert code(
        http.put(f"{BASE}/{source_id}/activations/{unknown}", json=body, headers=headers)
    ) == (404, "water_category_not_found")
    status = {"status": "suspended", "reason": "No."}
    assert code(
        http.post(f"{BASE}/{source_id}/activations/{utility}/status", json=status, headers=headers)
    ) == (404, "activation_not_found")
    # Nothing was written for the failed calls.
    assert [action for action, _ in audit_rows(source_id)] == ["water_source_added"]


def test_a_past_date_is_refused_and_nothing_is_stored(
    http: TestClient,  # noqa: F811
    created_user_ids: list[uuid.UUID],  # noqa: F811
    source_ids: list[uuid.UUID],
) -> None:
    headers = signed_in_admin(http, created_user_ids)
    utility = category_id(http, headers, "utility")
    added = http.post(
        BASE, json={"name": "Sample Borehole A", "approximate_location": "Here"}, headers=headers
    )
    source_id = added.json()["id"]
    source_ids.append(uuid.UUID(source_id))
    response = http.put(
        f"{BASE}/{source_id}/activations/{utility}",
        json={
            "approved_until": (lagos_today() - timedelta(days=1)).isoformat(),
            "report_reference": "SAMPLE-LR-0001",
            "cost_per_litre_minor_units": 150,
        },
        headers=headers,
    )
    assert (response.status_code, response.json()["error"]["code"]) == (422, "validation_error")
    [listed] = [i for i in http.get(BASE, headers=headers).json()["items"] if i["id"] == source_id]
    assert listed["activations"] == []


def test_customers_and_drivers_get_403_and_never_see_the_cost(
    http: TestClient,  # noqa: F811
    created_user_ids: list[uuid.UUID],  # noqa: F811
    source_ids: list[uuid.UUID],
) -> None:
    admin_headers = signed_in_admin(http, created_user_ids)
    utility = category_id(http, admin_headers, "utility")
    added = http.post(
        BASE,
        json={"name": "Sample Borehole A", "approximate_location": "Here"},
        headers=admin_headers,
    )
    source_id = added.json()["id"]
    source_ids.append(uuid.UUID(source_id))
    http.put(
        f"{BASE}/{source_id}/activations/{utility}",
        json={
            "approved_until": (lagos_today() + timedelta(days=90)).isoformat(),
            "report_reference": "SAMPLE-LR-0001",
            "cost_per_litre_minor_units": 150,
        },
        headers=admin_headers,
    )

    for role in (UserRole.CUSTOMER, UserRole.DRIVER):
        headers = sign_in(http, add_account(created_user_ids, role))
        for method, path in (("GET", BASE), ("PATCH", f"{BASE}/{source_id}")):
            response = http.request(method, path, json={"name": "X"}, headers=headers)
            assert (response.status_code, response.json()["error"]["code"]) == (403, "forbidden")
            assert COST_KEY not in response.text
        # The responses these roles do get never carry the supplier's cost.
        for path in ("/api/v1/orders", "/api/v1/driver/jobs", "/api/v1/service-zones"):
            response = http.get(path, headers=headers)
            assert COST_KEY not in response.text

    http.cookies.clear()
    assert http.get(BASE).status_code == 401
