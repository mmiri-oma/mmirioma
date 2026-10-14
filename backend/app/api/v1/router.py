"""Aggregates every version 1 router under the ``/api/v1`` prefix.

Business modules add their routers here, e.g. ``api_router.include_router(orders.router)``.
"""

from fastapi import APIRouter

from app.api.v1 import health
from app.modules.auth import router as auth

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
