"""Correlation-ID contract tests for the AI layer (issue #191)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.observability import (
    CORRELATION_HEADER,
    TENANT_HEADER,
    TRACE_HEADER,
    JsonFormatter,
    correlation_id_var,
    current_correlation_id,
    resolve,
    tenant_id_var,
    trace_id_var,
)

client = TestClient(app)


def test_valid_correlation_id_is_echoed_unchanged() -> None:
    response = client.get("/api/v1/health", headers={CORRELATION_HEADER: "req-abc.123"})
    assert response.status_code == 200
    assert response.headers[CORRELATION_HEADER] == "req-abc.123"


def test_missing_correlation_id_is_generated_not_null() -> None:
    response = client.get("/api/v1/health")
    generated = response.headers[CORRELATION_HEADER]
    assert generated
    assert str(uuid.UUID(generated)) == generated


def test_unsafe_correlation_id_is_replaced() -> None:
    malicious = "x" * 200
    response = client.get("/api/v1/health", headers={CORRELATION_HEADER: malicious})
    replaced = response.headers[CORRELATION_HEADER]
    assert replaced != malicious
    assert len(replaced) <= 64


def test_resolve_rejects_control_characters_and_whitespace() -> None:
    for candidate in ["bad\nvalue", "has space", "", "a" * 65, "-starts-with-dash"]:
        resolved = resolve(candidate)
        assert resolved != candidate
        assert re.match(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$", resolved)


def test_health_body_is_unchanged_by_the_middleware() -> None:
    response = client.get("/api/v1/health", headers={CORRELATION_HEADER: "req-1"})
    body = response.json()
    assert set(body) == {"status", "service", "version", "build", "python"}


def test_context_variable_is_isolated_between_concurrent_tasks() -> None:
    async def run(value: str) -> str:
        token = correlation_id_var.set(value)
        try:
            await asyncio.sleep(0)
            return current_correlation_id()
        finally:
            correlation_id_var.reset(token)

    async def scenario() -> list[str]:
        return await asyncio.gather(run("first"), run("second"))

    assert asyncio.run(scenario()) == ["first", "second"]


def test_json_formatter_includes_the_correlation_id() -> None:
    token = correlation_id_var.set("req-log")
    tenant_token = tenant_id_var.set("tenant-log")
    trace_token = trace_id_var.set("trace-log")
    try:
        record = logging.LogRecord(
            name="awap.ai_layer",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="HTTP %s %s -> %s",
            args=("GET", "/api/v1/health", 200),
            exc_info=None,
        )
        payload = json.loads(JsonFormatter().format(record))
    finally:
        trace_id_var.reset(trace_token)
        tenant_id_var.reset(tenant_token)
        correlation_id_var.reset(token)
    assert payload["correlationId"] == "req-log"
    assert payload["tenantId"] == "tenant-log"
    assert payload["traceId"] == "trace-log"
    assert payload["service"] == "ai-layer"
    assert payload["message"] == "HTTP GET /api/v1/health -> 200"


def test_tenant_and_trace_headers_are_scoped_to_the_request() -> None:
    response = client.get(
        "/api/v1/health",
        headers={
            CORRELATION_HEADER: "req-scoped",
            TENANT_HEADER: "tenant-1",
            TRACE_HEADER: "trace-1",
        },
    )
    assert response.status_code == 200
    assert response.headers[CORRELATION_HEADER] == "req-scoped"
