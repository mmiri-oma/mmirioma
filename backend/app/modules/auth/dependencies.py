"""FastAPI dependencies for authentication, CSRF and role checks.

Other modules protect endpoints with the ``Annotated`` aliases at the bottom::

    @router.get("/orders")
    async def list_orders(customer: CurrentCustomer, ...) -> ...

Every dependency here also enforces CSRF: a request with an unsafe method
(POST, PUT, PATCH, DELETE) must carry the session's token in ``X-CSRF-Token``.
Putting the check in the authentication dependency means no authenticated
endpoint can forget it.
"""

from collections.abc import Awaitable, Callable
from http import HTTPStatus
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import APIKeyCookie
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.errors import APIError
from app.modules.auth import security, service
from app.modules.auth.models import User, UserRole

SESSION_COOKIE_NAME = "mmirioma_session"
CSRF_HEADER_NAME = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

# auto_error=False so a missing cookie produces our own error envelope; the
# scheme also documents cookie auth in the OpenAPI schema.
session_cookie = APIKeyCookie(name=SESSION_COOKIE_NAME, auto_error=False)


async def get_auth_session(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    token: Annotated[str | None, Depends(session_cookie)],
) -> service.AuthenticatedSession:
    """Resolve the signed-in session and enforce CSRF on unsafe methods.

    Args:
        request: Incoming request (for its method and CSRF header).
        db: Request-scoped database session.
        token: Session cookie value, if present.

    Returns:
        The valid session and its user.

    Raises:
        APIError: 401 ``not_authenticated`` if the cookie is missing, unknown,
            revoked, expired, or belongs to an inactive account.
            403 ``csrf_failed`` if an unsafe request lacks the right CSRF token.
    """
    auth = await service.get_authenticated_session(db, token) if token else None
    if auth is None:
        raise APIError(HTTPStatus.UNAUTHORIZED, "not_authenticated", "Please sign in")
    if request.method not in SAFE_METHODS:
        secret = get_settings().session_secret.get_secret_value()
        if not security.csrf_token_matches(
            request.headers.get(CSRF_HEADER_NAME), auth.token, secret
        ):
            raise APIError(
                HTTPStatus.FORBIDDEN,
                "csrf_failed",
                "Security token missing or invalid. Reload the page and try again.",
            )
    return auth


AuthSession = Annotated[service.AuthenticatedSession, Depends(get_auth_session)]


def require_roles(*roles: UserRole) -> Callable[..., Awaitable[User]]:
    """Build a dependency that admits only users with one of ``roles`` (FR-001).

    Args:
        *roles: Roles allowed to call the endpoint.

    Returns:
        A dependency returning the signed-in user.
    """
    allowed = frozenset(roles)

    async def _require(auth: AuthSession) -> User:
        if auth.user.role not in allowed:
            raise APIError(
                HTTPStatus.FORBIDDEN, "forbidden", "You do not have access to this resource"
            )
        return auth.user

    return _require


CurrentUser = Annotated[User, Depends(require_roles(*UserRole))]
CurrentCustomer = Annotated[User, Depends(require_roles(UserRole.CUSTOMER))]
CurrentAdmin = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
CurrentDriver = Annotated[User, Depends(require_roles(UserRole.DRIVER))]
