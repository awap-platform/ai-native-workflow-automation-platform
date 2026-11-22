"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { validateWorkflowExpression, type ExpressionValidationDto } from "../../lib/api";
import {
  CONDITION_OPERATORS,
  MAX_CONDITION_LENGTH,
  applySuggestion,
  autocompleteSuggestions,
  buildCondition,
  validateExpression,
  type ConditionOperator,
  type ExpressionSuggestion,
} from "../../lib/workflowExpressions";
import { conditionOf, type WorkflowEdge } from "../../lib/workflowGraph";

type ValidationStatus = "validating" | "done" | "error";

interface ServerValidationState {
  expression: string;
  status: ValidationStatus;
  result: ExpressionValidationDto | null;
}

interface EdgeConditionEditorProps {
  edge: WorkflowEdge;
  variables: readonly string[];
  onChangeCondition: (condition: string) => void;
  onClose: () => void;
  onDuplicate: () => void;
}

/**
 * Edge inspector with a plain-text condition editor, an expression builder, autocomplete and
 * inline validation. The backend dry-run is authoritative; the client mirror exists for instant
 * feedback and to block saving obviously invalid graphs.
 */
export default function EdgeConditionEditor({
  edge,
  variables,
  onChangeCondition,
  onClose,
  onDuplicate,
}: EdgeConditionEditorProps) {
  const condition = conditionOf(edge);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [variable, setVariable] = useState(variables[0] ?? "amount");
  const [operator, setOperator] = useState<ConditionOperator>("==");
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(condition.length);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [serverState, setServerState] = useState<ServerValidationState | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const clientValidation = validateExpression(condition);
  const clientError = clientValidation.errors[0]?.message ?? null;
  const currentState = serverState?.expression === condition ? serverState : null;
  const status = currentState?.status ?? null;
  const serverResult = currentState?.result ?? null;
  const serverError =
    serverResult !== null && !serverResult.valid
      ? (serverResult.errors[0]?.message ?? "Expression is invalid.")
      : null;
  const error = clientError ?? serverError;
  const suggestions = suggestionsOpen ? autocompleteSuggestions(condition, caret, variables) : [];
  const showSuggestions = suggestionsOpen && suggestions.length > 0;

  useEffect(() => {
    if (condition.trim() === "" || clientError !== null) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) {
        return;
      }
      setServerState({ expression: condition, status: "validating", result: null });
      validateWorkflowExpression(condition)
        .then((result) => {
          if (!cancelled) {
            setServerState({ expression: condition, status: "done", result });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setServerState({ expression: condition, status: "error", result: null });
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [condition, clientError, retryToken]);

  const updateCondition = (next: string, nextCaret: number) => {
    onChangeCondition(next);
    setCaret(nextCaret);
    setActiveIndex(0);
    const prefix = next.slice(0, nextCaret);
    setSuggestionsOpen(prefix.endsWith("#") || /#fn\.[A-Za-z0-9_]*$/.test(prefix));
  };

  const applySuggestionToText = (suggestion: ExpressionSuggestion) => {
    const result = applySuggestion(condition, caret, suggestion);
    updateCondition(result.text, result.caret);
    setSuggestionsOpen(false);
    setTimeout(() => {
      const element = textareaRef.current;
      if (element) {
        element.focus();
        element.setSelectionRange(result.caret, result.caret);
      }
    }, 0);
  };

  const insertBuiltCondition = () => {
    const built = buildCondition(variable, operator, value);
    const element = textareaRef.current;
    const start = element?.selectionStart ?? condition.length;
    const end = element?.selectionEnd ?? condition.length;
    const needsSpace = start > 0 && !/\s$/.test(condition.slice(0, start));
    const insertion = `${needsSpace ? " " : ""}${built}`;
    const next = `${condition.slice(0, start)}${insertion}${condition.slice(end)}`;
    updateCondition(next, start + insertion.length);
    setSuggestionsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSuggestionsOpen(false);
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showSuggestions) {
        setSuggestionsOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && showSuggestions) {
      const suggestion = suggestions[activeIndex];
      if (suggestion) {
        event.preventDefault();
        applySuggestionToText(suggestion);
      }
    }
  };

  return (
    <aside
      aria-labelledby="edge-condition-heading"
      className="awap-designer__panel awap-edge-editor"
    >
      <h2 id="edge-condition-heading" className="awap-edge-editor__heading">
        Edge condition
      </h2>
      <p className="awap-edge-editor__meta">
        From {edge.source} to {edge.target}
      </p>

      <label htmlFor="edge-condition">Condition expression</label>
      <textarea
        id="edge-condition"
        ref={textareaRef}
        role="combobox"
        aria-expanded={showSuggestions}
        aria-controls="condition-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={showSuggestions ? `condition-suggestion-${activeIndex}` : undefined}
        aria-describedby={
          error === null ? "edge-condition-help" : "edge-condition-help edge-condition-error"
        }
        aria-invalid={error === null ? undefined : true}
        value={condition}
        rows={4}
        placeholder="#amount > 100"
        onChange={(event) => {
          const next = event.target.value;
          updateCondition(next, event.target.selectionStart);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        onBlur={() => setSuggestionsOpen(false)}
        className="awap-textarea awap-edge-editor__textarea"
      />
      <div className="awap-edge-editor__meta-row">
        <span id="edge-condition-help">
          Empty means unconditional. Type # for variables or #fn. for functions.
        </span>
        <span aria-live="polite">
          {condition.length}/{MAX_CONDITION_LENGTH}
        </span>
      </div>

      <div className="awap-edge-editor__actions">
        <button
          type="button"
          className="awap-button"
          onClick={() => {
            setSuggestionsOpen(true);
            setActiveIndex(0);
          }}
          aria-label="Show condition suggestions"
        >
          Suggestions
        </button>
      </div>

      {showSuggestions ? (
        <ul
          id="condition-suggestions"
          role="listbox"
          aria-label="Condition suggestions"
          className="awap-edge-editor__suggestions"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.kind}-${suggestion.label}`} role="presentation">
              <button
                type="button"
                id={`condition-suggestion-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                data-active={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySuggestionToText(suggestion)}
                className="awap-edge-editor__suggestion"
              >
                <span className="awap-edge-editor__mono">{suggestion.label}</span>{" "}
                <span className="awap-edge-editor__suggestion-description">
                  {suggestion.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {clientError !== null ? (
        <p id="edge-condition-error" role="alert" className="awap-edge-editor__error">
          {clientError}
        </p>
      ) : null}

      {status === "validating" ? (
        <p role="status" className="awap-edge-editor__muted">
          Checking expression…
        </p>
      ) : null}
      {status === "done" && serverResult?.valid && condition.trim() !== "" ? (
        <p role="status" className="awap-edge-editor__success">
          Expression is valid.
        </p>
      ) : null}
      {status === "done" && serverError !== null ? (
        <p role="alert" className="awap-edge-editor__error">
          {serverError}
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert">
          Validation failed. Check your connection and retry.{" "}
          <button type="button" onClick={() => setRetryToken((token) => token + 1)}>
            Retry validation
          </button>
        </p>
      ) : null}

      <fieldset className="awap-edge-editor__fieldset">
        <legend className="awap-edge-editor__legend">Expression builder</legend>
        <label htmlFor="condition-variable">Variable</label>
        <select
          id="condition-variable"
          value={variable}
          onChange={(event) => setVariable(event.target.value)}
          className="awap-select awap-edge-editor__control"
        >
          {variables.map((name) => (
            <option key={name} value={name}>
              #{name}
            </option>
          ))}
        </select>

        <label htmlFor="condition-operator">Operator</label>
        <select
          id="condition-operator"
          value={operator}
          onChange={(event) => setOperator(event.target.value as ConditionOperator)}
          className="awap-select awap-edge-editor__control"
        >
          {CONDITION_OPERATORS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>

        <label htmlFor="condition-value">Value</label>
        <input
          id="condition-value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="awap-input awap-edge-editor__control"
        />

        <button
          type="button"
          onClick={insertBuiltCondition}
          className="awap-button awap-edge-editor__insert"
        >
          Insert condition
        </button>
      </fieldset>

      <div className="awap-edge-editor__actions">
        <button
          type="button"
          onClick={onDuplicate}
          aria-label="Duplicate conditional edge"
          className="awap-button"
        >
          Duplicate edge
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close edge inspector"
          className="awap-button"
        >
          Close
        </button>
      </div>
    </aside>
  );
}
