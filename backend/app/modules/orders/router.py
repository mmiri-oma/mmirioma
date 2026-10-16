"""Order endpoints for customers and staff (docs/api/orders.md, agreed in S1-16).

Customer endpoints use ``CurrentCustomer`` and admin endpoints ``CurrentAdmin``,
so drivers get 403 ``forbidden`` on all of them (FR-001). ``POST`` also needs
the CSRF header, which the auth dependency enforces.
"""

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentAdmin, CurrentCustomer
from app.modules.orders import service
from app.modules.orders.schemas import (
    AdminOrderFilters,
    AdminOrderPage,
    AdminOrderRead,
    OrderCreate,
    OrderPage,
    OrderRead,
    PageParams,
)
from app.shared.demo_accounts import is_demo_identity

router = APIRouter(tags=["orders"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]

# Errors every endpoint here can return besides validation (shared codes).
_AUTH_ERRORS: dict[int | str, dict[str, object]] = {
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
}
_NOT_FOUND: dict[int | str, dict[str, object]] = {HTTPStatus.NOT_FOUND: {"model": ErrorResponse}}


@router.post(
    "/orders",
    status_code=HTTPStatus.CREATED,
    responses={
        **_AUTH_ERRORS,
        HTTPStatus.OK: {"model": OrderRead, "description": "Idempotent retry"},
        HTTPStatus.CONFLICT: {"model": ErrorResponse},
    },
)
async def create_order(
    body: OrderCreate, customer: CurrentCustomer, db: DbSession, response: Response
) -> OrderRead:
    """Submit an order request; it is stored in ``quote_requested`` with no price.

    Returns 201 for a new order and 200 when a retry with the same
    idempotency key and details returns the existing order (FR-026, T-06).

    An order placed by a demo account (``app.shared.demo_accounts``) is
    stored as simulated, so demo activity never counts as real (BR-09).

    Raises:
        APIError: 409 ``idempotency_key_reused`` if the key was used with
            different details.
    """
    order, created = await service.create_order(
        db,
        customer_id=customer.id,
        request=body.to_new_order(),
        is_simulated=is_demo_identity(name=customer.name, phone=customer.phone),
    )
    if not created:
        response.status_code = HTTPStatus.OK
    return OrderRead.model_validate(order)


@router.get("/orders", responses=_AUTH_ERRORS)
async def list_my_orders(
    page: Annotated[PageParams, Query()], customer: CurrentCustomer, db: DbSession
) -> OrderPage:
    """List the signed-in customer's own orders, newest first (FR-001)."""
    orders, total = await service.list_customer_orders(
        db, customer_id=customer.id, limit=page.limit, offset=page.offset
    )
    return OrderPage(
        items=[OrderRead.model_validate(order) for order in orders],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/orders/{reference}", responses={**_AUTH_ERRORS, **_NOT_FOUND})
async def get_my_order(reference: str, customer: CurrentCustomer, db: DbSession) -> OrderRead:
    """Return one of the signed-in customer's own orders.

    Raises:
        APIError: 404 ``order_not_found``, also for another customer's order
            (T-07).
    """
    order = await service.get_customer_order(db, customer_id=customer.id, reference=reference)
    return OrderRead.model_validate(order)


@router.get("/admin/orders", responses=_AUTH_ERRORS)
async def list_orders(
    filters: Annotated[AdminOrderFilters, Query()], _admin: CurrentAdmin, db: DbSession
) -> AdminOrderPage:
    """List all orders for the dispatcher, newest first, with filters (FR-030, BR-09)."""
    staff_orders, total = await service.list_orders_for_staff(
        db,
        statuses=filters.status,
        created_from=filters.created_from,
        created_to=filters.created_to,
        is_simulated=filters.is_simulated,
        limit=filters.limit,
        offset=filters.offset,
    )
    return AdminOrderPage(
        items=[AdminOrderRead.from_order(item.order, item.customer) for item in staff_orders],
        total=total,
        limit=filters.limit,
        offset=filters.offset,
    )


@router.get("/admin/orders/{reference}", responses={**_AUTH_ERRORS, **_NOT_FOUND})
async def get_order(reference: str, _admin: CurrentAdmin, db: DbSession) -> AdminOrderRead:
    """Return any order with its customer's account.

    Raises:
        APIError: 404 ``order_not_found``.
    """
    item = await service.get_order_for_staff(db, reference=reference)
    return AdminOrderRead.from_order(item.order, item.customer)
