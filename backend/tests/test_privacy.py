"""Privacy tool without a database (#129): arguments, output and helpers.

The database steps are in ``test_privacy_integration.py``.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.modules.auth import retention as accounts
from app.modules.customers.models import DeletionRequestStatus
from app.modules.customers.requests import DeletionStatusRefused
from app.modules.orders import retention as orders
from app.modules.payments.retention import format_kobo
from app.modules.privacy import cli, service
from app.modules.privacy.cli import build_parser

ADMIN_PHONE = "+2348000000009"
CUSTOMER_PHONE = "+2348000000001"
CUSTOMER_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")


def test_parser_normalizes_phones_and_defaults_to_a_dry_run() -> None:
    args = build_parser().parse_args(
        ["anonymize-customer", "--by", "0800 000 0009", "--customer", "08000000001"]
    )
    assert (args.by, args.customer, args.apply) == (ADMIN_PHONE, CUSTOMER_PHONE, False)

    review = build_parser().parse_args(["retention-review", "--by", "08000000009", "--apply"])
    assert review.apply is True

    correct = build_parser().parse_args(
        ["correct-name", "--by", "08000000009", "--customer", "08000000001", "--name", "  Ada  "]
    )
    assert correct.name == "Ada"


@pytest.mark.parametrize(
    "argv",
    [
        ["anonymize-customer", "--by", "08000000009"],
        ["anonymize-customer", "--by", "12345", "--customer", "08000000001"],
        ["correct-name", "--by", "08000000009", "--customer", "08000000001", "--name", " "],
        ["correct-name", "--by", "08000000009", "--customer", "08000000001", "--name", "x" * 101],
        ["retention-review"],
    ],
)
def test_parser_rejects_bad_arguments(argv: list[str]) -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(argv)


def test_phone_marker_is_not_a_real_number() -> None:
    assert accounts.is_anonymized_phone("+0" + "1" * 14)
    assert not accounts.is_anonymized_phone(CUSTOMER_PHONE)
    assert accounts.is_anonymized_phone(orders.ANONYMIZED_CONTACT_PHONE)
    assert len(orders.ANONYMIZED_CONTACT_PHONE) == 16  # orders.contact_phone is VARCHAR(16)


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        (datetime(2029, 11, 1, 9, tzinfo=UTC), datetime(2026, 11, 1, 9, tzinfo=UTC)),
        (datetime(2028, 2, 29, 9, tzinfo=UTC), datetime(2025, 2, 28, 9, tzinfo=UTC)),
    ],
)
def test_years_before(moment: datetime, expected: datetime) -> None:
    assert service.years_before(moment, 3) == expected


@pytest.fixture
def fake_service(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace the service and engine calls so ``cli.main`` needs no database."""
    calls: dict[str, Any] = {}

    async def acting_admin(session: object, *, phone: str) -> object:
        calls["by"] = phone
        return object()

    async def no_dispose() -> None:
        return None

    monkeypatch.setattr(service, "get_acting_admin", acting_admin)
    monkeypatch.setattr(cli, "dispose_engine", no_dispose)
    return calls


def test_anonymize_output_has_ids_and_counts_but_no_phone(
    fake_service: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def anonymize(session: object, **kwargs: Any) -> service.AnonymizeResult:
        fake_service.update(kwargs)
        return service.AnonymizeResult(
            customer_id=CUSTOMER_ID,
            orders_anonymized=2,
            gps_points_cleared=1,
            addresses_removed=2,
            support_messages_removed=1,
            resolution_notes_removed=1,
            notifications_deleted=4,
            notes_to_review=3,
            cash_warnings=["MO-CCCC: part paid, ₦500.00 outstanding; check (F9)"],
            applied=False,
        )

    monkeypatch.setattr(service, "anonymize_customer", anonymize)
    code = cli.main(["anonymize-customer", "--by", "08000000009", "--customer", "08000000001"])
    out = capsys.readouterr().out

    assert code == 0
    assert fake_service["customer_phone"] == CUSTOMER_PHONE
    assert fake_service["apply"] is False
    assert str(CUSTOMER_ID) in out
    assert "Orders anonymized: 2" in out
    assert "Support request messages removed: 1" in out
    assert "Staff notes on support requests removed: 1" in out
    assert "Notifications deleted: 4" in out
    assert "Staff notes kept on these orders, to check by hand: 3" in out
    assert "Check: MO-CCCC: part paid, ₦500.00 outstanding; check (F9)" in out
    assert "Dry run: nothing was saved" in out
    assert "0800" not in out and "+234" not in out


def test_refusal_lists_blocking_orders_and_exits_1(
    fake_service: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def refuse(session: object, **kwargs: Any) -> service.AnonymizeResult:
        raise service.CustomerNotReady(["MO-AAAA: failed", "MO-BBBB: open hold or review"])

    monkeypatch.setattr(service, "anonymize_customer", refuse)
    code = cli.main(
        ["anonymize-customer", "--by", "08000000009", "--customer", "08000000001", "--apply"]
    )
    err = capsys.readouterr().err

    assert code == 1
    assert "nothing was changed" in err
    assert "- MO-AAAA: failed" in err
    assert "- MO-BBBB: open hold or review" in err


def test_anonymize_partner_output_has_ids_and_counts_but_no_phone(
    fake_service: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def anonymize(session: object, **kwargs: Any) -> service.PartnerAnonymizeResult:
        fake_service.update(kwargs)
        return service.PartnerAnonymizeResult(
            partner_id=CUSTOMER_ID,
            zones_removed=1,
            decline_notes_removed=2,
            gps_points_cleared=3,
            notifications_deleted=4,
            reasons_cleared=6,
            notes_to_review=5,
            applied=False,
        )

    monkeypatch.setattr(service, "anonymize_partner", anonymize)
    code = cli.main(["anonymize-partner", "--by", "08000000009", "--partner", "08000000011"])
    out = capsys.readouterr().out

    assert code == 0
    assert fake_service["partner_phone"] == "+2348000000011"
    assert fake_service["apply"] is False
    assert f"Rider or driver {CUSTOMER_ID}: account anonymized and deactivated." in out
    assert "Service zones removed: 1" in out
    assert "Decline notes removed: 2" in out
    assert "GPS points cleared: 3" in out
    assert "Notifications deleted: 4" in out
    assert "Audit reasons removed: 6" in out
    assert "Incident and pickup notes kept, to check by hand: 5" in out
    assert "Dry run: nothing was saved" in out
    assert "0800" not in out and "+234" not in out


def test_anonymize_partner_refusal_lists_the_blockers(
    fake_service: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def refuse(session: object, **kwargs: Any) -> service.PartnerAnonymizeResult:
        raise service.PartnerNotReady(["MO-AAAA: job accepted", "MO-BBBB: cash collected"])

    monkeypatch.setattr(service, "anonymize_partner", refuse)
    code = cli.main(["anonymize-partner", "--by", "08000000009", "--partner", "08000000011"])
    err = capsys.readouterr().err

    assert code == 1
    assert "nothing was changed" in err
    assert "- MO-AAAA: job accepted" in err
    assert "- MO-BBBB: cash collected" in err


def test_unknown_admin_exits_1(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def no_admin(session: object, *, phone: str) -> object:
        raise LookupError("no active admin account has this phone")

    async def no_dispose() -> None:
        return None

    monkeypatch.setattr(service, "get_acting_admin", no_admin)
    monkeypatch.setattr(cli, "dispose_engine", no_dispose)
    assert cli.main(["retention-review", "--by", "08000000009"]) == 1
    assert "no active admin account" in capsys.readouterr().err


def test_review_output_lists_the_manual_checks(
    fake_service: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def review(session: object, **kwargs: Any) -> service.ReviewResult:
        fake_service.update(kwargs)
        return service.ReviewResult(
            phone_codes_cleared=4,
            delivery_codes_cleared=1,
            sessions_deleted=2,
            unverified_accounts_deleted=0,
            unverified_accounts_anonymized=1,
            gps_points_cleared=0,
            orders_anonymized=0,
            support_requests_deleted=5,
            deletion_requests_deleted=2,
            applied=True,
        )

    monkeypatch.setattr(service, "retention_review", review)
    assert cli.main(["retention-review", "--by", "08000000009", "--apply"]) == 0
    out = capsys.readouterr().out

    assert fake_service["apply"] is True
    assert "Phone codes cleared: 4" in out
    assert "Never-verified accounts anonymized (they have audit rows): 1" in out
    assert "Support requests deleted (resolved over 3 years ago): 5" in out
    assert "Deletion requests deleted (completed or refused over 3 years ago): 2" in out
    assert "Saved." in out
    for check in cli.MANUAL_CHECKS:
        assert check in out


@pytest.mark.parametrize(
    ("kobo", "text"),
    [(0, "₦0.00"), (5, "₦0.05"), (150_000, "₦1,500.00"), (123_456_789, "₦1,234,567.89")],
)
def test_format_kobo_has_no_float_rounding(kobo: int, text: str) -> None:
    assert format_kobo(kobo) == text


def test_set_deletion_status_parses_the_reference_and_reason() -> None:
    args = build_parser().parse_args(
        [
            "set-deletion-status",
            "--by",
            "08000000009",
            "--request",
            " dr-8h3n6p2w ",
            "--status",
            "refused",
            "--reason",
            "  Open dispute on an order  ",
        ]
    )
    assert (args.request, args.status, args.reason) == (
        "DR-8H3N6P2W",
        "refused",
        "Open dispute on an order",
    )


@pytest.mark.parametrize(
    "extra",
    [
        ["--status", "received"],  # only staff outcomes can be set
        ["--status", "deleted"],
        ["--status", "refused", "--reason", "no"],  # under 5 characters
        ["--status", "refused", "--reason", "x" * 501],
    ],
)
def test_set_deletion_status_rejects_bad_arguments(extra: list[str]) -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(
            ["set-deletion-status", "--by", "08000000009", "--request", "DR-8H3N6P2W", *extra]
        )


def test_set_deletion_status_prints_the_outcome(
    fake_service: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def set_status(session: object, **kwargs: Any) -> uuid.UUID:
        fake_service.update(kwargs)
        return CUSTOMER_ID

    monkeypatch.setattr(service, "set_deletion_request_status", set_status)
    argv = ["set-deletion-status", "--by", "08000000009", "--request", "DR-8H3N6P2W"]
    assert cli.main([*argv, "--status", "acknowledged"]) == 0
    assert fake_service["status"] is DeletionRequestStatus.ACKNOWLEDGED
    assert fake_service["reason"] is None
    assert "Deletion request DR-8H3N6P2W" in capsys.readouterr().out


def test_a_refused_status_change_exits_1(
    fake_service: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def refuse(session: object, **kwargs: Any) -> uuid.UUID:
        raise DeletionStatusRefused("the account is not anonymized yet")

    monkeypatch.setattr(service, "set_deletion_request_status", refuse)
    argv = ["set-deletion-status", "--by", "08000000009", "--request", "DR-8H3N6P2W"]
    assert cli.main([*argv, "--status", "completed"]) == 1
    assert "Refused: the account is not anonymized yet" in capsys.readouterr().err
