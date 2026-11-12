"""Register every module's models with SQLAlchemy.

Foreign keys cross modules (``orders.source_id`` → ``water_sources``,
``order_events.assignment_id`` → ``assignments``), and SQLAlchemy resolves a
foreign key only if the table it points at was imported. The API imports
every model through its routers; command-line entry points do not, so they
import this module first. Otherwise their first write fails with
``NoReferencedTableError`` (LOG.md, 2026-10-20).

Keep this list in step with ``alembic/env.py``; ``tests/test_command_models.py``
fails when a module's models are missing here.
"""

from app.modules.audit import models as audit_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.customers import models as customer_models  # noqa: F401
from app.modules.deliveries import models as delivery_models  # noqa: F401
from app.modules.dispatch import models as dispatch_models  # noqa: F401
from app.modules.notifications import models as notification_models  # noqa: F401
from app.modules.orders import models as order_models  # noqa: F401
from app.modules.partners import models as partner_models  # noqa: F401
from app.modules.payments import models as payment_models  # noqa: F401
from app.modules.pricing import models as pricing_models  # noqa: F401
from app.modules.sources import models as source_models  # noqa: F401
