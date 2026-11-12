"""Command-line management of water sources for the technical lead (pilot fallback F1).

Before the admin Water sources screen (#309), sources and their category
activations were managed only here (technical lead, #87, 2026-10-20), like
vehicles (``app.modules.dispatch.cli``). It stays as the fallback. Every change names the
admin account making it (``--by``) and writes an audit row (NFR-004). Run
from ``backend/`` with the virtualenv active and ``DATABASE_URL`` configured::

    python -m app.modules.sources.cli list-categories
    python -m app.modules.sources.cli add-source --by 08000000009 \\
        --name "Sample Borehole A" --location "Ugwuaji, Enugu" --kind borehole
    python -m app.modules.sources.cli set-kind --by 08000000009 --source <source id> \\
        --kind ninth_mile
    python -m app.modules.sources.cli activate --by 08000000009 --source <source id> \\
        --category potable --report LR-0001 --approved-until 2027-01-30 \\
        --cost-per-litre-kobo 150
    python -m app.modules.sources.cli suspend --by 08000000009 --source <source id> \\
        --category potable --reason "Safety concern reported on 22 Oct"
    python -m app.modules.sources.cli revoke --by 08000000009 --source <source id> \\
        --category potable --reason "Supplier withdrew"
    python -m app.modules.sources.cli list-sources

Activate only after the independent laboratory verification and the checks
FR-012 requires; the app cannot verify them. A source needs a kind first
(``--kind`` or ``set-kind``, #407). The supplier contact, litre limits,
availability and vehicles are set on the admin Water sources screen. The report itself stays outside
the app: enter only its reference.
"""

import argparse
import asyncio
import sys
import uuid
from collections.abc import Callable
from datetime import date

import app.models  # noqa: F401  (registers every model: commands write across modules)
from app.core.config import get_settings
from app.core.database import dispose_engine, get_sessionmaker
from app.modules.sources import service
from app.modules.sources.models import (
    APPROXIMATE_LOCATION_MAX_LENGTH,
    REPORT_REFERENCE_MAX_LENGTH,
    SOURCE_NAME_MAX_LENGTH,
    STATUS_REASON_MAX_LENGTH,
    ActivationStatus,
    WaterSourceKind,
)
from app.shared.location import OUT_OF_BOUNDS_MESSAGE
from app.shared.phone import normalize_nigerian_phone

CATEGORY_CODES = ("potable", "utility")
STATUS_BY_COMMAND = {"suspend": ActivationStatus.SUSPENDED, "revoke": ActivationStatus.REVOKED}


async def _run(args: argparse.Namespace) -> str:
    async with get_sessionmaker()() as session:
        if args.command == "list-categories":
            categories = await service.list_categories(session)
            lines = [
                f"{c.code:<8} {'active  ' if c.is_active else 'inactive'}  {c.label}"
                for c in categories
            ]
            return "\n".join(lines) or "No water categories."
        if args.command == "list-sources":
            return _format_sources(await service.list_sources(session))

        actor = await service.get_acting_admin(session, phone=args.by)
        if args.command == "add-source":
            location = _location_from(args)
            source = await service.add_source(
                session,
                actor=actor,
                name=args.name,
                approximate_location=args.location,
                is_simulated=args.simulated,
                kind=args.kind,
                location=location,
            )
            return f"Added water source {source.id}: {source.name}. It serves no category yet."
        if args.command == "set-kind":
            source = await service.set_kind(
                session, actor=actor, source_id=args.source, kind=args.kind
            )
            return f"Source {source.id} is now {args.kind.value}."
        if args.command == "activate":
            activation = await service.activate(
                session,
                actor=actor,
                source_id=args.source,
                category_code=args.category,
                approved_until=args.approved_until,
                report_reference=args.report,
                cost_per_litre_minor_units=args.cost_per_litre_kobo,
            )
            return (
                f"Activated source {activation.source_id} for {args.category} until "
                f"{activation.approved_until.isoformat()} (report {activation.report_reference})."
            )
        status = STATUS_BY_COMMAND[args.command]
        activation = await service.set_inactive_status(
            session,
            actor=actor,
            source_id=args.source,
            category_code=args.category,
            status=status,
            reason=args.reason,
        )
        return f"Source {activation.source_id} is now {status.value} for {args.category}."


def _format_sources(rows: list[service.SourceWithActivations]) -> str:
    lines: list[str] = []
    for row in rows:
        tag = "  [simulated]" if row.source.is_simulated else ""
        kind = row.source.kind.value if row.source.kind else "kind not set"
        lines.append(
            f"{row.source.id}  {row.source.name} ({row.source.approximate_location})  {kind}{tag}"
        )
        if not row.activations:
            lines.append("    no category activations")
        for activation, category in row.activations:
            lines.append(
                f"    {category.code:<8} {activation.status.value:<9} "
                f"until {activation.approved_until.isoformat()}  "
                f"report {activation.report_reference}  "
                f"{activation.cost_per_litre_minor_units} kobo/L"
            )
    return "\n".join(lines) or "No water sources yet."


async def _main(args: argparse.Namespace) -> str:
    try:
        return await _run(args)
    finally:
        await dispose_engine()


def _text(max_length: int) -> Callable[[str], str]:
    """An argparse type: trimmed text of 1 to ``max_length`` characters."""

    def parse(raw: str) -> str:
        value = raw.strip()
        if not 1 <= len(value) <= max_length:
            raise argparse.ArgumentTypeError(f"use 1-{max_length} characters")
        return value

    return parse


def _phone(raw: str) -> str:
    try:
        return normalize_nigerian_phone(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _date(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("a date as YYYY-MM-DD") from exc


def _cost(raw: str) -> int:
    try:
        kobo = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("a whole number of kobo") from exc
    if kobo < 0:
        raise argparse.ArgumentTypeError("0 or more kobo per litre")
    return kobo


def _degrees(value: str) -> float:
    try:
        return float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a number of degrees") from None


def _location_from(args: argparse.Namespace) -> service.SourceLocation | None:
    """The pickup point from ``--latitude`` and ``--longitude``: both or neither.

    Raises:
        SystemExit: Only one was given, or the point is outside the delivery bounds.
    """
    if (args.latitude is None) != (args.longitude is None):
        raise SystemExit("Give both --latitude and --longitude, or neither.")
    if args.latitude is None:
        return None
    if not get_settings().delivery_bounds.contains(args.latitude, args.longitude):
        raise SystemExit(OUT_OF_BOUNDS_MESSAGE)
    return service.SourceLocation(round(args.latitude, 6), round(args.longitude, 6))


def build_parser() -> argparse.ArgumentParser:
    """The command-line interface (exposed for tests)."""
    parser = argparse.ArgumentParser(prog="python -m app.modules.sources.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list-categories", help="list water categories and their codes")
    commands.add_parser("list-sources", help="list sources with their category activations")

    add = commands.add_parser("add-source", help="add a water source")
    add.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    add.add_argument("--name", required=True, type=_text(SOURCE_NAME_MAX_LENGTH))
    add.add_argument("--location", required=True, type=_text(APPROXIMATE_LOCATION_MAX_LENGTH))
    add.add_argument("--simulated", action="store_true", help="demo data (BR-09)")
    add.add_argument(
        "--kind",
        type=WaterSourceKind,
        choices=list(WaterSourceKind),
        help="ninth_mile or borehole; Tanker preferences match it (can be set later)",
    )

    add.add_argument("--latitude", type=_degrees, help="pickup point, with --longitude (#385)")
    add.add_argument("--longitude", type=_degrees, help="pickup point, with --latitude (#385)")

    kind = commands.add_parser("set-kind", help="set where a source collects water")
    kind.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    kind.add_argument("--source", required=True, type=uuid.UUID)
    kind.add_argument("--kind", required=True, type=WaterSourceKind, choices=list(WaterSourceKind))

    activate = commands.add_parser("activate", help="activate or renew a source for a category")
    activate.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
    activate.add_argument("--source", required=True, type=uuid.UUID)
    activate.add_argument("--category", required=True, choices=CATEGORY_CODES)
    activate.add_argument("--report", required=True, type=_text(REPORT_REFERENCE_MAX_LENGTH))
    activate.add_argument("--approved-until", required=True, type=_date)
    activate.add_argument("--cost-per-litre-kobo", required=True, type=_cost)

    for name, help_text in (
        ("suspend", "suspend after a safety concern (BR-10)"),
        ("revoke", "revoke an activation"),
    ):
        change = commands.add_parser(name, help=help_text)
        change.add_argument("--by", required=True, type=_phone, help="your admin account's phone")
        change.add_argument("--source", required=True, type=uuid.UUID)
        change.add_argument("--category", required=True, choices=CATEGORY_CODES)
        change.add_argument("--reason", required=True, type=_text(STATUS_REASON_MAX_LENGTH))
    return parser


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and run one command.

    Args:
        argv: Arguments without the program name; defaults to ``sys.argv[1:]``.

    Returns:
        Process exit code.
    """
    args = build_parser().parse_args(argv)
    try:
        print(asyncio.run(_main(args)))
    except (LookupError, service.KindRequiredError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
