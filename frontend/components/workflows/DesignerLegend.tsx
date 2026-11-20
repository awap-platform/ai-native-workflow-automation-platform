/**
 * Explains the transition decorations so users can tell conditional branches from unconditional
 * ones without opening the inspector.
 */
export default function DesignerLegend() {
  return (
    <section aria-labelledby="designer-legend-heading">
      <h2 id="designer-legend-heading">Legend</h2>
      <ul className="awap-designer__row">
        <li>
          <span aria-hidden="true" className="awap-designer__legend-swatch" />
          Unconditional transition
        </li>
        <li>
          <span aria-hidden="true" className="awap-designer__legend-badge">
            IF
          </span>
          Conditional transition evaluated as a SpEL expression
        </li>
      </ul>
    </section>
  );
}
