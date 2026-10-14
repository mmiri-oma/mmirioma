"""Command-line account administration for the technical lead.

Staff accounts cannot be created through the API (docs/api/auth.md), and there
is no admin user-management API yet. Run from ``backend/`` with the virtualenv
active and ``DATABASE_URL`` configured::

    python -m app.modules.auth.cli create-user --role admin --name Dispatcher --phone 08000000001
    python -m app.modules.auth.cli deactivate --phone 08000000001
    python -m app.modules.auth.cli activate --phone 08000000001

Passwords are read interactively and never accepted as arguments, so they do
not end up in shell history.
"""

import argparse
import asyncio
import getpass
import sys

from app.core.database import dispose_engine, get_sessionmaker
from app.core.errors import APIError
from app.modules.auth import service
from app.modules.auth.models import UserRole
from app.modules.auth.schemas import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH
from app.shared.phone import normalize_nigerian_phone


def _read_password() -> str:
    password = getpass.getpass("Password: ")
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise SystemExit(
            f"Password must be {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} characters."
        )
    if getpass.getpass("Repeat password: ") != password:
        raise SystemExit("Passwords do not match.")
    return password


async def _run(args: argparse.Namespace, phone: str, password: str | None) -> str:
    async with get_sessionmaker()() as session:
        if args.command == "create-user" and password is not None:
            user = await service.create_user(
                session,
                name=args.name,
                phone=phone,
                password=password,
                role=UserRole(args.role),
            )
            return f"Created {user.role} account {user.id}."
        user = await service.set_user_active(
            session, phone=phone, active=args.command == "activate"
        )
        state = "active" if user.is_active else "inactive (sessions revoked)"
        return f"Account {user.id} is now {state}."


async def _main(args: argparse.Namespace, phone: str, password: str | None) -> str:
    try:
        return await _run(args, phone, password)
    finally:
        await dispose_engine()


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and run one account command.

    Args:
        argv: Arguments without the program name; defaults to ``sys.argv[1:]``.

    Returns:
        Process exit code.
    """
    parser = argparse.ArgumentParser(prog="python -m app.modules.auth.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-user", help="create an account (prompts for password)")
    create.add_argument("--role", required=True, choices=[role.value for role in UserRole])
    create.add_argument("--name", required=True)
    create.add_argument("--phone", required=True)
    for command in ("activate", "deactivate"):
        commands.add_parser(command, help=f"{command} an account").add_argument(
            "--phone", required=True
        )
    args = parser.parse_args(argv)

    try:
        phone = normalize_nigerian_phone(args.phone)
        password = None
        if args.command == "create-user":
            args.name = args.name.strip()
            if not 1 <= len(args.name) <= 100:
                raise SystemExit("Name must be 1-100 characters.")
            # Prompt before starting the event loop; getpass blocks.
            password = _read_password()
        print(asyncio.run(_main(args, phone, password)))
    except (ValueError, LookupError, APIError) as exc:
        message = exc.message if isinstance(exc, APIError) else str(exc)
        print(f"Error: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
