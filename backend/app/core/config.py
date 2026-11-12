"""Centralized application configuration loaded from environment variables.

Values come from real environment variables first, then the repository-root
``.env`` file. Validation runs once at startup, so a misconfigured deployment
fails immediately instead of on the first request. Variables are documented in
``.env.example`` and docs/architecture/backend.md.
"""

import re
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal, NamedTuple
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url

# The repository root .env is shared with Docker Compose.
REPO_ROOT = Path(__file__).resolve().parents[3]

ASYNC_DRIVER = "postgresql+asyncpg"
SYNC_DRIVER = "postgresql+psycopg"
MIN_SECRET_LENGTH = 32
# Official MmiriOma customer support number (SRS v0.2 FR-055).
OFFICIAL_SUPPORT_PHONE = "+2348133774902"
#: south, west, north, east in degrees: a box around Enugu State, wider than the
#: city on purpose (docs/api/delivery-location.md, "Delivery bounds").
DEFAULT_DELIVERY_LOCATION_BOUNDS = "5.9,6.9,7.2,8.0"
#: Nigeria's own extent, a sanity limit on the setting so a typo cannot widen
#: the box to the world.
NIGERIA_SOUTH, NIGERIA_WEST, NIGERIA_NORTH, NIGERIA_EAST = 4.0, 2.6, 14.0, 14.8


class DeliveryBounds(NamedTuple):
    """A box of WGS 84 degrees that a delivery location must fall inside."""

    south: float
    west: float
    north: float
    east: float

    def contains(self, latitude: float, longitude: float) -> bool:
        """Whether a point is inside the box, edges included."""
        return self.south <= latitude <= self.north and self.west <= longitude <= self.east


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
        support_phone: Customer support number in E.164 form, used in SMS
            templates and ``GET /public/contact`` (FR-055). Defaults to the
            official number.
        support_whatsapp_enabled: Whether WhatsApp support is on for
            ``support_phone`` (FR-055: only once confirmed active). When
            false, ``GET /public/contact`` returns ``whatsapp: null``.
        pilot_water_category: Code of the one water category every pilot
            quote and order uses (order details contract, question 2):
            ``utility`` (Utility Water) by default; ``potable`` only once a
            source is activated for it after laboratory verification
            (FR-012, FR-014).
        driver_location_freshness_seconds: Maximum age of a current driver
            point for automatic dispatch (FR-031, #410); default 300 seconds.
        quote_validity_minutes: How long a server quote can be ordered
            (FR-023, SRS §8; contract question 7): 60 by default.
        sms_provider: ``mock`` (development and test: nothing is sent, the
            message is logged locally) or ``termii``. Production requires
            ``termii`` (FR-003).
        termii_base_url: Termii API base URL; Termii shows the account's own
            base URL on its dashboard.
        termii_api_key: Termii API key. Required when ``sms_provider=termii``.
        termii_sender_id: Sender ID registered with Termii (3-11 characters).
            Required when ``sms_provider=termii``.
        termii_channel: Termii route. ``dnd`` is Termii's recommended route for
            OTPs and must be activated on the account; ``generic`` does not
            reach numbers on the Do-Not-Disturb list.
        sms_timeout_seconds: Timeout for one SMS provider request.
        osrm_base_url: Address of the OSRM routing server for road-distance
            pricing (FR-022, #385), for example ``http://osrm:5000``. Empty (the
            default) means off: every quote uses the zone fee. Stays empty in
            production until the deployment is measured (#384).
        osrm_timeout_seconds: How long to wait for OSRM before the quote falls
            back to the zone fee; a slow server counts as down.
        frontend_dist_dir: Folder of the built frontend (``npm run build``)
            that the API serves at ``/`` so the app and ``/api`` share one
            origin (docs/deployment/hostinger.md). Unset in
            development and tests, where Vite serves the frontend. When set it
            must contain ``index.html``.
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
    support_phone: str = OFFICIAL_SUPPORT_PHONE
    delivery_location_bounds: str = DEFAULT_DELIVERY_LOCATION_BOUNDS
    support_whatsapp_enabled: bool = False
    pilot_water_category: Literal["potable", "utility"] = "utility"
    driver_location_freshness_seconds: int = Field(default=300, gt=0)
    quote_validity_minutes: int = Field(default=60, ge=1, le=24 * 60)
    sms_provider: Literal["mock", "termii"] = "mock"
    termii_base_url: str = "https://api.ng.termii.com"
    termii_api_key: SecretStr | None = None
    termii_sender_id: str | None = Field(default=None, min_length=3, max_length=11)
    termii_channel: Literal["dnd", "generic"] = "dnd"
    sms_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    osrm_base_url: str = ""
    osrm_timeout_seconds: float = Field(default=2.0, gt=0, le=10)
    frontend_dist_dir: Path | None = None

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

    @field_validator("support_phone")
    @classmethod
    def _validate_support_phone(cls, value: str) -> str:
        if not re.fullmatch(r"\+\d{8,15}", value):
            raise ValueError("SUPPORT_PHONE must be in E.164 form, for example +2348133774902")
        return value

    @field_validator("delivery_location_bounds")
    @classmethod
    def _validate_delivery_location_bounds(cls, value: str) -> str:
        message = (
            "DELIVERY_LOCATION_BOUNDS must be four numbers, south,west,north,east, "
            "inside Nigeria with south below north and west below east"
        )
        try:
            south, west, north, east = (float(part) for part in value.split(","))
        except ValueError:
            raise ValueError(message) from None
        if not (
            NIGERIA_SOUTH <= south < north <= NIGERIA_NORTH
            and NIGERIA_WEST <= west < east <= NIGERIA_EAST
        ):
            raise ValueError(message)
        return value.strip()

    @field_validator("termii_base_url")
    @classmethod
    def _validate_termii_base_url(cls, value: str) -> str:
        parts = urlsplit(value.strip())
        if parts.scheme != "https" or not parts.netloc:
            raise ValueError("TERMII_BASE_URL must be an https URL")
        return value.strip().rstrip("/")

    @field_validator("osrm_base_url")
    @classmethod
    def _validate_osrm_base_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return ""
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            raise ValueError("OSRM_BASE_URL must be empty or an absolute http(s) URL")
        return value.rstrip("/")

    @field_validator("frontend_dist_dir")
    @classmethod
    def _validate_frontend_dist_dir(cls, value: Path | None) -> Path | None:
        # Fail at startup, not with a blank page, when the build is missing.
        if value is not None and not (value / "index.html").is_file():
            raise ValueError("FRONTEND_DIST_DIR must be a built frontend folder with index.html")
        return value

    @model_validator(mode="after")
    def _validate_sms_provider(self) -> Settings:
        if self.sms_provider == "termii" and (
            self.termii_api_key is None or not self.termii_sender_id
        ):
            raise ValueError("SMS_PROVIDER=termii requires TERMII_API_KEY and TERMII_SENDER_ID")
        return self

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
        # The mock provider sends nothing; a production deployment must never
        # tell customers a code was sent when it was not (FR-003).
        if self.sms_provider == "mock":
            raise ValueError("SMS_PROVIDER must be termii in production")
        return self

    @property
    def delivery_bounds(self) -> DeliveryBounds:
        """The validated ``DELIVERY_LOCATION_BOUNDS`` box."""
        south, west, north, east = (
            float(part) for part in self.delivery_location_bounds.split(",")
        )
        return DeliveryBounds(south, west, north, east)

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
