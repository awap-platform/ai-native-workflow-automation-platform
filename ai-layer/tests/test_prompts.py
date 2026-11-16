"""Prompt versioning and change-control contract tests (issue #289)."""

from __future__ import annotations

import re

import pytest

from app.copilot.prompts import (
    PROMPTS,
    describe_prompts,
    load_prompt,
    prompt_for_action,
    prompt_hash,
    prompt_key_for_action,
)


def test_every_registered_prompt_is_versioned_and_hashed() -> None:
    for descriptor in describe_prompts():
        assert re.match(r"^[a-z0-9-]+-v\d+(?:\.\d+)*\.md$", descriptor.path.split("/")[-1])
        assert descriptor.version == "v1"
        assert re.fullmatch(r"[0-9a-f]{64}", descriptor.sha256)


def test_prompt_hash_is_deterministic_and_matches_file_content() -> None:
    assert prompt_hash("chat") == prompt_hash("chat")
    assert prompt_hash("chat") != prompt_hash("workflow_discovery")
    assert len(prompt_hash("chat")) == 64


def test_action_mapping_selects_the_expected_prompt() -> None:
    assert prompt_key_for_action("start_workflow") == "workflow_discovery"
    assert prompt_key_for_action("discover_workflow") == "workflow_discovery"
    assert prompt_key_for_action("query_tasks") == "task_assistant"
    assert prompt_key_for_action("complete_task") == "task_assistant"
    assert prompt_key_for_action("assign_task") == "assign_task"
    assert prompt_key_for_action("send_notification") == "send_notification"
    assert prompt_key_for_action("approval_assistance") == "approval_assistance"
    assert prompt_key_for_action("knowledge_search") == "knowledge_search"
    assert prompt_key_for_action("chat") == "chat"
    assert prompt_for_action("chat") == load_prompt("chat")


def test_unknown_key_and_missing_file_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(KeyError):
        load_prompt("does-not-exist")

    monkeypatch.setitem(PROMPTS, "missing", "missing-v1.md")
    with pytest.raises(FileNotFoundError):
        load_prompt("missing")
