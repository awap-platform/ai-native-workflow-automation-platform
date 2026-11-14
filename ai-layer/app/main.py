"""FastAPI application entry point for the AWAP AI Layer."""

from fastapi import FastAPI

from app.api.copilot import router as copilot_router
from app.api.health import router as health_router
from app.config import SERVICE_VERSION
from app.copilot.agent import build_default_agent
from app.observability import CorrelationIdMiddleware, configure_logging

configure_logging()

app = FastAPI(
    title="AWAP AI Layer",
    version=SERVICE_VERSION,
    description=(
        "Health/readiness contract plus the Phase 2 AI Copilot, permission-checked tool "
        "execution, HITL safeguards, model routing and tenant-scoped knowledge search."
    ),
    openapi_url="/api/v1/openapi.json",
)

app.state.copilot_agent = build_default_agent()
app.add_middleware(CorrelationIdMiddleware)
app.include_router(health_router, prefix="/api/v1")
app.include_router(copilot_router, prefix="/api/v1")
