"""Admin operations part 1 endpoint tests that need no database (#102).

docs/api/admin-operations.md: ``GET /admin/shell``, ``GET /admin/settings``,
the admin support requests (list, detail, resolve), ``GET /admin/audit-logs``
and the admin notifications. Covers roles (FR-001), CSRF, validation, error
codes and bodies against the contract examples, with the services faked.
Also the admin message texts against the contract example and their rules
(SRS §5 ``notifications``). Database behaviour is in
test_admin_operations_integration.py.
"""

import asyncio
import json
import uuid
from collections.abc import Iterable, Iterator
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.audit import labels as audit_labels
from app.modules.audit import service as audit_service
from app.modules.audit.models import AuditLog
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.customers import requests
from app.modules.customers.models import (
    SupportRequest,
    SupportRequestStatus,
    SupportRequestType,
)
from app.modules.notifications import admin_messages
from app.modules.notifications import service as notifications_service
from app.modules.notifications.models import Notification, NotificationChannel
from app.modules.reporting import service as reporting
from tests import test_customer_account_api as account_api
from tests.test_customer_account_api import USERS, sign_in

api = account_api.api
fake = account_api.fake  # the customer service fakes the shared client needs

EXAMPLES = Path(__file__).resolve().parents[2] / "docs" / "api" / "examples"


def example(name: str) -> Any:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


SHELL = example("admin-shell.json")
SETTINGS = example("admin-settings.json")
SUPPORT = example("admin-support-request.json")
SUPPORT_PAGE = example("admin-support-requests-page.json")
RESOLVE = example("admin-support-resolve-request.json")
ALREADY_RESOLVED = example("error-support-request-already-resolved.json")
AUDIT_PAGE = example("admin-audit-logs-page.json")
NOTIFICATIONS_PAGE = example("admin-notifications-page.json")

REFERENCE = SUPPORT["reference"]
ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/api/v1/admin/shell", None),
    ("GET", "/api/v1/admin/settings", None),
    ("GET", "/api/v1/admin/support-requests", None),
    ("GET", f"/api/v1/admin/support-requests/{REFERENCE}", None),
    ("POST", f"/api/v1/admin/support-requests/{REFERENCE}/resolve", RESOLVE),
    ("GET", "/api/v1/admin/audit-logs", None),
    ("GET", "/api/v1/admin/notifications", None),
    ("POST", "/api/v1/admin/notifications/read", None),
]
UNSAFE = [endpoint for endpoint in ENDPOINTS if endpoint[0] == "POST"]


def at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def support_view(body: dict[str, Any]) -> requests.AdminSupportView:
    """The service view that should produce ``body`` (a contract example)."""
    customer = body["customer"]
    resolution = body["resolution"]
    resolver = None
    if resolution is not None:
        by = resolution["resolved_by"]
        resolver = User(id=uuid.UUID(by["id"]), name=by["name"], phone="+2348000000099")
    return requests.AdminSupportView(
        request=SupportRequest(
            id=uuid.uuid4(),
            reference=body["reference"],
            user_id=uuid.UUID(customer["id"]),
            type=SupportRequestType(body["type"]),
            message=body["message"],
            status=SupportRequestStatus(body["status"]),
            idempotency_key=uuid.uuid4(),
            created_at=at(body["created_at"]),
            resolved_at=at(resolution["resolved_at"]) if resolution else None,
            resolved_by=resolver.id if resolver else None,
            resolution_note=resolution["note"] if resolution else None,
        ),
        order_reference=body["order_reference"],
        is_simulated=body["is_simulated"],
        customer=User(id=uuid.UUID(customer["id"]), name=customer["name"], phone=customer["phone"]),
        resolver=resolver,
    )


CONTACTS = [
    requests.SupportContact("Sample Customer", "customer", "+2348000000001"),
    requests.SupportContact("Sample Driver One", "driver", "+2348000000011"),
]


class FakeAdmin:
    """Records service calls and returns the contract examples."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.error: APIError | None = None

    def _record(self, name: str, **kwargs: Any) -> None:
        self.calls.append((name, kwargs))
        if self.error:
            raise self.error

    async def shell_counts(self, _: object, admin: User) -> reporting.ShellCounts:
        self._record("shell_counts", admin=admin)
        return reporting.ShellCounts(**SHELL)

    async def list_staff(self, _: object) -> list[auth_service.StaffMember]:
        self._record("list_staff")
        return [
            auth_service.StaffMember(
                user=User(id=uuid.UUID(m["id"]), name=m["name"], phone=m["phone"]),
                last_sign_in_at=at(m["last_sign_in_at"]),
            )
            for m in SETTINGS["staff"]
        ]

    async def list_admin_support_requests(
        self, _: object, **kwargs: Any
    ) -> tuple[list[requests.AdminSupportView], int]:
        self._record("list_support", **kwargs)
        return [support_view(item) for item in SUPPORT_PAGE["items"]], SUPPORT_PAGE["total"]

    async def get_admin_support_request(
        self, _: object, **kwargs: Any
    ) -> tuple[requests.AdminSupportView, list[requests.SupportContact]]:
        self._record("get_support", **kwargs)
        return support_view(SUPPORT), CONTACTS

    async def resolve_support_request(self, _: object, **kwargs: Any) -> requests.AdminSupportView:
        self._record("resolve_support", **kwargs)
        return support_view(SUPPORT)

    async def list_logs(self, _: object, **kwargs: Any) -> tuple[list[tuple[AuditLog, User]], int]:
        self._record("list_logs", **kwargs)
        rows = []
        for item in AUDIT_PAGE["items"]:
            actor = item["actor"]
            rows.append(
                (
                    AuditLog(
                        id=uuid.UUID(item["id"]),
                        actor_id=uuid.UUID(actor["id"]),
                        action=item["action"],
                        target_type=item["target_type"],
                        target_id=uuid.UUID(item["target_id"]),
                        details=item["details"],
                        created_at=at(item["at"]),
                    ),
                    User(
                        id=uuid.UUID(actor["id"]), name=actor["name"], role=UserRole(actor["role"])
                    ),
                )
            )
        return rows, AUDIT_PAGE["total"]

    async def target_labels(
        self, _: object, targets: Iterable[tuple[str, uuid.UUID]]
    ) -> dict[tuple[str, uuid.UUID], str | None]:
        self._record("target_labels", targets=sorted(targets))
        by_target = {
            (item["target_type"], uuid.UUID(item["target_id"])): item["target_label"]
            for item in AUDIT_PAGE["items"]
        }
        return {target: by_target[target] for target in targets}

    async def list_for_user(
        self, _: object, **kwargs: Any
    ) -> notifications_service.NotificationPage:
        self._record("list_notifications", **kwargs)
        views = [
            notifications_service.NotificationView(
                Notification(
                    id=uuid.UUID(item["id"]),
                    user_id=kwargs["user_id"],
                    channel=NotificationChannel.IN_APP,
                    kind=item["kind"],
                    title=item["title"],
                    body=item["body"],
                    created_at=at(item["created_at"]),
                    read_at=at(item["read_at"]) if item["read_at"] else None,
                ),
                item["reference"],
            )
            for item in NOTIFICATIONS_PAGE["items"]
        ]
        return notifications_service.NotificationPage(
            items=views,
            total=NOTIFICATIONS_PAGE["total"],
            unread_count=NOTIFICATIONS_PAGE["unread_count"],
        )

    async def mark_read(self, _: object, **kwargs: Any) -> None:
        self._record("mark_read", **kwargs)


@pytest.fixture
def admin_fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeAdmin]:
    fake = FakeAdmin()
    monkeypatch.setattr(reporting, "shell_counts", fake.shell_counts)
    monkeypatch.setattr(auth_service, "list_staff", fake.list_staff)
    for name in (
        "list_admin_support_requests",
        "get_admin_support_request",
        "resolve_support_request",
    ):
        monkeypatch.setattr(requests, name, getattr(fake, name))
    monkeypatch.setattr(audit_service, "list_logs", fake.list_logs)
    monkeypatch.setattr(audit_labels, "target_labels", fake.target_labels)
    monkeypatch.setattr(notifications_service, "list_for_user", fake.list_for_user)
    monkeypatch.setattr(notifications_service, "mark_read", fake.mark_read)
    yield fake
    get_settings.cache_clear()


def call(client: TestClient, method: str, path: str, body: Any, headers: dict[str, str]) -> Any:
    return client.request(method, path, json=body, headers=headers)


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


ADMIN = USERS[UserRole.ADMIN]


# --- Access (FR-001) and CSRF ----------------------------------------------------------


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


@pytest.mark.parametrize(("method", "path", "body"), UNSAFE)
def test_posts_need_the_csrf_token(
    api: TestClient, admin_fake: FakeAdmin, method: str, path: str, body: Any
) -> None:
    sign_in(api, UserRole.ADMIN)
    response = call(api, method, path, body, {})
    assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert admin_fake.calls == []


# --- Shell and settings ----------------------------------------------------------------


def test_shell_matches_the_example(api: TestClient, admin_fake: FakeAdmin) -> None:
    response = api.get("/api/v1/admin/shell", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json() == SHELL
    assert admin_fake.calls == [("shell_counts", {"admin": ADMIN})]


def test_settings_come_from_backend_settings(
    api: TestClient, admin_fake: FakeAdmin, monkeypatch: pytest.MonkeyPatch
) -> None:
    # FR-055: one central value; the example has WhatsApp on.
    monkeypatch.setenv("SUPPORT_PHONE", SETTINGS["support"]["phone"])
    monkeypatch.setenv("SUPPORT_WHATSAPP_ENABLED", "true")
    get_settings.cache_clear()
    response = api.get("/api/v1/admin/settings", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json() == SETTINGS


def test_settings_follow_a_changed_support_number(
    api: TestClient, admin_fake: FakeAdmin, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUPPORT_PHONE", "+2348000000077")
    monkeypatch.delenv("SUPPORT_WHATSAPP_ENABLED", raising=False)
    get_settings.cache_clear()
    body = api.get("/api/v1/admin/settings", headers=sign_in(api, UserRole.ADMIN)).json()
    assert body["support"] == {"phone": "+2348000000077", "whatsapp_enabled": False}
    assert body["delivery_code_validity_minutes"] == 10  # FR-035


# --- Support requests ------------------------------------------------------------------


def test_support_page_matches_the_example(api: TestClient, admin_fake: FakeAdmin) -> None:
    response = api.get(
        "/api/v1/admin/support-requests?status=open&q=%20MO-3HT8%20",
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 200
    # The example's page fields are its own; the router echoes the query's.
    assert response.json() == SUPPORT_PAGE
    assert admin_fake.calls == [
        (
            "list_support",
            {"status": SupportRequestStatus.OPEN, "q": "MO-3HT8", "limit": 50, "offset": 0},
        )
    ]


@pytest.mark.parametrize(
    "query", ["status=closed", "q=", "q=" + "x" * 101, "limit=0", "limit=101", "offset=-1"]
)
def test_bad_support_queries_are_validation_errors(
    api: TestClient, admin_fake: FakeAdmin, query: str
) -> None:
    response = api.get(
        f"/api/v1/admin/support-requests?{query}", headers=sign_in(api, UserRole.ADMIN)
    )
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert admin_fake.calls == []


def test_support_detail_adds_contacts(api: TestClient, admin_fake: FakeAdmin) -> None:
    response = api.get(
        f"/api/v1/admin/support-requests/{REFERENCE}", headers=sign_in(api, UserRole.ADMIN)
    )
    assert response.status_code == 200
    assert response.json() == {
        **SUPPORT,
        "contacts": [
            {"name": "Sample Customer", "role": "customer", "phone": "+2348000000001"},
            {"name": "Sample Driver One", "role": "driver", "phone": "+2348000000011"},
        ],
    }
    assert admin_fake.calls == [("get_support", {"reference": REFERENCE})]


def test_resolve_returns_the_request_without_contacts(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    response = api.post(
        f"/api/v1/admin/support-requests/{REFERENCE}/resolve",
        json={"note": f"  {RESOLVE['note']}  "},
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 200
    assert response.json() == SUPPORT
    assert admin_fake.calls == [
        ("resolve_support", {"reference": REFERENCE, "admin": ADMIN, "note": RESOLVE["note"]})
    ]


@pytest.mark.parametrize(
    "body",
    [{}, {"note": "abcd"}, {"note": "     abcd  "}, {"note": "x" * 501}, {**RESOLVE, "x": 1}],
)
def test_bad_resolve_bodies_are_validation_errors(
    api: TestClient, admin_fake: FakeAdmin, body: dict[str, Any]
) -> None:
    response = api.post(
        f"/api/v1/admin/support-requests/{REFERENCE}/resolve",
        json=body,
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert admin_fake.calls == []


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", f"/api/v1/admin/support-requests/{REFERENCE}", None),
        ("POST", f"/api/v1/admin/support-requests/{REFERENCE}/resolve", RESOLVE),
    ],
)
def test_unknown_request_is_404(
    api: TestClient, admin_fake: FakeAdmin, method: str, path: str, body: Any
) -> None:
    admin_fake.error = APIError(
        HTTPStatus.NOT_FOUND, "support_request_not_found", "Support request not found"
    )
    response = call(api, method, path, body, sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (404, "support_request_not_found")


def test_resolving_twice_is_409_with_the_example_body(
    api: TestClient, admin_fake: FakeAdmin
) -> None:
    error = ALREADY_RESOLVED["error"]
    admin_fake.error = APIError(HTTPStatus.CONFLICT, error["code"], error["message"])
    response = api.post(
        f"/api/v1/admin/support-requests/{REFERENCE}/resolve",
        json=RESOLVE,
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 409
    assert response.json() == ALREADY_RESOLVED


def test_an_anonymized_request_keeps_its_resolution(
    api: TestClient, admin_fake: FakeAdmin, monkeypatch: pytest.MonkeyPatch
) -> None:
    # #117: the note is replaced, not blanked, so resolution is still shown.
    removed = "Removed at the customer's request."
    view = support_view(SUPPORT)
    view.request.message = removed
    view.request.resolution_note = removed

    async def get(_: object, **kwargs: Any) -> tuple[requests.AdminSupportView, list[Any]]:
        return view, []

    monkeypatch.setattr(requests, "get_admin_support_request", get)
    body = api.get(
        f"/api/v1/admin/support-requests/{REFERENCE}", headers=sign_in(api, UserRole.ADMIN)
    ).json()
    assert (body["message"], body["resolution"]["note"]) == (removed, removed)
    assert body["resolution"]["resolved_by"] == SUPPORT["resolution"]["resolved_by"]


def test_like_wildcards_in_the_search_are_escaped() -> None:
    assert requests._contains("50%_off\\") == "%50\\%\\_off\\\\%"


# --- Audit log -------------------------------------------------------------------------


def test_audit_page_matches_the_example(api: TestClient, admin_fake: FakeAdmin) -> None:
    target = AUDIT_PAGE["items"][0]["target_id"]
    response = api.get(
        f"/api/v1/admin/audit-logs?target_type=support_request&target_id={target}",
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert response.status_code == 200
    assert response.json() == AUDIT_PAGE
    assert admin_fake.calls == [
        (
            "list_logs",
            {
                "target_type": "support_request",
                "target_id": uuid.UUID(target),
                "limit": 50,
                "offset": 0,
            },
        ),
        (
            "target_labels",
            {
                "targets": sorted(
                    (item["target_type"], uuid.UUID(item["target_id"]))
                    for item in AUDIT_PAGE["items"]
                )
            },
        ),
    ]


@pytest.mark.parametrize(
    "query", ["target_type=order", f"target_id={uuid.uuid4()}", "target_type=order&target_id=x"]
)
def test_audit_filter_needs_both_or_neither(
    api: TestClient, admin_fake: FakeAdmin, query: str
) -> None:
    response = api.get(f"/api/v1/admin/audit-logs?{query}", headers=sign_in(api, UserRole.ADMIN))
    assert (response.status_code, error_code(response)) == (422, "validation_error")
    assert admin_fake.calls == []


# --- Admin notifications ---------------------------------------------------------------


def test_notifications_page_matches_the_example(api: TestClient, admin_fake: FakeAdmin) -> None:
    response = api.get("/api/v1/admin/notifications", headers=sign_in(api, UserRole.ADMIN))
    assert response.status_code == 200
    assert response.json() == NOTIFICATIONS_PAGE
    assert admin_fake.calls == [
        ("list_notifications", {"user_id": ADMIN.id, "limit": 50, "offset": 0})
    ]


@pytest.mark.parametrize(
    ("body", "ids"),
    [(None, None), ({}, None), ({"ids": [str(uuid.UUID(int=1))]}, [uuid.UUID(int=1)])],
)
def test_mark_read_marks_only_this_admins_rows(
    api: TestClient, admin_fake: FakeAdmin, body: Any, ids: Any
) -> None:
    response = api.post(
        "/api/v1/admin/notifications/read", json=body, headers=sign_in(api, UserRole.ADMIN)
    )
    assert response.status_code == 204
    assert admin_fake.calls == [("mark_read", {"user_id": ADMIN.id, "ids": ids})]


def test_mark_read_takes_at_most_100_ids(api: TestClient, admin_fake: FakeAdmin) -> None:
    response = api.post(
        "/api/v1/admin/notifications/read",
        json={"ids": [str(uuid.uuid4()) for _ in range(101)]},
        headers=sign_in(api, UserRole.ADMIN),
    )
    assert (response.status_code, error_code(response)) == (422, "validation_error")


# --- Admin message texts ---------------------------------------------------------------


class RecordingSession:
    """A session stand-in: returns admin ids and keeps what was added."""

    def __init__(self, admin_ids: list[uuid.UUID]) -> None:
        self.admin_ids = admin_ids
        self.added: list[Notification] = []

    async def scalars(self, _: object) -> list[uuid.UUID]:
        return self.admin_ids

    def add(self, row: Notification) -> None:
        self.added.append(row)


def sent(kind: str, admin_ids: list[uuid.UUID], **kwargs: Any) -> list[Notification]:
    session = RecordingSession(admin_ids)
    asyncio.run(getattr(admin_messages, kind)(session, **kwargs))
    return session.added


def test_texts_match_the_contract_example() -> None:
    by_kind = {item["kind"]: item for item in NOTIFICATIONS_PAGE["items"]}
    admin = uuid.uuid4()
    declined = by_kind["driver_declined"]
    pending = by_kind["partner_pending"]
    support = by_kind["support_request"]
    rows = [
        *sent("driver_declined", [admin], order_id=uuid.uuid4(), reference=declined["reference"]),
        *sent("partner_pending", [admin]),
        *sent("support_request", [admin], order_id=uuid.uuid4(), reference=support["reference"]),
    ]
    assert [(r.kind, r.title, r.body) for r in rows] == [
        (item["kind"], item["title"], item["body"]) for item in (declined, pending, support)
    ]


def test_each_active_admin_gets_their_own_row() -> None:
    admins = [uuid.uuid4(), uuid.uuid4()]
    order_id = uuid.uuid4()
    rows = sent("hold_opened", admins, order_id=order_id, reference="MO-7KQ2M9XH4T")
    assert [(r.user_id, r.kind, r.order_id) for r in rows] == [
        (admins[0], "hold_opened", order_id),
        (admins[1], "hold_opened", order_id),
    ]
    assert sent("partner_pending", []) == []


def test_support_request_without_an_order_has_no_reference() -> None:
    (row,) = sent("support_request", [uuid.uuid4()], order_id=None, reference=None)
    assert (row.body, row.order_id) == ("A customer reported a problem.", None)


def test_texts_never_carry_a_phone_address_or_code() -> None:
    rows = [
        *sent("driver_declined", [uuid.uuid4()], order_id=uuid.uuid4(), reference="MO-7KQ2M9XH4T"),
        *sent("hold_opened", [uuid.uuid4()], order_id=uuid.uuid4(), reference="MO-7KQ2M9XH4T"),
        *sent("partner_pending", [uuid.uuid4()]),
        *sent("support_request", [uuid.uuid4()], order_id=None, reference=None),
    ]
    for row in rows:
        text = f"{row.title} {row.body}".lower()
        assert "+234" not in text and "code" not in text and "street" not in text


def test_no_expiry_message_while_offers_never_expire() -> None:
    # assignment_expired has no trigger: nothing sets the expired status
    # (admin dispatch decision 1; #102, technical lead, 2026-10-27).
    assert admin_messages.ADMIN_KINDS == {
        "driver_declined",
        "hold_opened",
        "partner_pending",
        "support_request",
    }
