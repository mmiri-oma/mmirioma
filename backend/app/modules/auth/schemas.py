"""Request and response bodies for the auth endpoints (docs/api/auth.md)."""

import uuid
from datetime import datetime
from typing import Annotated

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
