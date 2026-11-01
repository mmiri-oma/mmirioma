"""``GET /admin/audit-logs``: the audit log on the admin Settings page (NFR-004).

docs/api/admin-operations.md. ``CurrentAdmin`` only, so customers and
drivers get 403 ``forbidden`` (FR-001). Reading the log is not audited.
"""

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.audit import labels, service
from app.modules.audit.schemas import AuditActorRead, AuditLogPage, AuditLogParams, AuditLogRead
from app.modules.auth.dependencies import CurrentAdmin

router = APIRouter(prefix="/admin/audit-logs", tags=["admin audit log"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "",
    responses={
        HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
        HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
    },
)
async def list_audit_logs(
    params: Annotated[AuditLogParams, Query()], admin: CurrentAdmin, db: DbSession
) -> AuditLogPage:
    """Audit rows, newest first; one record's rows with ``target_type`` and ``target_id``."""
    rows, total = await service.list_logs(
        db,
        target_type=params.target_type,
        target_id=params.target_id,
        limit=params.limit,
        offset=params.offset,
    )
    target_labels = await labels.target_labels(
        db, [(log.target_type, log.target_id) for log, _ in rows]
    )
    return AuditLogPage(
        items=[
            AuditLogRead(
                id=log.id,
                at=log.created_at,
                actor=AuditActorRead(id=actor.id, name=actor.name, role=actor.role),
                action=log.action,
                target_type=log.target_type,
                target_id=log.target_id,
                target_label=target_labels[(log.target_type, log.target_id)],
                details=log.details,
            )
            for log, actor in rows
        ],
        total=total,
        limit=params.limit,
        offset=params.offset,
    )
