"""Error envelope behavior for validation, application, and unexpected errors."""

from http import HTTPStatus

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, field_validator

from app.core.errors import APIError, register_exception_handlers


class OrderInput(BaseModel):
    litres: int
    note: str

    @field_validator("litres")
    @classmethod
    def litres_must_be_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("must be positive")
        return value


@pytest.fixture
def error_client() -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/orders")
    async def create_order(body: OrderInput) -> OrderInput:
        return body

    @app.get("/conflict")
    async def conflict() -> None:
        raise APIError(HTTPStatus.CONFLICT, "order_conflict", "Order conflict", {"id": "1"})

    @app.get("/throttled")
    async def throttled() -> None:
        raise APIError(
            HTTPStatus.TOO_MANY_REQUESTS, "slow_down", "Slow down", headers={"Retry-After": "30"}
        )

    @app.get("/crash")
    async def crash() -> None:
        raise RuntimeError("internal secret detail")

    return TestClient(app, raise_server_exceptions=False)


def test_custom_validator_errors_return_422_not_500(error_client: TestClient) -> None:
    # Regression: ValueError objects in pydantic's ctx used to break serialization.
    response = error_client.post("/orders", json={"litres": -1, "note": "x"})

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "validation_error",
            "message": "Request validation failed",
            "details": [
                {
                    "loc": ["body", "litres"],
                    "msg": "Value error, must be positive",
                    "type": "value_error",
                }
            ],
        }
    }


def test_validation_details_do_not_echo_input(error_client: TestClient) -> None:
    response = error_client.post("/orders", json={"litres": "hunter2-secret"})

    assert response.status_code == 422
    assert "hunter2-secret" not in response.text


def test_api_error_is_rendered_in_envelope(error_client: TestClient) -> None:
    response = error_client.get("/conflict")

    assert response.status_code == 409
    assert response.json() == {
        "error": {"code": "order_conflict", "message": "Order conflict", "details": {"id": "1"}}
    }


def test_unexpected_errors_hide_internal_details(error_client: TestClient) -> None:
    response = error_client.get("/crash")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_server_error"
    assert "internal secret detail" not in response.text


def test_api_error_headers_are_sent(error_client: TestClient) -> None:
    response = error_client.get("/throttled")

    assert response.status_code == 429
    assert response.headers["retry-after"] == "30"
    assert response.json()["error"]["code"] == "slow_down"
