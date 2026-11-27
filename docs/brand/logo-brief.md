# AWAP logo brief

The organisation `awap-platform` needs a mark. This document is the design
rationale plus the exact prompts to feed a generative tool, so the result is not
"a nice picture" but a mark that survives a 16 px favicon and a circular GitHub
avatar.

## 1. What the brand is

From [`README.md`](../../README.md):

> Design, run and optimize business processes — visually, reliably and with AI.

AWAP is a **no-code workflow automation platform**: a tenant-isolated,
event-driven engine (transactional outbox -> Kafka with DLQ and retry) with a
visual designer (`START`, `FORM`, `APPROVAL`, `TASK`, `END` nodes), versioned
processes, audit trails and an AI Copilot.

The three ideas a viewer should be able to read from the mark, in this order:

1. **Flow** - something moves through a defined path.
2. **Control / closed loop** - the path returns, checks and completes; it is not a
   one-way arrow. This is what separates AWAP from "another automation toy".
3. **Intelligence** - one segment of the loop is "awake" (solid, brighter) while
   the rest is a calm outline.

Deliberately **not** the message: robots, brains, humanoid heads, circuit boards,
gears, infinity symbols, chat bubbles, rockets. Those are the crowded, generic
choices and they read as clipart at avatar size.

## 2. Where the mark has to work

| Context | Size | Constraint |
|---|---|---|
| GitHub organisation avatar | 400 px upload, rendered at 24 px in lists | Circular crop; the mark must survive a circle mask |
| Repo social preview / README header | 1280x640 | Horizontal lockup with wordmark |
| Frontend favicon / PWA icon | 16, 32, 180 px | Must stay legible at 16 px, so at most 2 strokes of contrast |
| Dark and light UI | - | Must have no dark-only or light-only assumption |
| Grayscale / fax / embroidered swag | - | Must work as a single flat colour |
| Motion (optional) | - | The same geometry should animate by rotation, not by redraw |

This is why the brief forbids gradients in the base version, thin 1 px hairlines,
text inside the mark and more than three visual elements.

## 3. Decision: the "trifold loop"

**The mark is a closed hexagonal loop drawn as three identical chevrons at 120°
rotational symmetry. One chevron is solid, the other two are outlined with the
same stroke weight. Small equal gaps sit between the chevrons, and the gaps are
rotated so they never sit on a vertical or horizontal axis.**

Why this one:

- **A closed loop with a break** encodes "process runs end to end, and it repeats"
  - the reliability story the README sells. A plain arrow cannot show it.
- **Three elements, one solid** gives an unmistakable dark/light rhythm that
  survives 16 px: the eye sees one filled wedge and an open ring, nothing finer.
- **120° symmetry** is the only symmetry that looks right when the mark is
  animated by rotation (the solid chevron "travels" around the loop while the
  silhouette stays identical). It also makes the circular avatar crop safe: a
  hexagonal loop already inscribes in a circle, so nothing important is cut.
- **Chevrons, not nodes** keep it away from the "dot-and-line flowchart" cliché
  that half the workflow market already uses.
- It reads as a **belt / conveyor / turbine** at a glance - motion and machinery -
  without drawing a gear.

Rejected alternatives, with the reason:

| Idea | Rejected because |
|---|---|
| Letter "A" built from a workflow path | Lettermarks are the weakest option for a platform brand; at 24 px the "A" collapses into a triangle, and it fights with the wordmark next to it |
| Rounded-square loop with node dots | Silhouette is a generic "app icon blob"; indistinguishable from dozens of SaaS marks |
| Infinite loop / Mobius ribbon | Reads as "integration" or "DevOps", not as governed process; overused for AI products |
| Node graph with three connected dots | Turns into mush below 32 px; also collides with n8n/Zapier-style visuals |
| Hexagon + circuit traces | The most crowded AI cliché of the last five years |

## 4. Colour

The palette is derived from the product's own design tokens, so the logo and the
UI never drift apart (see [`frontend/app/globals.css`](../../frontend/app/globals.css:71)).

| Role | Token | Approx. hex | Where |
|---|---|---|---|
| Primary (light mode) | `oklch(0.55 0.2 266)` | `#4F46E5` indigo | solid chevron, wordmark |
| Primary (dark mode) | `oklch(0.72 0.16 266)` | `#818CF8` indigo-400 | solid chevron on dark |
| Accent (completion) | `oklch(0.627 0.17 149)` | `#10B981` emerald | optional gradient tip only |
| Ink | `oklch(0.21 0.02 258)` | `#111827` | monochrome variant, light bg |
| Paper | `oklch(0.98 0.004 247)` | `#F8FAFC` | reversed mark background |

Rules:

- **Base mark is flat indigo on transparent.** No gradient in the deliverable that
  goes into the favicon or the GitHub avatar.
- One **optional** gradient (`#4F46E5 -> #10B981`) is allowed only for the large
  hero lockup; it must never be the only version.
- Contrast: the indigo on white is ~4.8:1 and on `#111827` is ~3.1:1, which is why
  the dark-mode variant must use indigo-400, not indigo-600.
- Never place the indigo mark on the emerald accent; never tint the mark with the
  danger or warning colours.

## 5. Geometry rules

- Grid: draw on a 24 x 24 unit grid, 2 units of padding on each side -> **20 units
  of live area**.
- Three chevrons, each an open "V" of two equal arms; outer radius 2 units,
  inner radius 2 units (rounded ends optional, but if rounded, rounded on all six
  ends consistently).
- Stroke weight: **2 units** (= 8% of the live area). Outlined chevrons use that
  stroke; the solid chevron must occupy the same visual weight, so compensate by
  using the filled shape of the *same* arm width, not a fat wedge.
- Gap between chevrons: **1 unit**, constant, and rotated off-axis.
- Optical correction: the solid chevron looks heavier, so pull it 0.25 units
  inward; the loop must still read as one continuous ring.
- Clear space: equal to the stroke weight x 2 on every side. In the circular
  avatar, keep the loop at 78% of the circle diameter.

## 6. Wordmark

- `AWAP` in uppercase, geometric grotesque (Inter, Geist, Söhne or Figtree),
  weight 600, tracking +2% (uppercase needs air, but not a gappy +8%).
- The lockup places the mark to the left, gap = 0.5 x cap height, optically
  centred on the cap height (not on the x-height).
- Never letterspace the wordmark to fill a width; never set `AWAP` in the mark.

## 7. Deliverables

1. `awap-mark.svg` - flat single-colour (currentColor), 24 x 24 and 512 x 512 artboards.
2. `awap-mark-dark.svg` - indigo-400 for dark UI.
3. `awap-mark-mono.svg` - `#111827` for print.
4. `awap-mark-gradient.svg` - hero only.
5. `awap-lockup-horizontal.svg` and `awap-lockup-stacked.svg`.
6. `favicon.ico` (16/32/48) + `icon-180.png` (Apple touch) + `icon-512.png` (PWA).
7. `awap-avatar-400.png` - the GitHub org avatar: mark on solid paper, 78% scale,
   optically centred.

## 8. Do not

- Do not add a robot, brain, sparkle/AI star, circuit trace, gear, or a literal
  arrow.
- Do not use more than two colours in any production variant.
- Do not apply drop shadows, bevels, 3D, glassmorphism, or a glossy highlight.
- Do not use thin hairlines below 1.5 units on the 24-grid.
- Do not place the wordmark inside the chevron loop.
- Do not rotate the solid chevron in the static versions; symmetry is fixed.

## 9. Acceptance tests

Run these before adopting anything generated:

1. **16 px test** - scale to 16 px: you must still see *a ring with one solid
   wedge*. If the gaps disappear, reject.
2. **Blur test** - apply a 2 px Gaussian blur: it must still read as a loop, not a
   smudge.
3. **Grayscale test** - desaturate: the solid chevron must remain the darkest shape.
4. **Circle mask test** - overlay a 78% circle: nothing clipped, no awkward tangency.
5. **One-colour test** - render in `#111827` on paper and in white on `#111827`.
6. **Neighbour test** - place beside GitHub, SonarQube and Renovate avatars at
   24 px: the mark must not blend into the crowd of rounded-square icons.
7. **Uniqueness** - reverse image search and a trademark check on the final
   silhouette before using it publicly.

## 10. Prompts for the AI generator

Use the **base prompt** first, in a vector-capable tool (Recraft, Ideogram vector
mode, or Adobe Illustrator text-to-vector). Raster-only tools (Midjourney,
DALL-E) are fine for exploring the silhouette, but the final file must be a traced
or re-drawn SVG.

### Base prompt (primary mark)

```text
Minimal flat vector logo mark for an enterprise workflow-automation software
platform. A single closed loop shaped as a regular hexagon, drawn as three
identical chevrons rotated 120 degrees apart, outlining the hexagon. Each
chevron is an open V of two equal arms with rounded outer corners, uniform
2-unit stroke on a 24-unit grid, small equal gaps of 1 unit between chevrons,
gaps rotated 15 degrees off the vertical axis. Exactly ONE chevron is a solid
filled shape in indigo #4F46E5; the other two are the same indigo as an outline
stroke of identical weight. Perfect 120-degree rotational symmetry, optically
centred, no text, no letters, no drop shadow, no gradient, no 3D, no bevel, flat
single-colour design, transparent background, generous clear space, precise
geometric construction, crisp edges, logo-grid construction aesthetic, suitable
for a 16px favicon. Style: Swiss modernist, technical, calm, enterprise-grade.
```

### Negative prompt

```text
robot, brain, humanoid head, circuit board, circuit traces, gear, cog, infinity
symbol, infinity loop, chat bubble, speech bubble, rocket, lightning bolt, AI
sparkle, star sparkle, arrow, play button, node graph, connected dots, chain
link, puzzle piece, shield, cloud, hexagon pattern fill, honeycomb, 3D render,
glossy, glassmorphism, bevel, emboss, drop shadow, outer glow, gradient mesh,
noise, grain, sketch, hand-drawn, watercolor, neon, cyberpunk, purple-to-pink
gradient, lens flare, multiple logos, mockup, business card, text, wordmark,
letters, numbers, watermark, low contrast, tiny details, thin hairlines
```

### Variant prompt A - dark UI

```text
Same hexagonal trifold-loop mark, identical geometry, outline and solid chevron
drawn in indigo-400 #818CF8 on a flat near-black background #252525. One solid
chevron only, two open outline chevrons, no gradient, no glow, flat vector, crisp
2-unit stroke, 120-degree rotational symmetry, no text.
```

### Variant prompt B - monochrome / swag

```text
Same hexagonal trifold-loop mark as a single flat colour #111827 on white. All
three chevrons use solid fills alternating with negative-space gaps that emulate
the outline weight, so the one-colour version keeps the same solid-versus-outline
rhythm. No gradients, no shadows, vector, print-ready, centred with clear space.
```

### Variant prompt C - horizontal lockup

```text
Logo lockup: the hexagonal trifold-loop mark on the left, a vertical divider of
1-unit width of clear space, then the wordmark "AWAP" in uppercase, geometric
grotesque typeface, weight 600, tracking plus 2 percent, colour #111827, with the
small subtitle "workflow automation platform" in 10 percent size below in
uppercase, tracking plus 12 percent, colour #6B7280. Flat vector, no shadow, no
gradient, aligned on cap height, generous clear space, white background.
```

### Tool notes

- **Recraft / Ideogram (vector mode)**: run the base prompt, export SVG, then
  re-draw the three chevrons on a 24-unit grid so the symmetry is mathematically
  exact - generated vectors are almost never perfectly symmetric.
- **Midjourney**: add `--style raw --no text,gradient --ar 1:1` and treat the
  output only as silhouette exploration; expect to redraw.
- **Whichever tool you use**: generate 12-20 candidates, filter with the seven
  acceptance tests in section 9, then vectorise one. Do not accept the first
  attractive render - the 16 px test is the actual judge.

## 11. After the mark is chosen

1. Commit the SVG sources under `frontend/public/brand/` and wire
   `frontend/app/icon.svg` + `manifest` icons so the favicon matches.
2. Upload `awap-avatar-400.png` as the organisation avatar.
3. Update the README header and the repository social preview.
4. Keep the tokens in [`frontend/app/globals.css`](../../frontend/app/globals.css:68)
   as the single source of colour truth; if the logo colour ever changes, the
   token changes first.
