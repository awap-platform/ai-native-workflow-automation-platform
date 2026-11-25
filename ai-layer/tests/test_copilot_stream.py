"""Streaming contract tests for issue #374: schema, ordering, parity and failure handling."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.copilot.streaming import (
    STREAM_SCHEMA_VERSION,
    chunk_answer,
    encode_event,
    reduce_events,
    stream_events,
)
from app.main import app as fastapi_app

RESPONSE = {
    "answer": "The leave policy allows 20 days per year.",
    "action": "answer",
    "requires_human_approval": False,
    "model": "heuristic",
    "budget": {"remaining_tokens": 100},
    "tool_calls": [{"name": "search_knowledge", "arguments": {"q": "leave"}}],
    "citations": [{"document_id": "doc-1", "title": "Handbook"}],
}


def test_chunk_answer_is_lossless_and_deterministic():
    fragments = chunk_answer(RESPONSE["answer"], 8)
    assert "".join(fragments) == RESPONSE["answer"]
    assert fragments == chunk_answer(RESPONSE["answer"], 8)
    assert all(len(fragment) <= 8 for fragment in fragments)


@pytest.mark.parametrize("answer", ["", None])
def test_chunk_answer_handles_an_empty_answer(answer):
    assert chunk_answer(answer or "") == []


def test_encode_event_is_a_single_versioned_sse_frame():
    frame = encode_event({"type": "token", "seq": 1, "delta": "a\nb"})
    assert frame.startswith("data: ")
    assert frame.endswith("\n\n")
    assert "\n" not in frame[:-2].split("data: ", 1)[1]
    payload = json.loads(frame.removeprefix("data: ").strip())
    assert payload["v"] == STREAM_SCHEMA_VERSION


def test_stream_emits_deltas_then_metadata_then_done():
    text, final, kinds = reduce_events(stream_events(RESPONSE, delta_size=8))

    assert text == RESPONSE["answer"]
    assert kinds[0] == "token"
    assert kinds[-1] == "done"
    assert "tool" in kinds and "citation" in kinds and "usage" in kinds
    assert final is not None and final["type"] == "done"
    assert final["response"]["answer"] == RESPONSE["answer"]


def test_sequence_numbers_are_monotonic():
    frames = list(stream_events(RESPONSE, delta_size=16))
    sequences = [json.loads(frame.removeprefix("data: ").strip())["seq"] for frame in frames]
    assert sequences == sorted(sequences)
    assert sequences == list(range(1, len(frames) + 1))


def test_a_failing_source_closes_with_an_error_frame():
    def explode():
        yield "partial"
        raise RuntimeError("provider dropped the connection")

    text, final, kinds = reduce_events(stream_events(RESPONSE, deltas=explode()))

    assert text == "partial"
    assert kinds[-1] == "error"
    assert final is not None and "interrupted" in final["message"]


def test_deltas_containing_html_are_plain_text():
    payload = {"answer": "<script>alert(1)</script>", "tool_calls": [], "citations": []}
    frames = list(stream_events(payload, delta_size=4))
    text, _, _ = reduce_events(frames)

    assert text == "<script>alert(1)</script>"
    # The markup travels as a JSON string value, never as raw markup inside the frame.
    for frame in frames:
        body = frame.removeprefix("data: ").strip()
        assert json.loads(body)["v"] == STREAM_SCHEMA_VERSION


def test_the_stream_endpoint_matches_the_buffered_response():
    client = TestClient(fastapi_app)
    headers = {
        "X-Tenant-Id": "11111111-1111-1111-1111-111111111111",
        "X-User-Id": "22222222-2222-2222-2222-222222222222",
        "X-User-Role": "MANAGER",
    }
    body = {"message": "What is the leave policy?"}

    buffered = client.post("/api/v1/copilot/chat", json=body, headers=headers)
    assert buffered.status_code == 200

    with client.stream("POST", "/api/v1/copilot/chat/stream", json=body, headers=headers) as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        assert stream.headers.get("x-accel-buffering") == "no"
        frames = [line for line in stream.iter_lines() if line.startswith("data: ")]

    text, final, _ = reduce_events(frames)
    assert final is not None
    assert final["response"]["answer"] == buffered.json()["answer"]
    assert text == buffered.json()["answer"]


def test_the_stream_endpoint_requires_authentication():
    client = TestClient(fastapi_app)
    response = client.post("/api/v1/copilot/chat/stream", json={"message": "hi"})
    assert response.status_code == 401
