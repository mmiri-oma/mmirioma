"""Auth endpoints: register, login, logout, me (docs/api/auth.md)."""

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.auth import security, service
from app.modules.auth.dependencies import SESSION_COOKIE_NAME, AuthSession
from app.modules.auth.models import UserRole
from app.modules.auth.rate_limit import AuthRateLimits, get_auth_rate_limits
from app.modules.auth.schemas import LoginRequest, RegisterRequest, SessionRead, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]
RateLimits = Annotated[AuthRateLimits, Depends(get_auth_rate_limits)]


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


@router.get("/me", responses={HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse}})
async def me(auth: AuthSession) -> SessionRead:
    """Return the signed-in user and the session's CSRF token.

    Raises:
        APIError: 401 ``not_authenticated``.
    """
    return _session_response(auth)
