import pytest
from pydantic import ValidationError

from app.core.config import Settings

VALID_DB_URL = "postgresql+asyncpg://user:pass@localhost:5432/mmirioma"
STRONG_SECRET = "x" * 40


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {"database_url": VALID_DB_URL, **overrides}
    # _env_file=None isolates tests from any developer .env file.
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture(autouse=True)
def clear_app_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "APP_ENV",
        "APP_DEBUG",
        "DATABASE_URL",
        "FRONTEND_URL",
        "SESSION_SECRET",
        "SESSION_MAX_AGE_SECONDS",
        "SESSION_COOKIE_SECURE",
        "SESSION_COOKIE_SAMESITE",
    ):
        monkeypatch.delenv(name, raising=False)


def test_development_defaults() -> None:
    settings = make_settings()

    assert settings.app_env == "development"
    assert settings.app_debug is False
    assert settings.frontend_url == "http://localhost:5173"
    assert len(settings.session_secret.get_secret_value()) >= 32


def test_reads_values_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("APP_DEBUG", "true")
    monkeypatch.setenv("DATABASE_URL", VALID_DB_URL)
    monkeypatch.setenv("FRONTEND_URL", "http://127.0.0.1:5173")

    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.app_env == "test"
    assert settings.app_debug is True
    assert settings.frontend_url == "http://127.0.0.1:5173"


def test_database_url_is_required() -> None:
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://user:pass@localhost/mmirioma",
        "postgresql+psycopg://user:pass@localhost/mmirioma",
        "postgresql+asyncpg://user:pass@localhost",
    ],
)
def test_rejects_invalid_database_url(url: str) -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL"):
        make_settings(database_url=url)


def test_database_url_is_not_leaked_in_repr() -> None:
    assert "pass" not in repr(make_settings())


def test_sync_database_url_uses_psycopg_with_same_target() -> None:
    sync_url = make_settings().sync_database_url

    assert sync_url.drivername == "postgresql+psycopg"
    assert sync_url.host == "localhost"
    assert sync_url.database == "mmirioma"
    assert sync_url.password == "pass"


def test_frontend_url_trailing_slash_is_normalized() -> None:
    assert make_settings(frontend_url="http://localhost:5173/").frontend_url == (
        "http://localhost:5173"
    )


@pytest.mark.parametrize("url", ["localhost:5173", "ftp://example.com", "http://a.com/app"])
def test_rejects_invalid_frontend_url(url: str) -> None:
    with pytest.raises(ValidationError, match="FRONTEND_URL"):
        make_settings(frontend_url=url)


def test_unknown_app_env_is_rejected() -> None:
    with pytest.raises(ValidationError, match="app_env"):
        make_settings(app_env="staging")


def test_valid_production_settings() -> None:
    settings = make_settings(
        app_env="production",
        session_secret=STRONG_SECRET,
        frontend_url="https://app.mmirioma.example",
    )

    assert settings.is_production


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"frontend_url": "https://app.example"}, "SESSION_SECRET must be set"),
        ({"session_secret": "short", "frontend_url": "https://app.example"}, "at least 32"),
        (
            {"app_debug": True, "session_secret": STRONG_SECRET, "frontend_url": "https://a.io"},
            "APP_DEBUG",
        ),
        ({"session_secret": STRONG_SECRET, "frontend_url": "http://app.example"}, "https"),
    ],
)
def test_production_rejects_unsafe_settings(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        make_settings(app_env="production", **overrides)


def test_session_cookie_defaults_outside_production() -> None:
    settings = make_settings()

    assert settings.cookie_secure is False
    assert settings.session_cookie_samesite == "lax"
    assert settings.session_max_age_seconds == 7 * 24 * 3600


def test_session_cookie_is_secure_by_default_in_production() -> None:
    settings = make_settings(
        app_env="production", session_secret=STRONG_SECRET, frontend_url="https://app.example"
    )

    assert settings.cookie_secure is True


def test_production_rejects_insecure_session_cookie() -> None:
    with pytest.raises(ValidationError, match="SESSION_COOKIE_SECURE"):
        make_settings(
            app_env="production",
            session_secret=STRONG_SECRET,
            frontend_url="https://app.example",
            session_cookie_secure=False,
        )


def test_samesite_none_requires_secure_cookie() -> None:
    with pytest.raises(ValidationError, match="SAMESITE=none"):
        make_settings(session_cookie_samesite="none")

    settings = make_settings(session_cookie_samesite="none", session_cookie_secure=True)
    assert settings.cookie_secure is True


@pytest.mark.parametrize("seconds", [299, 30 * 24 * 3600 + 1])
def test_rejects_out_of_range_session_lifetime(seconds: int) -> None:
    with pytest.raises(ValidationError, match="session_max_age_seconds"):
        make_settings(session_max_age_seconds=seconds)
