"use client";

import Link from "next/link";
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";

/* -------------------------------------------------------------------------- */
/* Table + DataGrid                                                           */
/* -------------------------------------------------------------------------- */

export function Table({ className, children, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("awap-table", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
}

export interface DataGridProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  caption?: string;
  emptyMessage?: string;
}

export function DataGrid<T>({
  columns,
  rows,
  getRowKey,
  caption,
  emptyMessage = "No records.",
}: DataGridProps<T>) {
  return (
    <Table>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" className={column.align === "right" ? "text-right" : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="text-center awap-muted">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.align === "right" ? "text-right" : undefined}
                >
                  {column.render
                    ? column.render(row)
                    : String((row as Record<string, unknown>)[column.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export interface TabItem {
  value: string;
  label: string;
  content?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
}

export function Tabs({ items, value, onValueChange, ariaLabel }: TabsProps) {
  const baseId = useId();
  const active = items.find((item) => item.value === value) ?? items[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.value === value);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = items[(index + 1) % items.length];
      if (next) {
        onValueChange(next.value);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const previous = items[(index - 1 + items.length) % items.length];
      if (previous) {
        onValueChange(previous.value);
      }
    }
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex flex-wrap gap-1 border-b border-border"
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          const selected = item.value === active?.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              className={cn(
                "min-h-10 rounded-t-md px-3 py-2 text-sm font-semibold",
                selected ? "border-b-2 border-primary text-foreground" : "awap-muted",
              )}
              onClick={() => onValueChange(item.value)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.value}`}
          aria-labelledby={`${baseId}-tab-${active.value}`}
          className="pt-3"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  ariaLabel?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  ariaLabel = "Pagination",
}: PaginationProps) {
  return (
    <nav aria-label={ariaLabel} className="flex items-center justify-between gap-2">
      <button
        type="button"
        className="awap-button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Previous
      </button>
      <span className="text-sm awap-muted" aria-live="polite">
        Page {page} of {Math.max(totalPages, 1)}
      </span>
      <button
        type="button"
        className="awap-button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        Next
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Stepper + Timeline                                                         */
/* -------------------------------------------------------------------------- */

export interface StepperStep {
  label: string;
  description?: string;
}

export function Stepper({
  steps,
  current,
  ariaLabel = "Progress",
}: {
  steps: StepperStep[];
  current: number;
  ariaLabel?: string;
}) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const state = index < current ? "complete" : index === current ? "current" : "upcoming";
        return (
          <li
            key={step.label}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex min-w-32 flex-1 flex-col gap-1 rounded-md border p-2",
              state === "current" && "border-primary",
              state === "complete" && "border-[var(--awap-success)]",
            )}
          >
            <span className="text-xs font-semibold awap-muted">
              Step {index + 1} {state === "complete" ? "✓" : ""}
            </span>
            <span className="text-sm font-semibold">{step.label}</span>
            {step.description ? <span className="text-xs awap-muted">{step.description}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export interface TimelineItem {
  id: string;
  title: string;
  time: string;
  description?: string;
}

export function Timeline({ items, ariaLabel = "Timeline" }: { items: TimelineItem[]; ariaLabel?: string }) {
  return (
    <ol className="grid gap-3 border-l border-border pl-4" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[21px] top-1 size-2 rounded-full bg-primary"
          />
          <p className="text-sm font-semibold">{item.title}</p>
          <time className="text-xs awap-muted">{item.time}</time>
          {item.description ? <p className="text-sm">{item.description}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Breadcrumb                                                                 */
/* -------------------------------------------------------------------------- */

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items, ariaLabel = "Breadcrumb" }: { items: BreadcrumbItem[]; ariaLabel?: string }) {
  return (
    <nav aria-label={ariaLabel}>
      <ol className="flex flex-wrap items-center gap-1 text-xs awap-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined}>{item.label}</span>
              )}
              {!last ? <span aria-hidden="true">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
