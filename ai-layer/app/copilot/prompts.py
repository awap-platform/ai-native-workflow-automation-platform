"""Versioned, source-controlled prompts.

Prompts are files under ``app/prompts`` so a change is reviewable in git and every response reports
the exact prompt version that produced it (C11).
"""

from __future__ import annotations

from pathlib import Path

from app.copilot.models import PromptDescriptor

PROMPT_VERSION = "v1"
PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"

PROMPTS: dict[str, str] = {
    "chat": "chat-v1.md",
    "workflow_discovery": "workflow-discovery-v1.md",
    "task_assistant": "task-assistant-v1.md",
    "approval_assistance": "approval-assistance-v1.md",
    "knowledge_search": "knowledge-search-v1.md",
}


def load_prompt(key: str) -> str:
    """Load a prompt by key; a missing prompt fails closed."""
    if key not in PROMPTS:
        raise KeyError(f"Unknown prompt key: {key}")
    return (PROMPT_DIR / PROMPTS[key]).read_text(encoding="utf-8")


def describe_prompts() -> list[PromptDescriptor]:
    return [
        PromptDescriptor(key=key, version=PROMPT_VERSION, path=f"app/prompts/{name}")
        for key, name in sorted(PROMPTS.items())
    ]


def prompt_for_action(action: str) -> str:
    if action in {"start_workflow", "discover_workflow"}:
        return load_prompt("workflow_discovery")
    if action in {"query_tasks", "complete_task"}:
        return load_prompt("task_assistant")
    if action == "approval_assistance":
        return load_prompt("approval_assistance")
    if action == "knowledge_search":
        return load_prompt("knowledge_search")
    return load_prompt("chat")
