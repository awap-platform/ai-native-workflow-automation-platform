"use client";

import { useMemo, useState, type KeyboardEvent } from "react";

import { NODE_DRAG_MIME } from "../../lib/workflowDesigner";
import { Input } from "../ui/form-controls";
import {
  filterPaletteItems,
  paletteByGroup,
  paletteNavigationIndex,
  type PaletteItem,
} from "../../lib/workflowPalette";

interface NodePaletteProps {
  onAdd: (type: string) => void;
  /**
   * Records the type the pointer went down on. It is the authoritative drag source even when the
   * browser's drag data is lost or re-associated while the pointer crosses other buttons.
   */
  onDragIntent?: (type: string | null) => void;
}

/**
 * Grouped node palette (phase 5). Every node type is still a native drag source and a plain
 * button, so pointer, touch and keyboard users all have a path to add a node. The search field
 * narrows the list and the arrow keys move a palette cursor; Enter inserts the active type.
 */
export default function NodePalette({ onAdd, onDragIntent }: NodePaletteProps) {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const filtered = useMemo(() => filterPaletteItems(query), [query]);
  const groups = useMemo(() => paletteByGroup(query), [query]);

  function moveCursor(event: KeyboardEvent<HTMLInputElement>) {
    const current = activeType === null ? -1 : filtered.findIndex((item) => item.type === activeType);
    const next = paletteNavigationIndex(event.key, current, filtered.length);
    if (next === null) {
      if (event.key === "Enter" && activeType !== null) {
        event.preventDefault();
        onAdd(activeType);
      } else if (event.key === "Escape") {
        setQuery("");
        setActiveType(null);
      }
      return;
    }
    event.preventDefault();
    setActiveType(filtered[next]?.type ?? null);
  }

  function activate(item: PaletteItem) {
    setActiveType(item.type);
    onAdd(item.type);
  }

  return (
    <aside className="awap-designer__palette" aria-labelledby="node-palette-heading">
      <h2 id="node-palette-heading">Node palette</h2>
      <p id="node-palette-help" className="awap-designer__hint">
        Drag a node type onto the canvas, or search and press Enter to add the highlighted type at
        the next free position.
      </p>
      <label className="awap-designer__field" htmlFor="node-palette-search">
        Search node types
        <Input
          id="node-palette-search"
          className="awap-designer__palette-search"
          type="search"
          value={query}
          placeholder="Search events, tasks, gateways…"
          aria-describedby="node-palette-help"
          aria-controls="node-palette-list"
          aria-activedescendant={activeType === null ? undefined : `palette-${activeType}`}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveType(null);
          }}
          onKeyDown={moveCursor}
        />
      </label>
      <div id="node-palette-list">
        {groups.length === 0 ? (
          <p role="status" className="awap-designer__hint">
            No node type matches “{query}”.
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group.id}
              className="awap-designer__group"
              aria-labelledby={`palette-group-${group.id}`}
            >
              <h3 id={`palette-group-${group.id}`} className="awap-designer__group-title">
                {group.label}
              </h3>
              <ul className="awap-designer__group-items">
                {group.items.map((item) => (
                  <li key={item.type}>
                    <button
                      id={`palette-${item.type}`}
                      type="button"
                      draggable
                      className="awap-designer__palette-button"
                      data-active={activeType === item.type}
                      aria-label={item.type}
                      aria-describedby="node-palette-help"
                      title={`${item.label} — ${item.keywords.join(", ")}`}
                      onClick={() => {
                        onDragIntent?.(null);
                        activate(item);
                      }}
                      onFocus={() => setActiveType(item.type)}
                      onPointerDown={() => onDragIntent?.(item.type)}
                      onDragEnd={() => onDragIntent?.(null)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(NODE_DRAG_MIME, item.type);
                        event.dataTransfer.setData("text/plain", item.type);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

/** Kept for callers that previously imported the palette colour helper. */
export function darken(hex: string, factor = 0.6): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((channel) =>
    Math.round(channel * factor)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}
