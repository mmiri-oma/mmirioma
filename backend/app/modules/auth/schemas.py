"""Request and response bodies for the auth endpoints (docs/api/auth.md)."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.modules.auth.models import User, UserRole
from app.shared.phone import normalize_nigerian_phone

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128

PhoneNumber = Annotated[str, Field(max_length=32), AfterValidator(normalize_nigerian_phone)]
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# Length limits follow NIST SP 800-63B; no composition rules. The maximum also
# bounds hashing cost.
Password = Annotated[str, Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)]


class RegisterRequest(BaseModel):
    """Customer self-registration. Unknown fields (such as ``role``) are rejected."""

    model_config = ConfigDict(extra="forbid")

    name: PersonName
    phone: PhoneNumber
    password: Password


class LoginRequest(BaseModel):
    """Phone and password sign-in for every role."""

    model_config = ConfigDict(extra="forbid")

    phone: PhoneNumber
    # Only the maximum is enforced here: a too-short password simply fails to
    # match, and checking the minimum would leak the password policy per account.
    password: Annotated[str, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


class UserRead(BaseModel):
    """The signed-in user's own account details."""

    id: uuid.UUID
    name: str
    phone: str
    role: UserRole
    phone_verified: bool

    @classmethod
    def from_user(cls, user: User) -> UserRead:
        """Build the response from a model, hiding internal fields.

        Args:
            user: The account to describe.

        Returns:
            The public representation.
        """
        return cls(
            id=user.id,
            name=user.name,
            phone=user.phone,
            role=user.role,
            phone_verified=user.phone_verified_at is not None,
        )


class SessionRead(BaseModel):
    """Returned by register, login and ``/auth/me``.

    Attributes:
        user: The signed-in user.
        csrf_token: Value to send in ``X-CSRF-Token`` on unsafe requests.
        expires_at: When the session ends; the user must sign in again after it.
    """

    user: UserRead
    csrf_token: str
    expires_at: datetime


class PhoneCodeSentRead(BaseModel):
    """Returned when an SMS code was sent (FR-003, FR-004).

    Attributes:
        phone: Number the code went to (E.164).
        expires_at: When the code stops working (5 minutes after sending).
        resend_available_at: Earliest time a new code can be requested.
        delivery_status: Always ``accepted`` here: the SMS provider took the
            message, which is not proof the phone received it. Poll the
            status endpoint for ``delivered`` or ``failed``.
    """

    phone: str
    expires_at: datetime
    resend_available_at: datetime
    delivery_status: Literal["accepted", "delivered", "failed"] = "accepted"


class PhoneCodeStatusRead(BaseModel):
    """Where the newest code stands (``GET .../status``).

    Attributes:
        delivery_status: ``accepted`` (handed to the carrier, no report yet),
            ``delivered`` or ``failed`` (the code did not arrive: offer a
            resend once ``resend_available_at`` has passed).
        expires_at: When the code stops working.
        resend_available_at: Earliest time a new code can be requested.
    """

    delivery_status: Literal["accepted", "delivered", "failed"]
    expires_at: datetime
    resend_available_at: datetime


class VerifyCodeRequest(BaseModel):
    """A 6-digit SMS code as entered by the customer."""

    model_config = ConfigDict(extra="forbid")

    code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{6}$")]


class ChangePasswordRequest(BaseModel):
    """Change the signed-in account's password (docs/api/auth.md, "Change password").

    ``current_password`` checks only the maximum, as at sign-in: a too-short
    value simply does not match. ``new_password`` follows the password rules.
    The screen's "New password again" field is checked on the screen only.
    """

    model_config = ConfigDict(extra="forbid")

    current_password: Annotated[str, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]
    new_password: Password


class PhoneChangeRequest(BaseModel):
    """Start a phone number change (FR-004).

    The current password is required because the phone is the sign-in
    identifier: a stolen session alone must not be able to move the account to
    another number.
    """

    model_config = ConfigDict(extra="forbid")

    phone: PhoneNumber
    password: Annotated[str, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]
