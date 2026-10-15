"""Account and session business logic.

Rules implemented here (docs/api/auth.md):

- Self-registration always creates a ``customer`` (FR-001). Staff accounts are
  created only through :func:`create_user` from the command-line tool.
- Sign-in failures are indistinguishable: wrong password, unknown phone and
  inactive account all raise ``invalid_credentials``, and an unknown phone still
  costs one password hash, so response time does not reveal accounts.
- A session is usable only while unrevoked, unexpired and owned by an active
  user, so deactivating an account cuts off access immediately (FR-002).
"""

import asyncio
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cache
from http import HTTPStatus

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth import security
from app.modules.auth.models import User, UserRole, UserSession


@dataclass(frozen=True)
class AuthenticatedSession:
    """A valid session together with its user and the raw cookie token.

    Attributes:
        user: The signed-in, active user.
        session: The session row.
        token: Raw cookie token; needed to derive the CSRF token. Never log it.
    """

    user: User
    session: UserSession
    token: str


def _invalid_credentials() -> APIError:
    return APIError(
        HTTPStatus.UNAUTHORIZED,
        "invalid_credentials",
        "Phone number or password is incorrect",
    )


@cache
def _dummy_password_hash() -> str:
    # Verified against when the phone is unknown, so that path costs the same
    # as a real check. Computed once per process.
    return security.hash_password("timing-equalizer-not-a-real-password")


def _secret() -> str:
    return get_settings().session_secret.get_secret_value()


async def create_user(
    session: AsyncSession, *, name: str, phone: str, password: str, role: UserRole
) -> User:
    """Create an account with a hashed password and commit it.

    Args:
        session: Database session.
        name: Display name (already validated).
        phone: Normalized E.164 phone number.
        password: Plain-text password; only its hash is stored.
        role: Role to grant. API registration always passes ``customer``.

    Returns:
        The new user.

    Raises:
        APIError: 409 ``phone_already_registered`` if the phone is taken. The
            unique constraint decides, so two concurrent registrations cannot
            both succeed.
    """
    password_hash = await asyncio.to_thread(security.hash_password, password)
    user = User(name=name, phone=phone, password_hash=password_hash, role=role)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise APIError(
            HTTPStatus.CONFLICT,
            "phone_already_registered",
            "An account with this phone number already exists",
        ) from exc
    return user


async def authenticate(session: AsyncSession, *, phone: str, password: str) -> User:
    """Return the active user matching a phone and password.

    Args:
        session: Database session.
        phone: Normalized E.164 phone number.
        password: Plain-text password.

    Returns:
        The authenticated user.

    Raises:
        APIError: 401 ``invalid_credentials`` for any failure (see module docs).
    """
    user = await session.scalar(select(User).where(User.phone == phone))
    stored_hash = user.password_hash if user else await asyncio.to_thread(_dummy_password_hash)
    password_ok = await asyncio.to_thread(security.verify_password, password, stored_hash)
    if user is None or not password_ok or not user.is_active:
        raise _invalid_credentials()
    return user


async def start_session(session: AsyncSession, user: User) -> AuthenticatedSession:
    """Create and commit a new session for a user.

    Args:
        session: Database session.
        user: The user who just registered or signed in.

    Returns:
        The new session, including the raw token for the cookie.
    """
    token = security.generate_session_token()
    user_session = UserSession(
        user_id=user.id,
        token_hash=security.hash_session_token(token, _secret()),
        expires_at=datetime.now(UTC) + timedelta(seconds=get_settings().session_max_age_seconds),
    )
    session.add(user_session)
    await session.commit()
    return AuthenticatedSession(user=user, session=user_session, token=token)


async def get_authenticated_session(
    session: AsyncSession, token: str
) -> AuthenticatedSession | None:
    """Look up a valid session by its cookie token.

    Args:
        session: Database session.
        token: Raw token from the session cookie.

    Returns:
        The session and its user, or None if the token is unknown, revoked,
        expired, or belongs to an inactive user.
    """
    row = (
        await session.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(
                UserSession.token_hash == security.hash_session_token(token, _secret()),
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > datetime.now(UTC),
                User.is_active.is_(True),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    user_session, user = row
    return AuthenticatedSession(user=user, session=user_session, token=token)


async def revoke_session(session: AsyncSession, user_session: UserSession) -> None:
    """Revoke one session (logout) and commit.

    Args:
        session: Database session.
        user_session: Session to end.
    """
    user_session.revoked_at = datetime.now(UTC)
    await session.commit()


async def set_user_active(session: AsyncSession, *, phone: str, active: bool) -> User:
    """Activate or deactivate an account and commit (FR-002).

    Deactivation also revokes every open session, so the account loses access
    to job data immediately rather than when its sessions expire.

    Args:
        session: Database session.
        phone: Normalized phone of the account.
        active: New state.

    Returns:
        The updated user.

    Raises:
        LookupError: If no account has this phone. Only the command-line tool
            calls this, so it is not an API error.
    """
    user = await session.scalar(select(User).where(User.phone == phone))
    if user is None:
        raise LookupError("No account with this phone number")
    user.is_active = active
    if not active:
        await session.execute(
            update(UserSession)
            .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC), updated_at=datetime.now(UTC))
        )
    await session.commit()
    return user


async def get_users_by_ids(
    session: AsyncSession, user_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, User]:
    """Return the accounts with the given IDs, keyed by ID.

    Lets other modules (for example orders, for the staff view of an order's
    customer) read accounts without querying this module's tables.

    Args:
        session: Database session.
        user_ids: IDs to look up. Unknown IDs are simply absent from the result.

    Returns:
        A mapping from ID to user.
    """
    if not user_ids:
        return {}
    users = await session.scalars(select(User).where(User.id.in_(set(user_ids))))
    return {user.id: user for user in users}


async def get_user_by_phone(session: AsyncSession, phone: str) -> User | None:
    """Return the account with this phone, active or not.

    Args:
        session: Database session.
        phone: Normalized E.164 phone number.

    Returns:
        The user, or None if no account has this phone.
    """
    return await session.scalar(select(User).where(User.phone == phone))
