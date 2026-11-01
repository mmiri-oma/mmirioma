"""Auth endpoints: register, login, logout, me, phone verification, password (docs/api/auth.md).

Partner sign-up (``POST /auth/partner-register``, docs/api/partners.md) is
here too, because it starts a session like registration.
"""

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.auth import phone_verification, security, service
from app.modules.auth.dependencies import (
    SESSION_COOKIE_NAME,
    AuthSession,
    CurrentCustomer,
    CurrentCustomerOrDriver,
)
from app.modules.auth.models import UserRole, VerificationPurpose
from app.modules.auth.rate_limit import AuthRateLimits, get_auth_rate_limits
from app.modules.auth.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    PhoneChangeRequest,
    PhoneCodeSentRead,
    PhoneCodeStatusRead,
    RegisterRequest,
    SessionRead,
    UserRead,
    VerifyCodeRequest,
)
from app.modules.messaging.sms import SmsProvider, get_sms_provider
from app.modules.partners import service as partners_service
from app.modules.partners.schemas import PartnerRegisterRequest

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]
RateLimits = Annotated[AuthRateLimits, Depends(get_auth_rate_limits)]
Sms = Annotated[SmsProvider, Depends(get_sms_provider)]


def _client_ip(request: Request) -> str:
    # The direct peer; see rate_limit.py for running behind a reverse proxy.
    return request.client.host if request.client else "unknown"


def _session_response(auth: service.AuthenticatedSession) -> SessionRead:
    secret = get_settings().session_secret.get_secret_value()
    return SessionRead(
        user=UserRead.from_user(auth.user),
        csrf_token=security.csrf_token_for(auth.token, secret),
        expires_at=auth.session.expires_at,
    )


def _set_session_cookie(response: Response, auth: service.AuthenticatedSession) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE_NAME,
        auth.token,
        max_age=settings.session_max_age_seconds,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )


@router.post(
    "/register",
    status_code=HTTPStatus.CREATED,
    responses={
        HTTPStatus.CONFLICT: {"model": ErrorResponse},
        HTTPStatus.TOO_MANY_REQUESTS: {"model": ErrorResponse},
    },
)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: DbSession,
    limits: RateLimits,
) -> SessionRead:
    """Create a customer account and sign it in.

    The role is always ``customer``; staff accounts are created with the
    command-line tool. The phone starts unverified (FR-003). Attempts are
    counted per IP whatever their outcome, which also limits probing for
    registered phones (NFR-002).

    Raises:
        APIError: 409 ``phone_already_registered``; 429 ``too_many_attempts``.
    """
    limits.check_and_record_registration(_client_ip(request))
    user = await service.create_user(
        db, name=body.name, phone=body.phone, password=body.password, role=UserRole.CUSTOMER
    )
    auth = await service.start_session(db, user)
    _set_session_cookie(response, auth)
    return _session_response(auth)


@router.post(
    "/partner-register",
    status_code=HTTPStatus.CREATED,
    responses={
        HTTPStatus.CONFLICT: {"model": ErrorResponse},
        HTTPStatus.TOO_MANY_REQUESTS: {"model": ErrorResponse},
    },
)
async def partner_register(
    body: PartnerRegisterRequest,
    request: Request,
    response: Response,
    db: DbSession,
    limits: RateLimits,
) -> SessionRead:
    """Create a Keke rider or tanker driver account and sign it in (partners.md).

    The account has role ``driver`` and starts ``pending``: it can sign in,
    but cannot go online or be offered jobs until an admin approves it. It
    shares the registration limit per IP (NFR-002).

    Raises:
        APIError: 409 ``phone_already_registered``; 422 ``validation_error``
            (including an unknown or inactive ``service_zone_id``); 429
            ``too_many_attempts``.
    """
    limits.check_and_record_registration(_client_ip(request))
    user = await partners_service.register_partner(
        db,
        name=body.name,
        phone=body.phone,
        password=body.password,
        delivery_type=body.delivery_type,
        plate=body.plate,
        declared_capacity_gallons=body.declared_capacity_gallons,
        service_zone_id=body.service_zone_id,
    )
    auth = await service.start_session(db, user)
    _set_session_cookie(response, auth)
    return _session_response(auth)


@router.post(
    "/login",
    responses={
        HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
        HTTPStatus.TOO_MANY_REQUESTS: {"model": ErrorResponse},
    },
)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    limits: RateLimits,
) -> SessionRead:
    """Sign in with phone and password and start a new session.

    Failed attempts are limited per phone and per IP (NFR-002); the limit is
    checked before the password, so a limited caller learns nothing about it.

    Raises:
        APIError: 401 ``invalid_credentials`` for any failure;
            429 ``too_many_attempts``.
    """
    ip = _client_ip(request)
    limits.begin_login(body.phone, ip)
    user = await service.authenticate(db, phone=body.phone, password=body.password)
    limits.login_succeeded(body.phone, ip)
    auth = await service.start_session(db, user)
    _set_session_cookie(response, auth)
    return _session_response(auth)


@router.post(
    "/logout",
    status_code=HTTPStatus.NO_CONTENT,
    responses={
        HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
        HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
    },
)
async def logout(auth: AuthSession, db: DbSession) -> Response:
    """Revoke the current session and clear its cookie.

    Raises:
        APIError: 401 ``not_authenticated``; 403 ``csrf_failed``.
    """
    await service.revoke_session(db, auth.session)
    response = Response(status_code=HTTPStatus.NO_CONTENT)
    settings = get_settings()
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )
    return response


@router.post(
    "/password",
    status_code=HTTPStatus.NO_CONTENT,
    responses={
        HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
        HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
        HTTPStatus.TOO_MANY_REQUESTS: {"model": ErrorResponse},
    },
)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    auth: AuthSession,
    db: DbSession,
    limits: RateLimits,
) -> Response:
    """Change the signed-in account's password; other sessions end (#8). Any role.

    The current password is checked under the same per-phone and per-IP
    failure limits as sign-in, so this endpoint cannot guess passwords faster
    than login (NFR-002). This session stays signed in with its CSRF token.

    Raises:
        APIError: 401 ``not_authenticated``; 403 ``csrf_failed`` or
            ``password_incorrect``; 422 ``validation_error``; 429
            ``too_many_attempts``.
    """
    ip = _client_ip(request)
    limits.begin_login(auth.user.phone, ip)
    await service.check_password(auth.user, body.current_password)
    limits.login_succeeded(auth.user.phone, ip)
    await service.change_password(db, auth=auth, new_password=body.new_password)
    return Response(status_code=HTTPStatus.NO_CONTENT)


@router.get("/me", responses={HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse}})
async def me(auth: AuthSession) -> SessionRead:
    """Return the signed-in user and the session's CSRF token.

    Raises:
        APIError: 401 ``not_authenticated``.
    """
    return _session_response(auth)


# Errors shared by the phone verification endpoints (besides 422).
_CODE_REQUEST_ERRORS: dict[int | str, dict[str, object]] = {
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
    HTTPStatus.CONFLICT: {"model": ErrorResponse},
    HTTPStatus.TOO_MANY_REQUESTS: {"model": ErrorResponse},
    HTTPStatus.SERVICE_UNAVAILABLE: {"model": ErrorResponse},
}
_CODE_CHECK_ERRORS: dict[int | str, dict[str, object]] = {
    HTTPStatus.BAD_REQUEST: {"model": ErrorResponse},
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
    HTTPStatus.CONFLICT: {"model": ErrorResponse},
    HTTPStatus.TOO_MANY_REQUESTS: {"model": ErrorResponse},
}


def _code_sent(sent: phone_verification.CodeSent) -> PhoneCodeSentRead:
    return PhoneCodeSentRead(
        phone=sent.phone, expires_at=sent.expires_at, resend_available_at=sent.resend_available_at
    )


@router.post("/phone-verification", status_code=HTTPStatus.ACCEPTED, responses=_CODE_REQUEST_ERRORS)
async def request_phone_verification(
    request: Request,
    customer: CurrentCustomerOrDriver,
    db: DbSession,
    limits: RateLimits,
    sms: Sms,
) -> PhoneCodeSentRead:
    """Send a 6-digit code by SMS to the signed-in user's phone (FR-003).

    Customers and drivers: a partner verifies their phone before an admin can
    approve them (docs/api/partners.md, decision 9). Admins get 403.

    Raises:
        APIError: 409 ``phone_already_verified``; 429 ``too_many_attempts``
            (60-second cooldown, 3 codes per number per hour, or the IP
            limit); 503 ``sms_unavailable``.
    """
    limits.check_and_record_code_request(_client_ip(request))
    sent = await phone_verification.send_code(
        db, user=customer, purpose=VerificationPurpose.ACCOUNT_PHONE, sms=sms
    )
    return _code_sent(sent)


def _code_status(status: phone_verification.CodeStatus) -> PhoneCodeStatusRead:
    return PhoneCodeStatusRead.model_validate(status, from_attributes=True)


@router.get("/phone-verification/status")
async def phone_verification_status(
    customer: CurrentCustomerOrDriver, db: DbSession, sms: Sms
) -> PhoneCodeStatusRead:
    """Whether the newest code reached the phone (FR-003). Customers and drivers.

    ``accepted`` only means the SMS provider took the message. ``failed`` means
    the carrier reported it did not arrive, and the app should offer a resend.

    Raises:
        APIError: 400 ``verification_code_expired`` when there is no usable code.
    """
    return _code_status(
        await phone_verification.delivery_status(
            db, user=customer, purpose=VerificationPurpose.ACCOUNT_PHONE, sms=sms
        )
    )


@router.get("/phone-change/status")
async def phone_change_status(
    customer: CurrentCustomer, db: DbSession, sms: Sms
) -> PhoneCodeStatusRead:
    """Whether the newest code for a phone change reached the new number (FR-004).

    Raises:
        APIError: 400 ``verification_code_expired`` when there is no usable code.
    """
    return _code_status(
        await phone_verification.delivery_status(
            db, user=customer, purpose=VerificationPurpose.PHONE_CHANGE, sms=sms
        )
    )


@router.post("/phone-verification/verify", responses=_CODE_CHECK_ERRORS)
async def verify_phone(
    body: VerifyCodeRequest,
    request: Request,
    customer: CurrentCustomerOrDriver,
    db: DbSession,
    limits: RateLimits,
) -> UserRead:
    """Check the code; on success the phone is verified (FR-003). Customers and drivers.

    Raises:
        APIError: 400 ``verification_code_expired`` or
            ``verification_code_invalid``; 429 ``too_many_attempts``.
    """
    limits.check_and_record_code_check(_client_ip(request))
    user = await phone_verification.verify_code(
        db, user=customer, purpose=VerificationPurpose.ACCOUNT_PHONE, code=body.code
    )
    return UserRead.from_user(user)


@router.post("/phone-change", status_code=HTTPStatus.ACCEPTED, responses=_CODE_REQUEST_ERRORS)
async def request_phone_change(
    body: PhoneChangeRequest,
    request: Request,
    customer: CurrentCustomer,
    db: DbSession,
    limits: RateLimits,
    sms: Sms,
) -> PhoneCodeSentRead:
    """Send a code to a new phone number; the account keeps its number until verified (FR-004).

    The current password is checked first, under the same per-phone and
    per-IP failure limits as sign-in.

    Raises:
        APIError: 403 ``password_incorrect``; 409 ``phone_unchanged`` or
            ``phone_already_registered``; 429 ``too_many_attempts``;
            503 ``sms_unavailable``.
    """
    ip = _client_ip(request)
    limits.begin_login(customer.phone, ip)
    await service.check_password(customer, body.password)
    limits.login_succeeded(customer.phone, ip)
    limits.check_and_record_code_request(ip)
    sent = await phone_verification.send_code(
        db, user=customer, purpose=VerificationPurpose.PHONE_CHANGE, sms=sms, new_phone=body.phone
    )
    return _code_sent(sent)


@router.post("/phone-change/verify", responses=_CODE_CHECK_ERRORS)
async def verify_phone_change(
    body: VerifyCodeRequest,
    request: Request,
    customer: CurrentCustomer,
    db: DbSession,
    limits: RateLimits,
) -> UserRead:
    """Check the code sent to the new number; on success it replaces the old one (FR-004).

    Raises:
        APIError: 400 ``verification_code_expired`` or
            ``verification_code_invalid``; 409 ``phone_already_registered``;
            429 ``too_many_attempts``.
    """
    limits.check_and_record_code_check(_client_ip(request))
    user = await phone_verification.verify_code(
        db, user=customer, purpose=VerificationPurpose.PHONE_CHANGE, code=body.code
    )
    return UserRead.from_user(user)
