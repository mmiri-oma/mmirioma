"""Aggregates every version 1 router under the ``/api/v1`` prefix.

Business modules add their routers here, e.g. ``api_router.include_router(orders.router)``.
"""

from fastapi import APIRouter

from app.api.v1 import health
from app.modules.audit import router as audit_log
from app.modules.auth import router as auth
from app.modules.customers import admin_directory_router as admin_customers
from app.modules.customers import admin_router as admin_support
from app.modules.customers import router as customers
from app.modules.deliveries import admin_router as admin_orders
from app.modules.deliveries import router as deliveries
from app.modules.dispatch import router as dispatch
from app.modules.notifications import admin_router as admin_notifications
from app.modules.notifications import router as notifications
from app.modules.orders import router as orders
from app.modules.partners import admin_directory_router as admin_drivers
from app.modules.partners import router as partners
from app.modules.payments import router as payments
from app.modules.pricing import router as pricing
from app.modules.public import router as public
from app.modules.reporting import router as reporting
from app.modules.sources import admin_router as admin_water_sources

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(orders.router)
api_router.include_router(deliveries.router)
api_router.include_router(dispatch.router)
api_router.include_router(admin_orders.router)
api_router.include_router(payments.router)
api_router.include_router(pricing.router)
api_router.include_router(partners.router)
api_router.include_router(admin_drivers.router)
api_router.include_router(notifications.router)
api_router.include_router(public.router)
api_router.include_router(customers.router)
# Admin operations (docs/api/admin-operations.md, #102).
api_router.include_router(reporting.router)
api_router.include_router(admin_support.router)
api_router.include_router(admin_customers.router)
api_router.include_router(audit_log.router)
api_router.include_router(admin_water_sources.router)
api_router.include_router(admin_notifications.router)
