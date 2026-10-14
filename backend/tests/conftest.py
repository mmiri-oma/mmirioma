import os

# Configure a self-contained test environment before the app is imported.
# This URL is never connected to by unit tests; it only satisfies validation.
os.environ["APP_ENV"] = "test"
os.environ["APP_DEBUG"] = "false"
os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@127.0.0.1:1/mmirioma_test"
os.environ["FRONTEND_URL"] = "http://localhost:5173"

from collections.abc import Iterator  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.auth.rate_limit import get_auth_rate_limits  # noqa: E402


@pytest.fixture(autouse=True)
def reset_auth_rate_limits() -> Iterator[None]:
    # The limiters are process-wide; keep tests independent of each other.
    get_auth_rate_limits().clear()
    yield
    get_auth_rate_limits().clear()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def client() -> Iterator[TestClient]:
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
