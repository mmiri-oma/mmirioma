"""Consistent JSON error responses for the whole API.

Every error response, whatever produced it, has this body::

    {"error": {"code": "not_found", "message": "Not Found", "details": null}}

``code`` is a stable snake_case identifier that clients may branch on;
``message`` is human-readable and may change. See docs/architecture/backend.md.
"""

import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class ErrorDetail(BaseModel):
    """Inner object of the error envelope.

    Attributes:
        code: Stable machine-readable error code, e.g. ``"validation_error"``.
        message: Human-readable description, safe to show to end users.
        details: Optional structured context, e.g. the list of invalid fields.
    """

    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    """Error envelope returned by every failing request. Use in OpenAPI ``responses``."""

    error: ErrorDetail


class APIError(Exception):
    """Exception that application code raises to return a structured error.

    Example:
        ``raise APIError(HTTPStatus.CONFLICT, "order_already_assigned", "Order is assigned")``

    Args:
        status_code: HTTP status code of the response.
        code: Stable snake_case error code for clients.
        message: Human-readable message. Must not contain internal details or secrets.
        details: Optional JSON-serializable context.
        headers: Optional response headers, e.g. ``Retry-After`` on 429.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: Any | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Build a JSONResponse containing the standard error envelope.

    Args:
        status_code: HTTP status code.
        code: Stable error code.
        message: Human-readable message.
        details: Optional JSON-serializable context.
        headers: Optional response headers (e.g. ``Allow`` for 405 responses).

    Returns:
        The response to send to the client.
    """
    body = ErrorResponse(error=ErrorDetail(code=code, message=message, details=details))
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(body),
        headers=headers,
    )


def _code_for_status(status_code: int) -> str:
    """Derive a snake_case code from the standard status phrase (404 -> ``"not_found"``)."""
    try:
        return HTTPStatus(status_code).phrase.lower().replace(" ", "_").replace("-", "_")
    except ValueError:
        return "error"


def _validation_details(exc: RequestValidationError) -> list[dict[str, Any]]:
    """Reduce pydantic validation errors to a safe, JSON-serializable list.

    Pydantic's raw errors include ``input`` (which can echo back secrets such as
    passwords) and ``ctx`` (which can hold exception objects that cannot be
    serialized). Only the location, message, and error type are returned.
    """
    return [
        {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]


async def _handle_api_error(_: Request, exc: APIError) -> JSONResponse:
    return error_response(exc.status_code, exc.code, exc.message, exc.details, exc.headers)


async def _handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    # Covers framework-raised errors such as 404 (unknown route) and 405.
    message = exc.detail if isinstance(exc.detail, str) else HTTPStatus(exc.status_code).phrase
    return error_response(
        exc.status_code,
        _code_for_status(exc.status_code),
        message,
        headers=exc.headers,
    )


async def _handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(
        HTTPStatus.UNPROCESSABLE_CONTENT,
        "validation_error",
        "Request validation failed",
        details=_validation_details(exc),
    )


async def _handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    # Never expose internal exception details to clients.
    return error_response(
        HTTPStatus.INTERNAL_SERVER_ERROR,
        "internal_server_error",
        "An unexpected error occurred",
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Install the handlers that convert every error into the standard envelope.

    Note:
        When ``APP_DEBUG`` is true, Starlette shows its debug traceback page for
        unhandled exceptions instead of the 500 envelope. Production forbids debug.

    Args:
        app: The application to configure.
    """
    # Starlette types handlers as taking Exception; each is only called for its own type.
    app.add_exception_handler(APIError, _handle_api_error)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _handle_validation_error)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _handle_unexpected_error)
