"""Response bodies and query of ``GET /admin/audit-logs`` (docs/api/admin-operations.md)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import BaseModel, StringConstraints, model_validator

from app.modules.audit.models import TARGET_TYPE_MAX_LENGTH
from app.modules.auth.models import UserRole
from app.modules.orders.schemas import PageParams

TargetType = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TARGET_TYPE_MAX_LENGTH)
]


class AuditLogParams(PageParams):
    """Query of ``GET /admin/audit-logs``: one record's log, or every row.

    Attributes:
        target_type: Kind of record, e.g. ``order``.
        target_id: Its id. Both or neither, else 422 ``validation_error``.
    """

    target_type: TargetType | None = None
    target_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _both_or_neither(self) -> Self:
        if (self.target_type is None) != (self.target_id is None):
            raise ValueError("Give both target_type and target_id, or neither")
        return self


class AuditActorRead(BaseModel):
    """Who acted."""

    id: uuid.UUID
    name: str
    role: UserRole


class AuditLogRead(BaseModel):
    """One audit row (``AuditLogRead`` in the contract).

    ``details`` is the row's metadata: ids and kinds only, never personal
    data. Reasons and notes stay on the business record, so there is no
    ``reason`` field. ``target_label`` names the record (an order reference, an
    area or driver name) and is looked up when the page is read, never stored;
    it is ``None`` for a record that is gone or anonymized and for the target
    types that have no label (docs/api/admin-operations.md).
    """

    id: uuid.UUID
    at: datetime
    actor: AuditActorRead
    action: str
    target_type: str
    target_id: uuid.UUID
    target_label: str | None
    details: dict[str, Any]


class AuditLogPage(BaseModel):
    """A page of audit rows, newest first."""

    items: list[AuditLogRead]
    total: int
    limit: int
    offset: int
