/**
 * Layout geometry helpers for structural regression assertions (issue 360).
 * Kept pure so the overlap predicate itself is unit-tested rather than trusted.
 */

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when two rendered boxes share any area. Missing boxes are treated as non-overlapping. */
export function rectsOverlap(
  left: LayoutRect | null | undefined,
  right: LayoutRect | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

/** True when the document is wider than its viewport (a horizontal scrollbar). */
export function hasHorizontalOverflow(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth;
}
