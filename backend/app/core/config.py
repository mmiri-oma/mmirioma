"""Centralized application configuration loaded from environment variables.

Values come from real environment variables first, then the repository-root
``.env`` file. Validation runs once at startup, so a misconfigured deployment
fails immediately instead of on the first request. Variables are documented in
``.env.example`` and docs/architecture/backend.md.
"""

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url

# The repository root .env is shared with Docker Compose.
REPO_ROOT = Path(__file__).resolve().parents[3]

ASYNC_DRIVER = "postgresql+asyncpg"
SYNC_DRIVER = "postgresql+psycopg"
MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    """Validated application settings.

    Do not instantiate directly in application code; use :func:`get_settings`.

    Attributes:
        app_env: Deployment environment. ``production`` enables strict checks.
        app_debug: Enables SQL echo and debug tracebacks. Forbidden in production.
        database_url: asyncpg URL (``postgresql+asyncpg://...``). Kept as a
            SecretStr so the password is masked in reprs and logs.
        frontend_url: Exact frontend origin allowed by CORS, normalized without a
            trailing slash.
        session_secret: Key for hashing session tokens and deriving CSRF tokens.
        session_max_age_seconds: Absolute session lifetime; there is no sliding
            renewal.
        session_cookie_secure: Explicit ``Secure`` cookie flag. When unset it is
            on in production and off elsewhere (plain-http local development).
        session_cookie_samesite: ``SameSite`` attribute of the session cookie.
            Use ``none`` only when the frontend and API are on different sites;
            it requires a secure cookie.
    """

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    app_debug: bool = False
    # Required: contains credentials, so there is deliberately no default.
    database_url: SecretStr
    frontend_url: str = "http://localhost:5173"
    # Outside production a random per-process secret is generated when unset.
    session_secret: SecretStr = Field(
        default_factory=lambda: SecretStr(secrets.token_urlsafe(MIN_SECRET_LENGTH))
    )
    # Between 5 minutes and 30 days; default 7 days.
    session_max_age_seconds: int = Field(default=7 * 24 * 3600, ge=300, le=30 * 24 * 3600)
    session_cookie_secure: bool | None = None
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: SecretStr) -> SecretStr:
        url = make_url(value.get_secret_value())
        if url.drivername != ASYNC_DRIVER:
            raise ValueError(f"DATABASE_URL must use the '{ASYNC_DRIVER}://' scheme")
        if not url.database:
            raise ValueError("DATABASE_URL must include a database name")
        return value

    @field_validator("frontend_url")
    @classmethod
    def _validate_frontend_url(cls, value: str) -> str:
        parts = urlsplit(value.strip())
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            raise ValueError("FRONTEND_URL must be an absolute http(s) origin")
        if parts.path not in {"", "/"} or parts.query or parts.fragment:
            raise ValueError("FRONTEND_URL must be an origin without a path")
        # CORS compares origins exactly, so normalize away any trailing slash.
        return f"{parts.scheme}://{parts.netloc}"

    @model_validator(mode="after")
    def _validate_cookie_flags(self) -> Settings:
        # Browsers reject SameSite=None cookies that are not Secure.
        if self.session_cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("SESSION_COOKIE_SAMESITE=none requires a secure cookie")
        return self

    @model_validator(mode="after")
    def _validate_production(self) -> Settings:
        if not self.is_production:
            return self
        if self.session_cookie_secure is False:
            raise ValueError("SESSION_COOKIE_SECURE must not be false in production")
        if self.app_debug:
            raise ValueError("APP_DEBUG must be false in production")
        if "session_secret" not in self.model_fields_set:
            raise ValueError("SESSION_SECRET must be set in production")
        if len(self.session_secret.get_secret_value()) < MIN_SECRET_LENGTH:
            raise ValueError(
                f"SESSION_SECRET must be at least {MIN_SECRET_LENGTH} characters in production"
            )
        if not self.frontend_url.startswith("https://"):
            raise ValueError("FRONTEND_URL must use https in production")
        return self

    @property
    def is_production(self) -> bool:
        """Whether strict production rules apply."""
        return self.app_env == "production"

    @property
    def cookie_secure(self) -> bool:
        """Effective ``Secure`` flag for the session cookie."""
        if self.session_cookie_secure is None:
            return self.is_production
        return self.session_cookie_secure

    @property
    def async_database_url(self) -> URL:
        """DATABASE_URL parsed for the application's asyncpg engine."""
        return make_url(self.database_url.get_secret_value())

    @property
    def sync_database_url(self) -> URL:
        """Same database through a synchronous driver, used by Alembic."""
        return self.async_database_url.set(drivername=SYNC_DRIVER)


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, loading and validating them on first call.

    Returns:
        The cached Settings instance.

    Raises:
        pydantic.ValidationError: If required variables are missing or unsafe.
    """
    return Settings()  # type: ignore[call-arg]  # values come from the environment
