"""Fail-closed prompt and output guardrails for the Copilot (C1/C2/C11)."""

from __future__ import annotations

import re
from dataclasses import dataclass

MAX_INPUT_CHARS = 8_000
MAX_OUTPUT_CHARS = 16_000

INPUT_BLOCKED_MARKERS = (
    "[inst]",
    "<<sys>>",
    "<|",
    "ignore previous instructions",
    "ignore all previous",
    "disregard previous instructions",
    "system prompt",
    "reveal your instructions",
    "you are now",
    "jailbreak",
    "developer mode",
    "assistant:",
    "tool_call:",
)

OUTPUT_BLOCKED_MARKERS = (
    "system prompt",
    "my instructions are",
    "here is my prompt",
    "jailbreak successful",
    "developer mode enabled",
)

# Prompt-injection attempts often use zero-width characters to split marker words.
_ZERO_WIDTH = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff]")
_WHITESPACE = re.compile(r"\s+")


class GuardrailViolation(ValueError):
    """Raised when input or output must not reach a model/tool."""


@dataclass(frozen=True)
class GuardrailResult:
    text: str
    sanitized: bool


def sanitize_input(text: str) -> GuardrailResult:
    """Normalize and reject prompt-injection markers before any model/tool call."""
    if text is None or not text.strip():
        raise GuardrailViolation("Copilot input must not be empty.")
    normalized = _WHITESPACE.sub(" ", _ZERO_WIDTH.sub("", text).replace("\x00", " ")).strip()
    if len(normalized) > MAX_INPUT_CHARS:
        raise GuardrailViolation(f"Copilot input exceeds {MAX_INPUT_CHARS} characters.")
    lowered = normalized.lower()
    for marker in INPUT_BLOCKED_MARKERS:
        if marker in lowered:
            raise GuardrailViolation(f"Prompt-injection marker detected: {marker}")
    return GuardrailResult(normalized, normalized != text)


def sanitize_output(text: str) -> str:
    """Reject completions that leak system instructions or are unbounded."""
    if text is None or not text.strip():
        raise GuardrailViolation("Copilot produced an empty answer.")
    normalized = text.strip()
    if len(normalized) > MAX_OUTPUT_CHARS:
        raise GuardrailViolation(f"Copilot output exceeds {MAX_OUTPUT_CHARS} characters.")
    lowered = normalized.lower()
    for marker in OUTPUT_BLOCKED_MARKERS:
        if marker in lowered:
            raise GuardrailViolation("Copilot output blocked by the guardrails layer.")
    return normalized


def estimate_confidence(text: str, action: str) -> float:
    """Deterministic, explainable confidence used for the HITL threshold."""
    normalized = (text or "").lower()
    confidence = 0.86
    for hedge in ("maybe", "unclear", "not sure", "possibly", "i think", "cannot determine"):
        if hedge in normalized:
            confidence -= 0.25
    if len(normalized) < 12:
        confidence -= 0.2
    if action in {"start_workflow", "complete_task", "approval_assistance"}:
        confidence -= 0.05
    return max(0.0, min(1.0, confidence))
