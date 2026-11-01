"""Phone verification by SMS code, and phone number changes (SRS v0.2 FR-003, FR-004).

Rules (FR-003 unless noted):

- A customer proves they own their account's phone with a **6-digit code**
  sent by SMS. A verified phone is required before the first order
  (``orders.service.ensure_customer_can_order``); later orders need nothing
  more unless the number changes.
- A code **expires 5 minutes** after it is sent and allows **5 attempts**.
  The fifth wrong code voids it. A code works once.
- Sending is limited **per phone number**: one code per **60 seconds**
  (resend cooldown) and **3 codes per rolling hour**. These counts come from
  the ``phone_verifications`` table, so they hold across restarts and
  workers. A transaction-scoped PostgreSQL advisory lock on the number makes
  the check and the insert atomic, so concurrent requests cannot both pass.
  Per-IP limits are added by the router (``rate_limit.py``).
- Sending a new code for the same account and purpose **invalidates** the
  earlier unused ones, so only the latest code works.
- Codes are stored only as an HMAC-SHA256 keyed with ``SESSION_SECRET`` and
  bound to the row ID. With only a million possible codes a plain hash would
  be trivially reversible; the key means a database leak alone does not
  reveal codes.
- If the SMS provider fails, nothing is stored (the earlier code stays valid)
  and the caller gets 503 ``sms_unavailable``: no verification is claimed. The
  failure reason (Sender ID, route, balance...) is logged for operators and
  never shown to the customer.
- **Accepted is not delivered.** The provider taking the message is stored as
  ``sms_status = accepted``. :func:`delivery_status` reads the provider's
  delivery report and moves it to ``delivered`` or ``failed`` (DND, rejected,
  expired). The customer app polls it and, on ``failed``, tells the customer
  the code did not arrive and offers a resend. A failed delivery does not
  shorten the resend cooldown, the hourly limit, the expiry or the attempt
  limit: those are unchanged (FR-003).
- **Phone change (FR-004):** the code goes to the **new** number. The account
  keeps its current number until the code is verified; then the number is
  replaced and marked verified, and the old number is kept on the
  verification row. A number used by another account cannot be adopted (the
  unique constraint on ``users.phone`` decides under concurrency).
"""

import hashlib
import hmac
import logging
import math
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http import HTTPStatus

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth.models import (
    MAX_CODE_ATTEMPTS,
    PhoneVerification,
    User,
    VerificationPurpose,
)
from app.modules.messaging.sms import SmsDeliveryError, SmsDeliveryStatus, SmsProvider
from app.shared.phone import format_phone_for_display

logger = logging.getLogger(__name__)

CODE_DIGITS = 6
CODE_LIFETIME = timedelta(minutes=5)
RESEND_COOLDOWN = timedelta(seconds=60)
CODES_PER_PHONE_PER_HOUR = 3
_HOUR = timedelta(hours=1)
# The provider's delivery report is read at most this often per code.
STATUS_CHECK_INTERVAL = timedelta(seconds=3)


@dataclass(frozen=True)
class CodeSent:
    """Result of sending a code.

    Attributes:
        phone: Number the code was sent to (E.164).
        expires_at: When the code stops working.
        resend_available_at: Earliest time another code can be requested.
        delivery_status: ``accepted`` right after sending: the provider took
            the message, which is not proof it arrived.
    """

    phone: str
    expires_at: datetime
    resend_available_at: datetime
    delivery_status: str = "accepted"


def generate_code() -> str:
    """Return a random 6-digit code from a cryptographic source, e.g. ``"042917"``."""
    return f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"


def hash_code(verification_id: uuid.UUID, code: str, secret: str) -> str:
    """Return the stored form of a code.

    Binding the hash to the row ID means equal codes on different rows have
    different hashes.

    Args:
        verification_id: The ``phone_verifications`` row ID.
        code: The 6-digit code.
        secret: ``SESSION_SECRET``.

    Returns:
        64-character hex HMAC-SHA256.
    """
    message = f"phone-code:{verification_id}:{code}".encode()
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def code_message(code: str) -> str:
    """SMS text for a verification code (FR-050 templates carry the support number).

    Args:
        code: The 6-digit code.

    Returns:
        The message, under 160 characters so it is one SMS.
    """
    support = format_phone_for_display(get_settings().support_phone)
    return (
        f"Your MmiriOma code is {code}. It expires in 5 minutes. "
        f"Never share this code. Help: {support}"
    )


def _too_many_codes(retry_after: timedelta) -> APIError:
    seconds = max(1, math.ceil(retry_after.total_seconds()))
    return APIError(
        HTTPStatus.TOO_MANY_REQUESTS,
        "too_many_attempts",
        "Too many codes requested. Please wait and try again.",
        details={"retry_after_seconds": seconds},
        headers={"Retry-After": str(seconds)},
    )


def _phone_already_registered() -> APIError:
    return APIError(
        HTTPStatus.CONFLICT,
        "phone_already_registered",
        "An account with this phone number already exists",
    )


async def _lock_phone(session: AsyncSession, phone: str) -> None:
    # Serializes code requests for one number until this transaction ends.
    await session.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(phone, 0))))


async def _check_send_limits(session: AsyncSession, phone: str, now: datetime) -> None:
    """Enforce the 60-second cooldown and the 3-per-hour limit for a number.

    Raises:
        APIError: 429 ``too_many_attempts`` with ``Retry-After``.
    """
    recent = list(
        await session.scalars(
            select(PhoneVerification.created_at)
            .where(PhoneVerification.phone == phone, PhoneVerification.created_at > now - _HOUR)
            .order_by(PhoneVerification.created_at)
        )
    )
    if recent and recent[-1] > now - RESEND_COOLDOWN:
        raise _too_many_codes(recent[-1] + RESEND_COOLDOWN - now)
    if len(recent) >= CODES_PER_PHONE_PER_HOUR:
        # The oldest code in the window must age out before another is sent.
        oldest_counted = recent[len(recent) - CODES_PER_PHONE_PER_HOUR]
        raise _too_many_codes(oldest_counted + _HOUR - now)


async def send_code(
    session: AsyncSession,
    *,
    user: User,
    purpose: VerificationPurpose,
    sms: SmsProvider,
    new_phone: str | None = None,
    now: datetime | None = None,
) -> CodeSent:
    """Send a verification code by SMS and record it. Commits.

    Args:
        session: Database session (the request's; ``user`` belongs to it).
        user: The signed-in customer.
        purpose: ``account_phone`` (verify ``user.phone``) or
            ``phone_change`` (verify ``new_phone``).
        sms: SMS provider.
        new_phone: Normalized new number; required for ``phone_change``.
        now: Current time, for tests.

    Returns:
        Where the code went and when it expires.

    Raises:
        APIError: 409 ``phone_already_verified`` (account phone already
            verified); 409 ``phone_unchanged`` (new number is the current
            one); 409 ``phone_already_registered`` (another account has the
            new number); 429 ``too_many_attempts``; 503 ``sms_unavailable``.
    """
    now = now or datetime.now(UTC)
    if purpose is VerificationPurpose.ACCOUNT_PHONE:
        if user.phone_verified_at is not None:
            raise APIError(
                HTTPStatus.CONFLICT,
                "phone_already_verified",
                "Your phone number is already verified",
            )
        phone = user.phone
    else:
        if new_phone is None:
            raise ValueError("new_phone is required for a phone change")
        if new_phone == user.phone:
            raise APIError(
                HTTPStatus.CONFLICT, "phone_unchanged", "This is already your phone number"
            )
        if await session.scalar(select(User.id).where(User.phone == new_phone)) is not None:
            raise _phone_already_registered()
        phone = new_phone

    await _lock_phone(session, phone)
    await _check_send_limits(session, phone, now)

    # Only the newest code for this account and purpose may work.
    await session.execute(
        update(PhoneVerification)
        .where(
            PhoneVerification.user_id == user.id,
            PhoneVerification.purpose == purpose,
            PhoneVerification.consumed_at.is_(None),
            PhoneVerification.invalidated_at.is_(None),
        )
        .values(invalidated_at=now, updated_at=now)
    )
    code = generate_code()
    verification_id = uuid.uuid4()
    verification = PhoneVerification(
        id=verification_id,
        user_id=user.id,
        phone=phone,
        purpose=purpose,
        code_hash=hash_code(
            verification_id, code, get_settings().session_secret.get_secret_value()
        ),
        expires_at=now + CODE_LIFETIME,
        attempts=0,
        # One clock (the app's) for both sending limits and expiry.
        created_at=now,
        updated_at=now,
    )
    session.add(verification)
    await session.flush()

    try:
        receipt = await sms.send(phone=phone, text=code_message(code))
    except SmsDeliveryError as exc:
        # Nothing was sent, so nothing is recorded: the earlier code (if any)
        # stays valid and the attempt does not count against the limits. The
        # reason helps an operator (wrong Sender ID, route off, empty wallet);
        # the number and the code are not logged.
        logger.error("Verification SMS not accepted: reason=%s", exc.reason.value)
        await session.rollback()
        raise APIError(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "sms_unavailable",
            "We could not send the code right now. Please try again in a few minutes.",
        ) from exc
    verification.sms_message_id = receipt.message_id
    await session.commit()
    return CodeSent(
        phone=phone, expires_at=now + CODE_LIFETIME, resend_available_at=now + RESEND_COOLDOWN
    )


@dataclass(frozen=True)
class CodeStatus:
    """Where the latest code stands, for the customer app's polling.

    Attributes:
        delivery_status: ``accepted`` (sent to the carrier, no report yet),
            ``delivered`` or ``failed`` (did not arrive: offer a resend).
        expires_at: When the code stops working.
        resend_available_at: Earliest time another code can be requested.
    """

    delivery_status: str
    expires_at: datetime
    resend_available_at: datetime


async def delivery_status(
    session: AsyncSession,
    *,
    user: User,
    purpose: VerificationPurpose,
    sms: SmsProvider,
    now: datetime | None = None,
) -> CodeStatus:
    """Report whether the newest code reached the phone. Commits when it learns more.

    Asks the SMS provider for its delivery report (at most every
    :data:`STATUS_CHECK_INTERVAL`) while the status is still ``accepted``.
    ``delivered`` and ``failed`` are final for a code. A provider that cannot
    be reached leaves the status ``accepted``: delivery is never assumed.

    Args:
        session: Database session.
        user: The signed-in user.
        purpose: Which flow the code belongs to.
        sms: SMS provider.
        now: Current time, for tests.

    Returns:
        The status with the code's expiry and resend times.

    Raises:
        APIError: 400 ``verification_code_expired`` if there is no usable code
            (never sent, expired, replaced or used).
    """
    now = now or datetime.now(UTC)
    verification = await session.scalar(
        select(PhoneVerification)
        .where(
            PhoneVerification.user_id == user.id,
            PhoneVerification.purpose == purpose,
            PhoneVerification.consumed_at.is_(None),
            PhoneVerification.invalidated_at.is_(None),
        )
        .order_by(PhoneVerification.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if verification is None or verification.expires_at <= now:
        raise _code_expired()

    due = (
        verification.sms_status_checked_at is None
        or verification.sms_status_checked_at <= now - STATUS_CHECK_INTERVAL
    )
    if verification.sms_status == "accepted" and verification.sms_message_id and due:
        reported = await sms.delivery_status(verification.sms_message_id)
        verification.sms_status_checked_at = now
        if reported is not SmsDeliveryStatus.ACCEPTED:
            verification.sms_status = reported.value
            if reported is SmsDeliveryStatus.FAILED:
                logger.warning(
                    "Verification SMS reported as not delivered (id %s)", verification.id
                )
        await session.commit()
    return CodeStatus(
        delivery_status=verification.sms_status,
        expires_at=verification.expires_at,
        resend_available_at=verification.created_at + RESEND_COOLDOWN,
    )


def _code_expired() -> APIError:
    return APIError(
        HTTPStatus.BAD_REQUEST,
        "verification_code_expired",
        "This code has expired or was replaced. Request a new code.",
    )


async def verify_code(
    session: AsyncSession,
    *,
    user: User,
    purpose: VerificationPurpose,
    code: str,
    now: datetime | None = None,
) -> User:
    """Check a code and, if right, verify the phone or apply the change. Commits.

    Only the newest unused code for the account and purpose is checked. Its
    row is locked, so concurrent guesses cannot exceed the attempt limit.

    Args:
        session: Database session (the request's; ``user`` belongs to it).
        user: The signed-in customer.
        purpose: Which flow the code belongs to.
        code: The 6 digits the customer entered (format already validated).
        now: Current time, for tests.

    Returns:
        The updated user: ``phone_verified_at`` set and, for a phone change,
        the new ``phone``.

    Raises:
        APIError: 400 ``verification_code_expired`` (no usable code: never
            sent, expired, replaced, used up or already used);
            400 ``verification_code_invalid`` with
            ``details.attempts_remaining`` (wrong code; at 0 the code is void);
            409 ``phone_already_registered`` (the new number was taken
            meanwhile).
    """
    now = now or datetime.now(UTC)
    verification = await session.scalar(
        select(PhoneVerification)
        .where(
            PhoneVerification.user_id == user.id,
            PhoneVerification.purpose == purpose,
            PhoneVerification.consumed_at.is_(None),
            PhoneVerification.invalidated_at.is_(None),
        )
        .order_by(PhoneVerification.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if verification is None or verification.expires_at <= now:
        raise _code_expired()

    secret = get_settings().session_secret.get_secret_value()
    if not hmac.compare_digest(verification.code_hash, hash_code(verification.id, code, secret)):
        verification.attempts += 1
        remaining = MAX_CODE_ATTEMPTS - verification.attempts
        if remaining == 0:
            verification.invalidated_at = now
        await session.commit()
        raise APIError(
            HTTPStatus.BAD_REQUEST,
            "verification_code_invalid",
            "That code is not right."
            if remaining
            else "That code is not right. Request a new code.",
            details={"attempts_remaining": remaining},
        )

    verification.consumed_at = now
    if purpose is VerificationPurpose.PHONE_CHANGE:
        verification.replaced_phone = user.phone
        user.phone = verification.phone
    user.phone_verified_at = now
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _phone_already_registered() from exc
    return user
