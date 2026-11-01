"""``target_label`` on the audit log against a real, migrated database (#296).

docs/api/admin-operations.md, ``GET /admin/audit-logs``: each row names its
record, looked up when the page is read. Runs only when TEST_DATABASE_URL is
set (``alembic upgrade head`` first). Every row is created here and deleted
afterwards by the ``created`` fixture borrowed from the admin operations tests.
"""

import uuid
from typing import Any

import pytest
from geoalchemy2 import WKTElement
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import labels
from app.modules.auth import retention
from app.modules.auth.models import User, UserRole
from app.modules.customers.models import SupportRequest, SupportRequestType
from app.modules.dispatch.models import Assignment
from app.modules.orders.models import Order, OrderStatus
from app.modules.payments.models import CashCollection, CashCollectionStatus, CashRemittance
from app.modules.pricing.models import ServiceZone
from tests import test_deliveries_integration as deliveries_tests
from tests.test_admin_operations_integration import Created, created  # noqa: F401
from tests.test_deliveries_integration import NOW, Sessions
from tests.test_orders_integration import TEST_DATABASE_URL, run

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]


def collect_statements(session: AsyncSession) -> list[str]:
    """Collect every SQL statement the session's connection runs from now on."""
    statements: list[str] = []

    @event.listens_for(session.sync_session.get_bind(), "before_cursor_execute")
    def _collect(_conn: Any, _cursor: Any, statement: str, *_args: Any) -> None:
        statements.append(statement)

    return statements


def test_each_target_type_gets_its_label_in_one_query_per_type(
    created: Created,  # noqa: F811
) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await deliveries_tests.setup(sessions, created)  # type: ignore[arg-type]
        driver = await deliveries_tests.add_user(sessions, created, UserRole.DRIVER)  # type: ignore[arg-type]
        reference = await deliveries_tests.add_job(
            sessions, s, driver, order_status=OrderStatus.DELIVERED
        )
        async with sessions() as session:
            order = await session.scalar(select(Order).where(Order.reference == reference))
            assert order is not None
            assignment = await session.scalar(
                select(Assignment).where(Assignment.order_id == order.id)
            )
            assert assignment is not None
            zone = ServiceZone(
                name=f"Sample Zone {uuid.uuid4().hex[:6]}",
                centre=WKTElement("POINT(7.4951 6.4584)", srid=4326),
            )
            remittance = CashRemittance(
                driver_id=driver.id,
                recorded_minor_units=880000,
                counted_minor_units=880000,
                difference_minor_units=0,
                received_by=s.admin.id,
                remitted_at=NOW,
            )
            support = SupportRequest(
                reference="SR-" + uuid.uuid4().hex[:8].upper(),
                user_id=s.customer.id,
                order_id=order.id,
                type=SupportRequestType.LATE,
                message="Sample message",
                idempotency_key=uuid.uuid4(),
            )
            session.add_all([zone, remittance, support])
            await session.flush()
            collection = CashCollection(
                order_id=order.id,
                driver_id=driver.id,
                assignment_id=assignment.id,
                amount_minor_units=880000,
                status=CashCollectionStatus.COLLECTED,
                collected_at=NOW,
                remittance_due_at=NOW,
            )
            session.add(collection)
            await session.commit()
            created.zone_ids.append(zone.id)

            gone = [
                ("customer_address", uuid.uuid4()),
                ("deletion_request", uuid.uuid4()),
                ("retention_review", uuid.uuid4()),
                ("price_list", uuid.uuid4()),
                ("order", uuid.uuid4()),
            ]
            targets = [
                ("order", order.id),
                ("cash_collection", collection.id),
                ("support_request", support.id),
                ("service_zone", zone.id),
                ("water_source", s.source_id),
                ("driver", driver.id),
                ("user", s.admin.id),
                ("cash_remittance", remittance.id),
                *gone,
            ]
            statements = collect_statements(session)
            found = await labels.target_labels(session, targets)

        assert found == {
            ("order", order.id): reference,
            ("cash_collection", collection.id): reference,
            ("support_request", support.id): support.reference,
            ("service_zone", zone.id): zone.name,
            ("water_source", s.source_id): "Sample Borehole A",
            ("driver", driver.id): driver.name,
            ("user", s.admin.id): s.admin.name,
            ("cash_remittance", remittance.id): driver.name,
            **dict.fromkeys(gone),
        }
        # One query for each of the eight target types that have a label (the
        # page has 13 rows), not one per row.
        assert len(statements) == 8

    run(scenario)


def test_an_anonymized_driver_gives_none_not_the_old_name(
    created: Created,  # noqa: F811
) -> None:
    async def scenario(sessions: Sessions) -> None:
        driver = await deliveries_tests.add_user(sessions, created, UserRole.DRIVER)  # type: ignore[arg-type]
        admin = await deliveries_tests.add_user(sessions, created, UserRole.ADMIN)  # type: ignore[arg-type]
        async with sessions() as session:
            remittance = CashRemittance(
                driver_id=driver.id,
                recorded_minor_units=0,
                counted_minor_units=0,
                difference_minor_units=0,
                received_by=admin.id,
                remitted_at=NOW,
            )
            session.add(remittance)
            await session.commit()
            targets = [("driver", driver.id), ("cash_remittance", remittance.id)]
            assert await labels.target_labels(session, targets) == {
                ("driver", driver.id): driver.name,
                ("cash_remittance", remittance.id): driver.name,
            }

            stored = await session.get(User, driver.id)
            assert stored is not None
            await retention.anonymize_account(
                session,
                stored,
                phone_marker=await retention.new_phone_marker(session),
                name=retention.ANONYMIZED_PARTNER_NAME,
            )
            await session.commit()
            assert await labels.target_labels(session, targets) == {
                ("driver", driver.id): None,
                ("cash_remittance", remittance.id): None,
            }

    run(scenario)
