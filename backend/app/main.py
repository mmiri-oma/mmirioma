"""FastAPI application factory and ASGI entry point (``uvicorn app.main:app``)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.database import dispose_engine
from app.core.errors import register_exception_handlers


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Release database connections when the application shuts down."""
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    """Build and configure the FastAPI application.

    Tests call this to get a fresh app; production uses the module-level ``app``.

    Returns:
        The configured application.
    """
    settings = get_settings()

    app = FastAPI(
        title="MmiriOma API",
        description="Water delivery and distribution platform",
        version="0.1.0",
        debug=settings.app_debug,
        lifespan=lifespan,
    )

    # Credentials are allowed, so origins must be explicit; never use "*".
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_url],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        # X-CSRF-Token carries the session's CSRF token (app/modules/auth).
        allow_headers=["Accept", "Content-Type", "Authorization", "X-CSRF-Token"],
    )

    register_exception_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()
