"""Admin dispatch endpoints (docs/api/deliveries.md, "Admin dispatch endpoints").

Agreed in G3 (PR #59) from the approved admin dispatch design (D1-D5, H1).
Every endpoint uses ``CurrentAdmin``, so customers and drivers get 403
``forbidden`` (FR-001); ``POST`` also needs the CSRF header, which the auth
dependency enforces. Handlers only translate between HTTP and
:mod:`app.modules.dispatch.service`.

Only the driver list lives here. The order detail, withdraw and history
moved to the deliveries admin router with the hold review (#93), and the
offer (``assign``) followed in #280: each returns an ``AdminOrderDetail``,
which carries the job's hold and the order's contact attempts, and the
deliveries module owns both. Deliveries depends on dispatch, not the other
way round. Their services stay in :mod:`app.modules.dispatch.service`.
"""

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentAdmin
from app.modules.dispatch import service
from app.modules.dispatch.schemas import (
    DispatchDriver,
    DispatchDriverList,
)

router = APIRouter(prefix="/admin/orders", tags=["admin dispatch"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]

_READ_ERRORS: dict[int | str, dict[str, object]] = {
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
    HTTPStatus.NOT_FOUND: {"model": ErrorResponse},
}


@router.get("/{reference}/drivers", responses=_READ_ERRORS)
async def list_drivers(reference: str, _admin: CurrentAdmin, db: DbSession) -> DispatchDriverList:
    """List every driver with their eligibility for this order (D1, FR-031).

    Raises:
        APIError: 404 ``order_not_found``.
    """
    choices = await service.list_drivers_for_order(db, reference=reference)
    return DispatchDriverList(items=[DispatchDriver.from_choice(choice) for choice in choices])
