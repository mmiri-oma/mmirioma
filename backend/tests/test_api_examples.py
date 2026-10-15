"""Mock JSON in ``docs/api/examples`` stays consistent with the API contracts.

The frontend builds screens against these files before endpoints exist
(docs/process/ui-driven-development.md, stage 5), so a typo in a status or an
error envelope there becomes a bug in the UI. These checks need no database.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.orders.models import OrderStatus

EXAMPLES_DIR = Path(__file__).resolve().parents[2] / "docs" / "api" / "examples"

# docs/api/deliveries.md, "Assignment statuses". Not in code yet: the
# assignment model is built in S1-07 against that contract.
ASSIGNMENT_STATUSES = {"offered", "accepted", "declined", "timed_out", "withdrawn", "completed"}


def _load(name: str) -> Any:
    return json.loads((EXAMPLES_DIR / name).read_text(encoding="utf-8"))


def _example_files() -> list[Path]:
    return sorted(EXAMPLES_DIR.glob("*.json"))


def test_examples_directory_has_samples() -> None:
    # Guards against the path silently pointing nowhere, which would make the
    # parametrized checks below collect zero cases and pass vacuously.
    assert len(_example_files()) >= 3


@pytest.mark.parametrize("path", _example_files(), ids=lambda path: path.name)
def test_every_example_is_valid_json(path: Path) -> None:
    json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    "path",
    [path for path in _example_files() if path.name.startswith("error-")],
    ids=lambda path: path.name,
)
def test_error_examples_use_the_shared_envelope(path: Path) -> None:
    # docs/api/README.md, "Errors": exactly {"error": {code, message, details}}.
    body = json.loads(path.read_text(encoding="utf-8"))
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "details"}
    assert isinstance(error["code"], str)
    assert error["code"] == error["code"].lower()
    assert " " not in error["code"]
    assert isinstance(error["message"], str) and error["message"]


def test_order_examples_use_contract_statuses() -> None:
    order_statuses = {status.value for status in OrderStatus}
    assert _load("order.json")["status"] in order_statuses
    for item in _load("admin-orders-page.json")["items"]:
        assert item["status"] in order_statuses


def test_assignment_example_matches_the_deliveries_contract() -> None:
    assignment = _load("assignment.json")
    assert assignment["status"] in ASSIGNMENT_STATUSES
    assert set(assignment) == {
        "id",
        "order_reference",
        "driver",
        "status",
        "assigned_by",
        "reason",
        "created_at",
        "accepted_at",
        "declined_at",
        "ended_at",
    }
    # A declined offer was never accepted and is timestamped as declined.
    if assignment["status"] == "declined":
        assert assignment["accepted_at"] is None
        assert assignment["declined_at"] is not None
        assert assignment["reason"]


@pytest.mark.parametrize(
    ("name", "code"),
    [
        ("error-invalid-order-transition.json", "invalid_order_transition"),
        ("error-delivery-proof-required.json", "delivery_proof_required"),
    ],
)
def test_delivery_error_examples_use_documented_codes(name: str, code: str) -> None:
    # Codes from docs/api/deliveries.md, "Errors".
    assert _load(name)["error"]["code"] == code
