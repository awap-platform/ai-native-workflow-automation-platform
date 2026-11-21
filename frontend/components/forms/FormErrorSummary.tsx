"use client";

import { useEffect, useRef } from "react";

import type { FieldIssue } from "../../lib/forms/schema";

export interface FormErrorSummaryProps {
  errors: FieldIssue[];
  /** Increment on every submit attempt; a fresh attempt moves focus here (T6-08). */
  focusRequests?: number;
  /** Prefix used to build the control ids the summary links to. */
  idPrefix: string;
  heading?: string;
}

/**
 * Accessible error summary: a labelled `role="alert"` list of buttons. Each
 * button moves focus to the offending control, and a new submit attempt focuses
 * the summary so a screen-reader user hears the failure before the fields.
 */
export default function FormErrorSummary({
  errors,
  focusRequests = 0,
  idPrefix,
  heading = "This form has problems",
}: FormErrorSummaryProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const lastRequest = useRef(focusRequests);

  useEffect(() => {
    if (focusRequests > lastRequest.current) {
      lastRequest.current = focusRequests;
      if (errors.length > 0) {
        container.current?.focus();
      }
    }
  }, [focusRequests, errors.length]);

  if (errors.length === 0) {
    return null;
  }

  return (
    <div
      ref={container}
      className="awap-form__summary"
      role="alert"
      tabIndex={-1}
      aria-labelledby={`${idPrefix}-summary-heading`}
      data-testid="form-error-summary"
    >
      <h2 id={`${idPrefix}-summary-heading`} className="awap-form__summary-heading">
        {heading}
      </h2>
      <p className="awap-form__summary-count">
        {errors.length === 1 ? "1 field needs attention." : `${errors.length} fields need attention.`}
      </p>
      <ul className="awap-form__summary-list">
        {errors.map((error) => (
          <li key={`${error.fieldId}-${error.message}`}>
            <button
              type="button"
              className="awap-form__summary-link"
              onClick={() => {
                const target = document.getElementById(`${idPrefix}-${error.fieldId}`);
                if (target instanceof HTMLElement) {
                  target.focus();
                }
              }}
            >
              {error.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
