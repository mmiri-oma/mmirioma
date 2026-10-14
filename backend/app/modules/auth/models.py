"""User accounts and server-side browser sessions."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Enum, ForeignKey, String, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserRole(StrEnum):
    """Server-enforced roles (FR-001). ``admin`` covers dispatcher/administrator."""

    CUSTOMER = "customer"
    ADMIN = "admin"
    DRIVER = "driver"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A person who can sign in: customer, admin/dispatcher, or driver.

    Attributes:
        name: Display name, 1-100 characters.
        phone: Sign-in identifier in E.164 form (``+234...``); unique.
        password_hash: scrypt hash from ``security.hash_password``; never returned.
        role: The user's single role.
        is_active: Inactive users cannot sign in and their sessions stop working
            (FR-002).
        phone_verified_at: When a dispatcher confirmed the customer owns the
            phone (FR-003). Null until then; set by a later feature.
    """

    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(16), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # VARCHAR plus a CHECK constraint rather than a native PostgreSQL enum, so
    # adding a role later is a simple constraint change in a migration.
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            native_enum=False,
            create_constraint=True,
            length=20,
            values_callable=lambda roles: [role.value for role in roles],
        )
    )
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())
    phone_verified_at: Mapped[datetime | None] = mapped_column(default=None)


class UserSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A signed-in browser session, identified by the hash of its cookie token.

    A session is valid while ``revoked_at`` is null, ``expires_at`` is in the
    future, and the user is active.

    Attributes:
        user_id: Owner; sessions are deleted with the user.
        token_hash: HMAC-SHA256 of the cookie token (``security.hash_session_token``).
        expires_at: Absolute expiry (``SESSION_MAX_AGE_SECONDS`` after creation).
        revoked_at: Set on logout or account deactivation.
    """

    __tablename__ = "user_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)
