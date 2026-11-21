"use client";

import { useEffect, useRef } from "react";

/**
 * Inline confirmation for a privileged mutation.
 *
 * The backend audits every mutation; this panel makes the operator's intent explicit before the
 * request is sent. It is not a modal, so focus moves into the panel and the rest of the page stays
 * reachable.
 */
export function ConfirmationPanel({
  id,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
}: {
  id: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div
      ref={panel}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      tabIndex={-1}
      data-testid={id}
      className={danger ? "awap-confirm awap-confirm-danger" : "awap-confirm"}
    >
      <h3 id={`${id}-title`} className="awap-confirm-title">
        {title}
      </h3>
      <p id={`${id}-description`}>{description}</p>
      <div className="awap-confirm-actions">
        <button
          type="button"
          className={danger ? "awap-button awap-button-danger" : "awap-button awap-button-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button type="button" className="awap-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
