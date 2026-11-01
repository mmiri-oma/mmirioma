"""Production deployment files stay safe and in step with the code (#282).

These are plain-text checks over ``compose.production.yaml``, the Caddyfile,
``.env.production.example`` and ``deploy/*.sh``. They need no Docker and no
database, so they run in CI on every pull request. The runbook is
``docs/deployment/hostinger.md``.
"""

import os
import re
import subprocess
from pathlib import Path

import pytest

from app.core.config import Settings

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = (ROOT / "compose.production.yaml").read_text(encoding="utf-8")
CADDYFILE = (ROOT / "deploy" / "Caddyfile").read_text(encoding="utf-8")
ENV_EXAMPLE = (ROOT / ".env.production.example").read_text(encoding="utf-8")
DEPLOY = ROOT / "deploy"

#: Names the env template may hold that the backend does not read: Docker
#: Compose build and substitution values, and the backup script's settings.
NOT_BACKEND_SETTINGS = {
    "SITE_DOMAIN",
    "POSTGRES_PASSWORD",
    "VITE_SUPPORT_PHONE",
    "VITE_SUPPORT_WHATSAPP",
    "BACKUP_DIR",
    "BACKUP_KEEP_DAYS",
    "BACKUP_RCLONE_REMOTE",
}
#: The compose file sets these itself, so the file's values never apply.
FORCED_BY_COMPOSE = {"APP_ENV", "APP_DEBUG", "SMS_PROVIDER", "DATABASE_URL", "FRONTEND_URL"}


def _run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    """Run one of the repository's own commands (fixed arguments, no user input)."""
    return subprocess.run(command, text=True, **kwargs)  # type: ignore[call-overload]  # noqa: S603


def _template_names(*, active_only: bool) -> set[str]:
    """Variable names in the template, as ``NAME=`` or ``# NAME=`` lines."""
    pattern = r"^NAME=" if active_only else r"^#?\s?NAME="
    names = set()
    for line in ENV_EXAMPLE.splitlines():
        match = re.match(pattern.replace("NAME", r"([A-Z][A-Z0-9_]*)"), line)
        if match:
            names.add(match.group(1))
    return names


def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in {n.upper() for n in Settings.model_fields} | {"DATABASE_URL"}:
        monkeypatch.delenv(name, raising=False)


class TestEnvTemplate:
    def test_every_name_is_a_backend_setting_or_a_known_compose_value(self) -> None:
        backend = {name.upper() for name in Settings.model_fields}
        unknown = _template_names(active_only=False) - backend - NOT_BACKEND_SETTINGS
        assert not unknown, f"Not supported by the code: {sorted(unknown)}"

    def test_does_not_set_what_compose_forces(self) -> None:
        assert not (_template_names(active_only=True) & FORCED_BY_COMPOSE)

    def test_holds_only_placeholders_for_secrets(self) -> None:
        for name in ("POSTGRES_PASSWORD", "SESSION_SECRET", "TERMII_API_KEY"):
            line = next(ln for ln in ENV_EXAMPLE.splitlines() if ln.startswith(f"{name}="))
            assert re.fullmatch(rf"{name}=<[a-z0-9-]+>", line), f"{name} must be a <placeholder>"

    def test_filled_in_template_starts_in_production(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clean_env(monkeypatch)
        values: dict[str, str] = {}
        for line in ENV_EXAMPLE.splitlines():
            if re.match(r"^[A-Z][A-Z0-9_]*=", line):
                name, _, value = line.partition("=")
                values[name] = value
        settings = Settings(
            _env_file=None,  # type: ignore[call-arg]
            database_url="postgresql+asyncpg://mmirioma:pw@db:5432/mmirioma",
            app_env="production",
            frontend_url=f"https://{values['SITE_DOMAIN']}",
            sms_provider="termii",
            session_secret="s" * 48,  # type: ignore[arg-type]
            termii_api_key="k",  # type: ignore[arg-type]
            termii_sender_id="MmiriOma",
            termii_channel=values["TERMII_CHANNEL"],  # type: ignore[arg-type]
        )
        assert settings.is_production
        assert settings.cookie_secure is True


class TestCompose:
    def test_only_caddy_publishes_ports_and_only_web_ports(self) -> None:
        assert COMPOSE.count("\n    ports:") == 1
        caddy = COMPOSE.split("\n  caddy:")[1].split("\nnetworks:")[0]
        assert "\n    ports:" in caddy
        published = set(re.findall(r'^\s+- "(\d+:\d+(?:/udp)?)"$', caddy, flags=re.M))
        assert published == {"80:80", "443:443", "443:443/udp"}

    def test_database_is_private_and_pinned(self) -> None:
        assert "image: postgis/postgis:16-3.4" in COMPOSE
        assert re.search(r"data:\n\s+internal: true", COMPOSE)
        db = COMPOSE.split("\n  db:")[1].split("\n  api:")[0]
        assert "networks: [data]" in db
        assert "ports" not in db

    def test_long_running_services_restart_and_report_health(self) -> None:
        assert COMPOSE.count("restart: unless-stopped") == 3  # db, api, caddy
        assert COMPOSE.count("healthcheck:") == 3
        assert "caddy:2.10-alpine" in COMPOSE
        assert ":latest" not in COMPOSE.replace("${APP_VERSION:-latest}", "")

    def test_development_behaviour_is_forced_off(self) -> None:
        api = COMPOSE.split("\n  api:")[1].split("\n  migrate:")[0]
        assert "APP_ENV: production" in api
        assert 'APP_DEBUG: "false"' in api
        assert "SMS_PROVIDER: termii" in api
        assert "mock" not in COMPOSE.lower()

    def test_api_never_migrates_on_start(self) -> None:
        api = COMPOSE.split("\n  api:")[1].split("\n  migrate:")[0]
        assert "alembic" not in api
        assert "start.sh" not in api
        assert "uvicorn" in api

    def test_proxy_headers_are_trusted_from_the_edge_network_only(self) -> None:
        assert "--forwarded-allow-ips\n      - 172.28.0.0/24" in COMPOSE
        assert "subnet: 172.28.0.0/24" in COMPOSE
        assert "'*'" not in COMPOSE
        assert '- --workers\n      - "1"' in COMPOSE  # in-memory rate limits

    def test_logs_are_rotated(self) -> None:
        assert 'max-size: "10m"' in COMPOSE
        assert COMPOSE.count("logging: *logging") == 4  # db, api, migrate, caddy


class TestCaddyfile:
    def test_www_redirects_to_the_main_domain(self) -> None:
        assert re.search(
            r"www\.\{\$SITE_DOMAIN\} \{\s+redir https://\{\$SITE_DOMAIN\}\{uri\} permanent",
            CADDYFILE,
        )

    def test_main_domain_goes_to_the_api_which_serves_the_app(self) -> None:
        assert "reverse_proxy api:8000" in CADDYFILE
        assert "encode" in CADDYFILE


class TestImage:
    def test_build_pins_mocks_off(self) -> None:
        dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
        assert "ENV VITE_USE_MOCKS=false" in dockerfile

    def test_env_file_and_backups_are_not_tracked(self) -> None:
        def ignored(name: str) -> bool:
            result = _run(
                ["git", "check-ignore", "-q", name], cwd=ROOT, check=False, capture_output=True
            )
            return result.returncode == 0

        if not (ROOT / ".git").exists():
            pytest.skip("not a git checkout")
        assert ignored(".env.production")
        assert not ignored(".env.production.example")


SCRIPTS = ["prod.sh", "production-backup.sh", "production-migrate.sh"]


class TestScripts:
    @pytest.mark.parametrize("name", SCRIPTS)
    def test_is_valid_bash_and_executable(self, name: str) -> None:
        path = DEPLOY / name
        assert os.access(path, os.X_OK), f"chmod +x deploy/{name}"
        _run(["bash", "-n", str(path)], check=True)

    def test_prod_wrapper_needs_an_env_file(self, tmp_path: Path) -> None:
        result = _run(
            [str(DEPLOY / "prod.sh"), "config"],
            env={**os.environ, "PROD_ENV_FILE": str(tmp_path / "missing")},
            capture_output=True,
            check=False,
        )
        assert result.returncode == 1
        assert "Missing" in result.stderr

    def test_migrate_rejects_unknown_options_before_touching_anything(self) -> None:
        result = _run(
            [str(DEPLOY / "production-migrate.sh"), "--force"],
            capture_output=True,
            check=False,
        )
        assert result.returncode == 2
        assert "Unknown option" in result.stderr

    def test_migrate_stops_when_the_pending_sql_cannot_be_rendered(self, tmp_path: Path) -> None:
        # A fake `docker` first on PATH stands in for compose (#320): the
        # database has a revision, and `alembic upgrade <rev>:head --sql`
        # fails. The script must stop, not report "Nothing pending".
        fake = tmp_path / "bin" / "docker"
        fake.parent.mkdir()
        fake.write_text(
            "#!/usr/bin/env bash\n"
            'case "$*" in\n'
            '  *" up -d --wait db"*) exit 0 ;;\n'
            '  *" migrate current"*) echo "0021 (head)" ;;\n'
            '  *" migrate heads"*) echo "0022 (head)" ;;\n'
            '  *" migrate upgrade 0021:head --sql"*)'
            ' echo "offline mode cannot run this migration" >&2; exit 1 ;;\n'
            '  *) echo "unexpected: $*" >&2; exit 99 ;;\n'
            "esac\n",
            encoding="utf-8",
        )
        fake.chmod(0o755)
        env_file = tmp_path / "env"
        env_file.write_text("SITE_DOMAIN=example.test\n", encoding="utf-8")
        result = _run(
            [str(DEPLOY / "production-migrate.sh"), "--check"],
            env={
                **os.environ,
                "PATH": f"{fake.parent}{os.pathsep}{os.environ['PATH']}",
                "PROD_ENV_FILE": str(env_file),
            },
            capture_output=True,
            check=False,
        )
        assert result.returncode == 1
        assert "Nothing pending" not in result.stdout
        assert "Could not render the pending migrations" in result.stderr
        # Alembic's own error is shown, not swallowed.
        assert "offline mode cannot run this migration" in result.stderr

    def test_backup_needs_a_database_password(self, tmp_path: Path) -> None:
        env_file = tmp_path / "env"
        env_file.write_text("SITE_DOMAIN=example.test\n", encoding="utf-8")
        result = _run(
            [str(DEPLOY / "production-backup.sh")],
            env={**os.environ, "PROD_ENV_FILE": str(env_file)},
            capture_output=True,
            check=False,
        )
        assert result.returncode == 1
        assert "POSTGRES_PASSWORD" in result.stderr
