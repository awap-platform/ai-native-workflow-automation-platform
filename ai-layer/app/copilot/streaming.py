"""Versioned server-sent-event contract for streamed Copilot answers (issue #374).

The contract is deliberately small and versioned. Every frame is one `data:` line with a JSON
object carrying `v` (schema version), `type`, `seq` (monotonic within the stream) and a payload:

| type | payload | meaning |
| --- | --- | --- |
| `token` | `delta` | the next text fragment to append |
| `tool` | `call` | one tool call the agent made |
| `citation` | `citation` | one retrieved document reference |
| `usage` | `model`, `budget` | what the turn consumed |
| `done` | `response` | the complete buffered answer, authoritative for persistence |
| `error` | `message` | the stream failed; the client must not treat partial text as success |

A client that only understands buffered JSON can ignore every frame except `done`. The `done`
payload is byte-identical to the buffered `/chat` response, which is what keeps the audit trail and
the answer itself in parity between the streaming and the fallback path.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any

STREAM_SCHEMA_VERSION = 1
DEFAULT_DELTA_CHARS = 48
MAX_DELTA_CHARS = 512

TOKEN = "token"
TOOL = "tool"
CITATION = "citation"
USAGE = "usage"
DONE = "done"
ERROR = "error"


def chunk_answer(answer: str, size: int = DEFAULT_DELTA_CHARS) -> list[str]:
    """Splits the answer into deterministic fragments without losing or duplicating a character."""
    if not answer:
        return []
    width = min(MAX_DELTA_CHARS, max(1, size))
    return [answer[index : index + width] for index in range(0, len(answer), width)]


def encode_event(event: dict[str, Any]) -> str:
    """Formats one SSE frame.

    The JSON never contains a raw newline, so a frame always stays single-line.
    """
    payload = dict(event)
    payload.setdefault("v", STREAM_SCHEMA_VERSION)
    return f"data: {json.dumps(payload, separators=(',', ':'), ensure_ascii=False)}\n\n"


def stream_events(
    response: dict[str, Any],
    deltas: Iterable[str] | None = None,
    delta_size: int = DEFAULT_DELTA_CHARS,
) -> Iterator[str]:
    """Yields the whole stream for one answer: deltas, metadata, then the authoritative `done`."""
    seq = 0
    fragments: Iterable[str] = (
        deltas
        if deltas is not None
        else chunk_answer(str(response.get("answer") or ""), delta_size)
    )
    try:
        for fragment in fragments:
            seq += 1
            yield encode_event({"type": TOKEN, "seq": seq, "delta": fragment})
    except Exception:  # noqa: BLE001 - a stream must close with a structured error frame
        seq += 1
        yield encode_event(
            {
                "type": ERROR,
                "seq": seq,
                "message": "The answer stream was interrupted; retry the turn.",
            }
        )
        return

    for call in response.get("tool_calls") or []:
        seq += 1
        yield encode_event({"type": TOOL, "seq": seq, "call": call})
    for citation in response.get("citations") or []:
        seq += 1
        yield encode_event({"type": CITATION, "seq": seq, "citation": citation})
    seq += 1
    yield encode_event(
        {
            "type": USAGE,
            "seq": seq,
            "model": response.get("model"),
            "budget": response.get("budget"),
        }
    )
    seq += 1
    yield encode_event({"type": DONE, "seq": seq, "response": response})


def reduce_events(frames: Iterable[str]) -> tuple[str, dict[str, Any] | None, list[str]]:
    """Replays a stream the way a client would.

    Returns the concatenated text, the `done` payload (or the `error` frame) and the ordered list of
    event types, which is what the ordering tests assert on.
    """
    text: list[str] = []
    final: dict[str, Any] | None = None
    kinds: list[str] = []
    for frame in frames:
        body = frame.removeprefix("data: ").strip()
        if not body:
            continue
        event = json.loads(body)
        kinds.append(str(event.get("type")))
        if event.get("type") == TOKEN:
            text.append(str(event.get("delta") or ""))
        if event.get("type") in (DONE, ERROR):
            final = event
    return "".join(text), final, kinds
