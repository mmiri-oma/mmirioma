"""Record the SMS delivery status of each verification code.

Until now a code counted as sent as soon as Termii accepted the request, but
"accepted" does not mean the handset received it (a number on the Do-Not-Disturb
list, or a network that refused the message, still shows as accepted). Each
``phone_verifications`` row now keeps the provider's message id and a status
(``accepted``, ``delivered``, ``failed``) read from the provider's delivery
report, so the app can offer a resend when delivery fails instead of waiting for
a code that will never arrive.

Existing rows get ``accepted`` (unknown), which is what was known about them.
Columns only; no data is rewritten and the downgrade drops them.

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-31 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | Sequence[str] | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "phone_verifications", sa.Column("sms_message_id", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "phone_verifications",
        sa.Column("sms_status", sa.String(length=10), server_default="accepted", nullable=False),
    )
    op.add_column(
        "phone_verifications",
        sa.Column("sms_status_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_phone_verifications_sms_status_valid"),
        "phone_verifications",
        "sms_status IN ('accepted', 'delivered', 'failed')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_phone_verifications_sms_status_valid"), "phone_verifications", type_="check"
    )
    op.drop_column("phone_verifications", "sms_status_checked_at")
    op.drop_column("phone_verifications", "sms_status")
    op.drop_column("phone_verifications", "sms_message_id")
