"""Versioned, source-controlled prompts.

Prompts are files under ``app/prompts`` so a change is reviewable in git and every response reports
the exact prompt key, version and SHA-256 hash that produced it (C11, issue #289). Existing version
files are immutable: a prompt change creates a new file and the CI guard rejects edits/deletions of
an existing version.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from app.copilot.models import PromptDescriptor

PROMPT_VERSION = "v1"
PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"

PROMPTS: dict[str, str] = {
    "chat": "chat-v1.md",
    "workflow_discovery": "workflow-discovery-v1.md",
    "task_assistant": "task-assistant-v1.md",
    "assign_task": "assign-task-v1.md",
    "send_notification": "send-notification-v1.md",
    "approval_assistance": "approval-assistance-v1.md",
    "knowledge_search": "knowledge-search-v1.md",
}


def load_prompt(key: str) -> str:
    """Load a prompt by key; an unknown key or missing file fails closed."""
    if key not in PROMPTS:
        raise KeyError(f"Unknown prompt key: {key}")
    path = PROMPT_DIR / PROMPTS[key]
    if not path.is_file():
        raise FileNotFoundError(f"Prompt file is missing: {PROMPTS[key]}")
    return path.read_text(encoding="utf-8")


def prompt_hash(key: str) -> str:
    """SHA-256 of the immutable prompt version currently registered for the key."""
    return hashlib.sha256(load_prompt(key).encode("utf-8")).hexdigest()


def prompt_key_for_action(action: str) -> str:
    if action in {"start_workflow", "discover_workflow"}:
        return "workflow_discovery"
    if action in {"query_tasks", "complete_task"}:
        return "task_assistant"
    if action == "assign_task":
        return "assign_task"
    if action == "send_notification":
        return "send_notification"
    if action == "approval_assistance":
        return "approval_assistance"
    if action == "knowledge_search":
        return "knowledge_search"
    return "chat"


def describe_prompts() -> list[PromptDescriptor]:
    return [
        PromptDescriptor(
            key=key,
            version=PROMPT_VERSION,
            path=f"app/prompts/{name}",
            sha256=hashlib.sha256((PROMPT_DIR / name).read_bytes()).hexdigest(),
        )
        for key, name in sorted(PROMPTS.items())
    ]


def prompt_for_action(action: str) -> str:
    return load_prompt(prompt_key_for_action(action))
