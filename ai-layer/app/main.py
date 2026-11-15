"""FastAPI application entry point for the AWAP AI Layer."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.copilot import router as copilot_router
from app.api.health import router as health_router
from app.config import SERVICE_VERSION
from app.copilot.agent import build_default_agent
from app.grpc_server import build_server
from app.observability import CorrelationIdMiddleware, configure_logging

configure_logging()


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Start the gRPC transport when `AI_GRPC_PORT` is configured (issue #291)."""
    grpc_server = None
    port = os.getenv("AI_GRPC_PORT", "").strip()
    if port:
        grpc_server, _bound = build_server(
            application.state.copilot_agent,
            host=os.getenv("AI_GRPC_HOST", "0.0.0.0"),
            port=int(port),
            service_token=os.getenv("AI_LAYER_SERVICE_TOKEN") or None,
        )
        grpc_server.start()
    try:
        yield
    finally:
        if grpc_server is not None:
            grpc_server.stop(grace=0)


app = FastAPI(
    title="AWAP AI Layer",
    version=SERVICE_VERSION,
    description=(
        "Health/readiness contract plus the Phase 2 AI Copilot, permission-checked tool "
        "execution, HITL safeguards, model routing and tenant-scoped knowledge search."
    ),
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

app.state.copilot_agent = build_default_agent()
app.add_middleware(CorrelationIdMiddleware)
app.include_router(health_router, prefix="/api/v1")
app.include_router(copilot_router, prefix="/api/v1")
