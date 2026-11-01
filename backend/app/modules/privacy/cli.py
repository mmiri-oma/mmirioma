"""Command-line privacy tool for the privacy contact (technical lead) (NFR-005, #129).

Carries out the database steps of ``docs/process/privacy-retention.md``.
Every command names the admin account running it (``--by``) and writes an
audit row (NFR-004). ``anonymize-customer`` and ``retention-review`` are dry
runs unless ``--apply`` is given: they report what would change and save
nothing. Run from ``backend/`` with the virtualenv active and
``DATABASE_URL`` configured::

    python -m app.modules.privacy.cli anonymize-customer --by 08000000009 \\
        --customer 08000000001            # dry run
    python -m app.modules.privacy.cli anonymize-customer --by 08000000009 \\
        --customer 08000000001 --apply
    python -m app.modules.privacy.cli anonymize-partner --by 08000000009 \\
        --partner 08000000011            # dry run; add --apply to save
    python -m app.modules.privacy.cli correct-name --by 08000000009 \\
        --customer 08000000001 --name "Corrected Name"
    python -m app.modules.privacy.cli retention-review --by 08000000009          # dry run
    python -m app.modules.privacy.cli retention-review --by 08000000009 --apply
    python -m app.modules.privacy.cli set-deletion-status --by 08000000009 \\
        --request DR-8H3N6P2W --status acknowledged
    python -m app.modules.privacy.cli set-deletion-status --by 08000000009 \\
        --request DR-8H3N6P2W --status refused --reason "Open dispute on MO-7KQ2"

``set-deletion-status`` records the outcome of a deletion request made in
the app (docs/api/customer-account.md, decision 10): ``acknowledged``, then
``completed`` once ``anonymize-customer --apply`` has run, or ``refused``
with a reason. It saves at once, like ``correct-name``.

Output names accounts by id and orders by reference, never by name or
phone, so it can be copied into the request register.
"""

import argparse
import asyncio
import sys
from datetime import UTC, datetime

import app.models  # noqa: F401  (registers every model: commands write across modules)
from app.core.database import dispose_engine, get_sessionmaker
from app.modules.customers.models import NOTE_MAX_LENGTH, DeletionRequestStatus
from app.modules.customers.requests import DeletionStatusRefused
from app.modules.privacy import service
from app.shared.phone import normalize_nigerian_phone

NAME_MAX_LENGTH = 100  # users.name
REASON_MIN_LENGTH = 5  # as for other staff reasons (admin-directory.md)
STATUS_CHOICES = [
    status.value for status in DeletionRequestStatus if status is not DeletionRequestStatus.RECEIVED
]

# Notice section 8 rows the review cannot reach in the database.
MANUAL_CHECKS = (
    "Delete support-line messages 12 months after the matter was resolved.",
    "Check that server log rotation keeps at most 90 days.",
    "Check that backups older than 30 days are gone.",
    "Delete request register rows completed more than 3 years ago.",
    "Record this review in the request register.",
)


def _dry_run_line(applied: bool) -> str:
    return "Saved." if applied else "Dry run: nothing was saved. Add --apply to save."


async def _run(args: argparse.Namespace) -> str:
    now = datetime.now(UTC)
    async with get_sessionmaker()() as session:
        actor = await service.get_acting_admin(session, phone=args.by)
        if args.command == "anonymize-customer":
            result = await service.anonymize_customer(
                session, actor=actor, customer_phone=args.customer, now=now, apply=args.apply
            )
            return "\n".join(
                [
                    f"Customer {result.customer_id}: account anonymized and deactivated.",
                    f"Orders anonymized: {result.orders_anonymized}",
                    f"GPS points cleared: {result.gps_points_cleared}",
                    f"Saved addresses deleted: {result.addresses_removed}",
                    f"Support request messages removed: {result.support_messages_removed}",
                    f"Staff notes on support requests removed: {result.resolution_notes_removed}",
                    f"Notifications deleted: {result.notifications_deleted}",
                    f"Staff notes kept on these orders, to check by hand: {result.notes_to_review}",
                    *(f"Check: {warning}" for warning in result.cash_warnings),
                    _dry_run_line(result.applied),
                ]
            )
        if args.command == "anonymize-partner":
            partner = await service.anonymize_partner(
                session, actor=actor, partner_phone=args.partner, now=now, apply=args.apply
            )
            return "\n".join(
                [
                    f"Rider or driver {partner.partner_id}: account anonymized and deactivated.",
                    f"Service zones removed: {partner.zones_removed}",
                    f"Decline notes removed: {partner.decline_notes_removed}",
                    f"GPS points cleared: {partner.gps_points_cleared}",
                    f"Notifications deleted: {partner.notifications_deleted}",
                    f"Audit reasons removed: {partner.reasons_cleared}",
                    f"Incident and pickup notes kept, to check by hand: {partner.notes_to_review}",
                    _dry_run_line(partner.applied),
                ]
            )
        if args.command == "correct-name":
            customer_id = await service.correct_customer_name(
                session, actor=actor, customer_phone=args.customer, name=args.name
            )
            return f"Customer {customer_id}: name corrected."
        if args.command == "set-deletion-status":
            request_id = await service.set_deletion_request_status(
                session,
                actor=actor,
                reference=args.request,
                status=DeletionRequestStatus(args.status),
                reason=args.reason,
                now=now,
            )
            return f"Deletion request {args.request} ({request_id}): now {args.status}."
        review = await service.retention_review(session, actor=actor, now=now, apply=args.apply)
        return "\n".join(
            [
                f"Phone codes cleared: {review.phone_codes_cleared}",
                f"Delivery codes cleared: {review.delivery_codes_cleared}",
                f"Ended sessions deleted: {review.sessions_deleted}",
                f"Never-verified accounts deleted: {review.unverified_accounts_deleted}",
                "Never-verified accounts anonymized (they have audit rows): "
                f"{review.unverified_accounts_anonymized}",
                f"GPS points cleared: {review.gps_points_cleared}",
                f"Orders anonymized (finished over 3 years ago): {review.orders_anonymized}",
                "Support requests deleted (resolved over 3 years ago): "
                f"{review.support_requests_deleted}",
                "Deletion requests deleted (completed or refused over 3 years ago): "
                f"{review.deletion_requests_deleted}",
                _dry_run_line(review.applied),
                "",
                "Also by hand:",
                *(f"- {check}" for check in MANUAL_CHECKS),
            ]
        )


async def _main(args: argparse.Namespace) -> str:
    try:
        return await _run(args)
    finally:
        await dispose_engine()


def _phone(raw: str) -> str:
    try:
        return normalize_nigerian_phone(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _name(raw: str) -> str:
    value = raw.strip()
    if not 1 <= len(value) <= NAME_MAX_LENGTH:
        raise argparse.ArgumentTypeError(f"use 1-{NAME_MAX_LENGTH} characters")
    return value


def _reason(raw: str) -> str:
    value = raw.strip()
    if not REASON_MIN_LENGTH <= len(value) <= NOTE_MAX_LENGTH:
        raise argparse.ArgumentTypeError(f"use {REASON_MIN_LENGTH}-{NOTE_MAX_LENGTH} characters")
    return value


def _reference(raw: str) -> str:
    return raw.strip().upper()


def build_parser() -> argparse.ArgumentParser:
    """The command-line interface (exposed for tests)."""
    parser = argparse.ArgumentParser(prog="python -m app.modules.privacy.cli")
    commands = parser.add_subparsers(dest="command", required=True)

    anonymize = commands.add_parser(
        "anonymize-customer", help="anonymize a customer after a verified deletion request"
    )
    anonymize.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    anonymize.add_argument("--customer", required=True, type=_phone, help="the customer's phone")
    anonymize.add_argument("--apply", action="store_true", help="save (default: dry run)")

    partner = commands.add_parser(
        "anonymize-partner",
        help="anonymize a rider or driver after a verified deletion request",
    )
    partner.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    partner.add_argument(
        "--partner", required=True, type=_phone, help="the rider's or driver's phone"
    )
    partner.add_argument("--apply", action="store_true", help="save (default: dry run)")

    correct = commands.add_parser("correct-name", help="correct a customer's account name")
    correct.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    correct.add_argument("--customer", required=True, type=_phone, help="the customer's phone")
    correct.add_argument("--name", required=True, type=_name)

    review = commands.add_parser("retention-review", help="the monthly retention review")
    review.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    review.add_argument("--apply", action="store_true", help="save (default: dry run)")

    status = commands.add_parser(
        "set-deletion-status", help="record the outcome of a deletion request made in the app"
    )
    status.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    status.add_argument("--request", required=True, type=_reference, help="the DR- reference")
    status.add_argument("--status", required=True, choices=STATUS_CHOICES)
    status.add_argument("--reason", type=_reason, help="required with --status refused")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and run one command.

    Args:
        argv: Arguments without the program name; defaults to ``sys.argv[1:]``.

    Returns:
        Process exit code: 0 on success, 1 when refused.
    """
    args = build_parser().parse_args(argv)
    try:
        print(asyncio.run(_main(args)))
    except LookupError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except DeletionStatusRefused as exc:
        print(f"Refused: {exc}; nothing was changed.", file=sys.stderr)
        return 1
    except service.PartnerNotReady as exc:
        lines = "\n".join(f"- {blocker}" for blocker in exc.blockers)
        print(
            "Refused: end their live jobs, settle their cash and close the holds, "
            "reviews and disputes on their jobs first; "
            f"nothing was changed.\n{lines}",
            file=sys.stderr,
        )
        return 1
    except service.CustomerNotReady as exc:
        lines = "\n".join(f"- {blocker}" for blocker in exc.blockers)
        print(
            "Refused: finish or cancel these orders, close their holds and settle "
            "their cash first; "
            f"nothing was changed.\n{lines}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
