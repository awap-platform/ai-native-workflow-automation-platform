"""Provider-neutral semantic guardrails (issue #299).

The legacy regex/marker guardrails in :mod:`app.copilot.guardrails` catch known strings. This layer
adds semantic policy decisions before and after every LLM call, with a deterministic heuristic
classifier by default and an optional NeMo Guardrails adapter. Every decision carries the policy,
outcome, score and policy version so it can be audited.

The layer fails closed for high-risk actions when the classifier is unavailable. A NeMo deployment
that cannot be reached therefore blocks workflow starts, task decisions, assignments, notifications
and approvals instead of silently proceeding unchecked.
"""

from __future__ import annotations

import base64
import os
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

GUARDRAIL_POLICY_VERSION = "v1"
ZERO_WIDTH = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff]")
WHITESPACE = re.compile(r"\s+")
BASE64_TOKEN = re.compile(r"[A-Za-z0-9+/]{16,}={0,2}")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b")
PHONE = re.compile(r"\b(?:\+?\d[\d\s().-]{7,}\d)\b")
CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")


class GuardrailPolicy(StrEnum):
    PROMPT_INJECTION = "prompt_injection"
    JAILBREAK = "jailbreak"
    SYSTEM_PROMPT_LEAKAGE = "system_prompt_leakage"
    HARMFUL_CONTENT = "harmful_content"
    PII = "pii"
    TOOL_MISUSE = "tool_misuse"


class GuardrailDecision(StrEnum):
    ALLOW = "allow"
    REDACT = "redact"
    BLOCK = "block"


class GuardrailUnavailable(RuntimeError):
    """The configured semantic classifier cannot be reached or is not installed."""


@dataclass(frozen=True)
class GuardrailAssessment:
    policy: GuardrailPolicy
    decision: GuardrailDecision
    score: float
    reason: str


@dataclass(frozen=True)
class GuardrailReport:
    version: str
    decisions: list[GuardrailAssessment] = field(default_factory=list)
    unavailable: bool = False
    redacted_text: str | None = None

    @property
    def blocked(self) -> bool:
        return any(item.decision == GuardrailDecision.BLOCK for item in self.decisions)

    @property
    def redacted(self) -> bool:
        return any(item.decision == GuardrailDecision.REDACT for item in self.decisions)

    @property
    def top(self) -> GuardrailAssessment | None:
        if not self.decisions:
            return None
        return max(self.decisions, key=lambda item: item.score)

    def audit_fields(self) -> dict[str, Any]:
        top = self.top
        return {
            "guardrailVersion": self.version,
            "guardrailPolicy": top.policy.value if top else None,
            "guardrailDecision": top.decision.value if top else GuardrailDecision.ALLOW.value,
            "guardrailScore": round(top.score, 4) if top else 0.0,
            "guardrailUnavailable": self.unavailable,
        }


class SemanticClassifier(Protocol):
    """Provider-neutral classifier contract."""

    def score(self, text: str, policy: GuardrailPolicy) -> float: ...


def normalize(text: str) -> str:
    """NFKC-normalize, strip zero-width characters and decode common base64 payloads."""
    candidate = unicodedata.normalize("NFKC", text or "")
    candidate = ZERO_WIDTH.sub("", candidate)
    decoded: list[str] = []
    for token in BASE64_TOKEN.findall(candidate):
        try:
            raw = base64.b64decode(token + "=" * (-len(token) % 4), validate=True)
            value = raw.decode("utf-8", errors="ignore")
        except Exception:
            continue
        if len(value) >= 4 and value.isprintable():
            decoded.append(value)
    candidate = WHITESPACE.sub(" ", candidate)
    if decoded:
        candidate = candidate + " " + " ".join(decoded)
    return candidate.strip().lower()


class HeuristicSemanticClassifier:
    """Deterministic semantic classifier used when no external classifier is configured.

    It combines phrase families with token co-occurrence so paraphrases that avoid an exact marker
    still score highly, and it normalizes Unicode/base64 before matching.
    """

    _FAMILIES: dict[GuardrailPolicy, tuple[tuple[str, ...], float]] = {
        GuardrailPolicy.PROMPT_INJECTION: (
            (
                "ignore previous",
                "ignore all previous",
                "disregard previous",
                "forget previous",
                "override the instructions",
                "new instructions",
                "set aside the earlier",
                "instructions do not apply",
                "follow my instructions instead",
                "system prompt",
                "reveal your instructions",
            ),
            0.95,
        ),
        GuardrailPolicy.JAILBREAK: (
            (
                "jailbreak",
                "developer mode",
                "do anything now",
                "dan mode",
                "no restrictions",
                "bypass safety",
                "unfiltered",
                "pretend you have no rules",
                "act as an uncensored",
            ),
            0.95,
        ),
        GuardrailPolicy.SYSTEM_PROMPT_LEAKAGE: (
            (
                "system prompt",
                "show your prompt",
                "print your instructions",
                "reveal your instructions",
                "what are your instructions",
                "hidden instructions",
            ),
            0.9,
        ),
        GuardrailPolicy.HARMFUL_CONTENT: (
            (
                "how to build a bomb",
                "make a bomb",
                "kill someone",
                "hurt people",
                "self harm",
                "suicide method",
                "hate speech",
                "exploit a vulnerability",
                "steal credentials",
            ),
            0.92,
        ),
        GuardrailPolicy.TOOL_MISUSE: (
            (
                "bypass permission",
                "without permission",
                "without approval",
                "without confirmation",
                "send to everyone",
                "send to all users",
                "all users",
                "delete all",
                "escalate privileges",
                "assign to everyone",
            ),
            0.9,
        ),
    }

    _INJECTION_VERBS = ("ignore", "disregard", "forget", "override", "set aside", "bypass")
    _INJECTION_OBJECTS = ("instruction", "rule", "prompt", "guideline", "directive")

    def score(self, text: str, policy: GuardrailPolicy) -> float:
        normalized = normalize(text)
        if not normalized:
            return 0.0
        best = 0.0
        family = self._FAMILIES.get(policy)
        if family is not None:
            phrases, weight = family
            for phrase in phrases:
                if phrase in normalized:
                    best = max(best, weight)
        if policy == GuardrailPolicy.PROMPT_INJECTION:
            if any(verb in normalized for verb in self._INJECTION_VERBS) and any(
                obj in normalized for obj in self._INJECTION_OBJECTS
            ):
                best = max(best, 0.85)
        if policy == GuardrailPolicy.PII:
            best = max(best, self._pii_score(text))
        return min(1.0, best)

    @staticmethod
    def _pii_score(text: str) -> float:
        if EMAIL.search(text):
            return 0.9
        if IBAN.search(text):
            return 0.95
        if CARD.search(text):
            digits = re.sub(r"\D", "", text)
            if len(digits) >= 13:
                return 0.9
        if PHONE.search(text):
            return 0.75
        return 0.0


class NemoGuardrailsClassifier:
    """Optional adapter for a NeMo Guardrails HTTP server.

    The adapter is provider-neutral: it only needs ``NEMO_GUARDRAILS_URL`` and the documented JSON
    contract. When the package or endpoint is unavailable it raises :class:`GuardrailUnavailable`,
    which the layer converts to a fail-closed decision for high-risk actions.
    """

    def __init__(self, endpoint: str | None = None, timeout_seconds: float = 2.0) -> None:
        self.endpoint = (endpoint or os.getenv("NEMO_GUARDRAILS_URL", "")).rstrip("/")
        self.timeout_seconds = timeout_seconds
        if not self.endpoint:
            raise GuardrailUnavailable("NEMO_GUARDRAILS_URL is not configured.")

    def score(self, text: str, policy: GuardrailPolicy) -> float:
        try:
            import httpx
        except Exception as ex:  # pragma: no cover - httpx is a runtime dependency
            raise GuardrailUnavailable("httpx is unavailable.") from ex
        try:
            response = httpx.post(
                f"{self.endpoint}/v1/guardrails/check",
                json={"text": text, "policy": policy.value},
                timeout=self.timeout_seconds,
            )
            if response.status_code >= 400:
                raise GuardrailUnavailable(
                    f"NeMo Guardrails returned status {response.status_code}."
                )
            body = response.json()
            return float(body.get("score", 0.0))
        except GuardrailUnavailable:
            raise
        except Exception as ex:
            raise GuardrailUnavailable(f"NeMo Guardrails call failed: {ex}") from ex


def build_classifier(provider: str | None = None) -> SemanticClassifier:
    selected = (provider or os.getenv("AI_GUARDRAIL_PROVIDER", "heuristic")).lower()
    if selected == "nemo":
        return NemoGuardrailsClassifier()
    return HeuristicSemanticClassifier()


class SemanticGuardrailLayer:
    """Runs input/output/tool-intent policies with configurable thresholds and fail-closed mode."""

    def __init__(
        self,
        classifier: SemanticClassifier | None = None,
        thresholds: dict[GuardrailPolicy, float] | None = None,
        fail_closed: bool | None = None,
        version: str = GUARDRAIL_POLICY_VERSION,
    ) -> None:
        self.classifier = classifier or build_classifier()
        self.thresholds = thresholds or {
            policy: float(os.getenv(f"AI_GUARDRAIL_THRESHOLD_{policy.value.upper()}", "0.6"))
            for policy in GuardrailPolicy
        }
        self.fail_closed = (
            bool(os.getenv("AI_GUARDRAIL_FAIL_CLOSED", "true").lower() != "false")
            if fail_closed is None
            else fail_closed
        )
        self.version = version

    def screen_input(self, text: str, action: str, high_risk: bool) -> GuardrailReport:
        return self._screen(
            text,
            (
                GuardrailPolicy.PROMPT_INJECTION,
                GuardrailPolicy.JAILBREAK,
                GuardrailPolicy.SYSTEM_PROMPT_LEAKAGE,
                GuardrailPolicy.HARMFUL_CONTENT,
                GuardrailPolicy.PII,
            ),
            high_risk,
        )

    def screen_output(self, text: str, action: str, high_risk: bool) -> GuardrailReport:
        return self._screen(
            text,
            (
                GuardrailPolicy.SYSTEM_PROMPT_LEAKAGE,
                GuardrailPolicy.HARMFUL_CONTENT,
                GuardrailPolicy.PII,
            ),
            high_risk,
        )

    def screen_tool_intent(self, text: str, tool_name: str, high_risk: bool) -> GuardrailReport:
        report = self._screen(text, (GuardrailPolicy.TOOL_MISUSE,), high_risk)
        if report.blocked:
            return GuardrailReport(
                version=report.version,
                decisions=report.decisions,
                unavailable=report.unavailable,
                redacted_text=None,
            )
        return report

    def _screen(
        self,
        text: str,
        policies: Iterable[GuardrailPolicy],
        high_risk: bool,
    ) -> GuardrailReport:
        decisions: list[GuardrailAssessment] = []
        redacted_text = text
        unavailable = False
        for policy in policies:
            try:
                score = self.classifier.score(text, policy)
            except GuardrailUnavailable as ex:
                unavailable = True
                if high_risk and self.fail_closed:
                    return GuardrailReport(
                        version=self.version,
                        decisions=[
                            GuardrailAssessment(
                                policy=policy,
                                decision=GuardrailDecision.BLOCK,
                                score=1.0,
                                reason=f"guardrail unavailable: {ex}",
                            )
                        ],
                        unavailable=True,
                        redacted_text=None,
                    )
                continue
            threshold = self.thresholds.get(policy, 0.6)
            if policy == GuardrailPolicy.PII:
                if score >= threshold:
                    redacted_text = redact_pii(redacted_text)
                    decisions.append(
                        GuardrailAssessment(
                            policy=policy,
                            decision=GuardrailDecision.REDACT,
                            score=score,
                            reason="PII detected and redacted",
                        )
                    )
                continue
            if score < threshold:
                continue
            decisions.append(
                GuardrailAssessment(
                    policy=policy,
                    decision=GuardrailDecision.BLOCK,
                    score=score,
                    reason=f"policy {policy.value} exceeded threshold {threshold}",
                )
            )
        return GuardrailReport(
            version=self.version,
            decisions=decisions,
            unavailable=unavailable,
            redacted_text=redacted_text,
        )


def redact_pii(text: str) -> str:
    redacted = EMAIL.sub("[EMAIL_REDACTED]", text)
    redacted = IBAN.sub("[IBAN_REDACTED]", redacted)
    redacted = CARD.sub("[CARD_REDACTED]", redacted)
    return PHONE.sub("[PHONE_REDACTED]", redacted)
