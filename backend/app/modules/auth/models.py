"""User accounts and server-side browser sessions."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, String, true
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
        phone_verified_at: When the customer proved they own ``phone`` with
            an SMS code (FR-003). Null until then. A customer needs it before
            their first order; changing the phone sets it again (FR-004).
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


class VerificationPurpose(StrEnum):
    """Why a phone verification code was sent (FR-003, FR-004)."""

    # Prove the account's own phone before the first order (FR-003).
    ACCOUNT_PHONE = "account_phone"
    # Prove a new phone number before it replaces the account's (FR-004).
    PHONE_CHANGE = "phone_change"


# Code rules from SRS v0.2 FR-003 (see phone_verification.py).
MAX_CODE_ATTEMPTS = 5


class PhoneVerification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One SMS verification code sent to a phone number (FR-003, FR-004).

    Rows are kept after use: they are the record of when and how a number was
    verified or changed (NFR-004), and they back the per-phone sending limits.

    A code is usable while ``consumed_at`` and ``invalidated_at`` are null,
    ``expires_at`` is in the future and ``attempts`` is below
    :data:`MAX_CODE_ATTEMPTS`.

    Attributes:
        user_id: Account that asked for the code.
        phone: Number the code was sent to (E.164). For ``phone_change`` this is
            the new number.
        purpose: :class:`VerificationPurpose`.
        code_hash: HMAC-SHA256 of the code (``phone_verification.hash_code``);
            the code itself is never stored.
        expires_at: Five minutes after sending.
        attempts: Wrong codes entered so far, 0-5.
        consumed_at: When the right code was entered.
        invalidated_at: When the code stopped being usable without success: a
            newer code was sent, or the attempts ran out.
        replaced_phone: For a completed ``phone_change``, the number it
            replaced, so changes stay traceable.
        sms_message_id: The SMS provider's id for the message that carried the
            code, used to read its delivery report. Null for rows from before
            this was recorded.
        sms_status: ``accepted`` (the provider took the message; not proof it
            arrived), ``delivered`` or ``failed`` (the carrier reported it did
            not arrive). Starts ``accepted``; only a delivery report changes it.
        sms_status_checked_at: When the delivery report was last read, so the
            provider is not asked more often than needed.
    """

    __tablename__ = "phone_verifications"
    __table_args__ = (
        CheckConstraint(f"attempts BETWEEN 0 AND {MAX_CODE_ATTEMPTS}", name="attempts_range"),
        CheckConstraint(
            "sms_status IN ('accepted', 'delivered', 'failed')", name="sms_status_valid"
        ),
        # Per-phone sending limits count recent codes for one number.
        Index("ix_phone_verifications_phone_created_at", "phone", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    phone: Mapped[str] = mapped_column(String(16))
    purpose: Mapped[VerificationPurpose] = mapped_column(
        Enum(
            VerificationPurpose,
            name="verification_purpose",
            native_enum=False,
            create_constraint=True,
            length=20,
            values_callable=lambda purposes: [purpose.value for purpose in purposes],
        )
    )
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime]
    attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    consumed_at: Mapped[datetime | None] = mapped_column(default=None)
    invalidated_at: Mapped[datetime | None] = mapped_column(default=None)
    replaced_phone: Mapped[str | None] = mapped_column(String(16), default=None)
    sms_message_id: Mapped[str | None] = mapped_column(String(64), default=None)
    sms_status: Mapped[str] = mapped_column(
        String(10), default="accepted", server_default="accepted"
    )
    sms_status_checked_at: Mapped[datetime | None] = mapped_column(default=None)
