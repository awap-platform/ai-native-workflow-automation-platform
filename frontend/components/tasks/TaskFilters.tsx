"use client";

import { useState } from "react";
import { useI18n } from "../../lib/locale";
import {
  TASK_FILTERS,
  TASK_SORTS,
  type InboxCounts,
  type InboxQuery,
  type TaskFilter,
  type TaskSort,
} from "../../lib/tasks/inbox";
import type { SavedView } from "../../lib/tasks/savedViews";
import { Input, Select } from "../ui/form-controls";

interface TaskFiltersProps {
  query: InboxQuery;
  counts: InboxCounts;
  savedViews: SavedView[];
  onChange: (query: InboxQuery) => void;
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedView) => void;
  onDeleteView: (id: string) => void;
}

/**
 * Filter chips, search, sort and saved views. Every control is a native input or button so the
 * inbox stays operable by keyboard and screen reader without a custom combobox.
 */
export default function TaskFilters({
  query,
  counts,
  savedViews,
  onChange,
  onSaveView,
  onApplyView,
  onDeleteView,
}: TaskFiltersProps) {
  const { t } = useI18n();
  const [viewName, setViewName] = useState("");

  const countFor = (filter: TaskFilter): number => {
    switch (filter) {
      case "open":
        return counts.open;
      case "completed":
        return counts.completed;
      case "mine":
        return counts.mine;
      case "unassigned":
        return counts.unassigned;
      case "overdue":
        return counts.overdue;
    }
  };

  return (
    <div className="grid gap-3" data-testid="task-filters">
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label={t("tasks.filters.label")}
        data-testid="task-filter-chips"
      >
        {TASK_FILTERS.map((filter) => {
          const active = query.filter === filter;
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={active}
              className={`awap-button min-h-9 px-3 py-1 text-sm ${active ? "awap-button-primary" : "awap-button-ghost"}`}
              onClick={() => onChange({ ...query, filter })}
              data-testid={`task-filter-${filter}`}
            >
              {t(`tasks.filter.${filter}`)}
              <span className="awap-badge" aria-hidden="true">
                {countFor(filter)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">{t("tasks.filters.search")}</span>
          <Input
            type="search"
            value={query.search}
            placeholder={t("tasks.filters.searchPlaceholder")}
            onChange={(event) => onChange({ ...query, search: event.target.value })}
            data-testid="task-search"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">{t("tasks.filters.sort")}</span>
          <Select
            value={query.sort}
            onChange={(event) => onChange({ ...query, sort: event.target.value as TaskSort })}
            data-testid="task-sort"
          >
            {TASK_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`tasks.sort.${sort}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">{t("tasks.views.label")}</span>
          <Select
            value=""
            onChange={(event) => {
              const view = savedViews.find((entry) => entry.id === event.target.value);
              if (view) {
                onApplyView(view);
              }
            }}
            data-testid="task-saved-views"
          >
            <option value="">{t("tasks.views.placeholder")}</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="sr-only">{t("tasks.views.name")}</span>
            <Input
              value={viewName}
              maxLength={40}
              placeholder={t("tasks.views.name")}
              onChange={(event) => setViewName(event.target.value)}
              data-testid="task-view-name"
            />
          </label>
          <button
            type="button"
            className="awap-button min-h-11"
            disabled={viewName.trim() === ""}
            onClick={() => {
              onSaveView(viewName);
              setViewName("");
            }}
            data-testid="task-view-save"
          >
            {t("tasks.views.save")}
          </button>
        </div>
      </div>

      {savedViews.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("tasks.views.savedLabel")}>
          {savedViews.map((view) => (
            <li key={view.id} className="flex items-center gap-1">
              <button
                type="button"
                className="awap-link-button text-sm"
                onClick={() => onApplyView(view)}
              >
                {view.name}
              </button>
              <button
                type="button"
                className="awap-link-button text-xs awap-muted"
                aria-label={t("tasks.views.delete", { name: view.name })}
                onClick={() => onDeleteView(view.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
