"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { errorStatus, correlationIdOf } from "../../lib/api";
import { useStartWorkflow } from "../../lib/hooks/resources";
import {
  CONTEXT_MAX_LENGTH,
  newIdempotencyKey,
  parseContextJson,
} from "../../lib/workflows/catalogue";
import { Button } from "../ui/button";
import { FormField, Textarea } from "../ui/form-controls";

/**
 * Start dialog with a live preview (risk R4-01).
 *
 * The context is validated and summarised before the request, a fresh idempotency key is generated
 * for the attempt, and an unpublished definition is explained with a Designer call to action
 * instead of a raw 400. The confirmation is the dialog itself: the row action opens it, the preview
 * shows exactly what will be sent, and Start is the only mutating control.
 */
export default function StartWorkflowDialog({
  workflowId,
  workflowName,
  published = true,
  onClose,
}: {
  workflowId: string;
  workflowName?: string;
  published?: boolean;
  onClose: () => void;
}) {
  const [contextJson, setContextJson] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const submitting = useRef(false);
  const start = useStartWorkflow();

  const parsed = useMemo(() => parseContextJson(contextJson), [contextJson]);
  const summary = useMemo(() => {
    if (!parsed.ok || parsed.value === undefined) {
      return "";
    }
    const record = parsed.value as Record<string, unknown>;
    const keys = Object.keys(record);
    return keys.length === 0 ? "No context fields" : `Fields: ${keys.join(", ")}`;
  }, [parsed]);

  function submit() {
    if (submitting.current || start.isPending || !parsed.ok) {
      return;
    }
    if (!published) {
      setError("unpublished");
      return;
    }
    submitting.current = true;
    setError(null);
    start.mutate(
      { workflowDefinitionId: workflowId, contextJson, idempotencyKey },
      {
        onSuccess: () => {
          submitting.current = false;
          onClose();
        },
        onError: (failure) => {
          submitting.current = false;
          const status = errorStatus(failure);
          if (status === 400 || status === 422) {
            setError("unpublished");
          } else if (status === 409) {
            setError("conflict");
          } else if (status === 403) {
            setError("forbidden");
          } else {
            const correlation = correlationIdOf(failure);
            setError(correlation ? `failed:${correlation}` : "failed");
          }
        },
      },
    );
  }

  return (
    <section className="awap-card grid gap-3" aria-labelledby="start-workflow-heading">
      <h2 id="start-workflow-heading" className="awap-section-title">
        Start workflow
      </h2>
      {workflowName ? <p className="text-sm awap-muted">{workflowName}</p> : null}

      <FormField
        id="workflow-context"
        label="Workflow context JSON"
        hint={`${contextJson.length} / ${CONTEXT_MAX_LENGTH} characters`}
        {...(parsed.ok ? {} : { error: `Invalid context: ${parsed.error}` })}
      >
        <Textarea
          id="workflow-context"
          value={contextJson}
          maxLength={CONTEXT_MAX_LENGTH}
          onChange={(event) => setContextJson(event.target.value)}
          data-testid="start-context"
        />
      </FormField>

      <div className="awap-alert text-sm" aria-live="polite" data-testid="start-preview">
        <p className="font-semibold">Preview</p>
        <p>{summary}</p>
        <p className="awap-muted">Idempotency key: {idempotencyKey}</p>
      </div>

      {error ? (
        <div className="awap-alert awap-alert-danger" role="alert" data-testid="start-error">
          {error === "unpublished" ? (
            <>
              <p>This workflow is not published yet.</p>
              <Link href="/workflows/designer" className="awap-link-button">
                Open the Designer to publish it
              </Link>
            </>
          ) : error === "conflict" ? (
            <p>
              An instance already exists for this idempotency key with different context. Regenerate
              the key or reuse the original context.
            </p>
          ) : error === "forbidden" ? (
            <p>You do not have permission to start workflows in this tenant.</p>
          ) : (
            <p>
              Start failed{error.startsWith("failed:") ? ` (reference ${error.slice(7)})` : ""}.
              Try again.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={!parsed.ok || start.isPending} data-testid="start-submit">
          {start.isPending ? "Starting…" : "Start"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setIdempotencyKey(newIdempotencyKey());
            setError(null);
          }}
          disabled={start.isPending}
        >
          New key
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={start.isPending}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
