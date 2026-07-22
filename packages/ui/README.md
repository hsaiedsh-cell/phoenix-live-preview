# @phoenix/ui

Shared, presentation-only React components used across Phoenix apps. Consumes
`@phoenix/core` (for typed props like `PBRSDimension`/`PBRSScore`) and
`@phoenix/design-system` (brand tokens, consumed via the `phx-*` Tailwind color scale
in each app — not imported directly as JS in these components).

## Components

| Component            | Purpose |
|-----------------------|---------|
| `PageHero`             | Page-level hero section with eyebrow, headline, subline, and up to two CTAs. |
| `SectionHeader`        | Section eyebrow/title/description block. |
| `CTAButton`            | Primary/secondary/ghost call-to-action button. |
| `ProductCard`          | Product summary card (name, tagline, audience, value). |
| `SolutionCard`         | Function-based problem/solution/outcome card. |
| `ResourceCard`         | Resource/knowledge-hub card with status badge. |
| `MetricPanel`          | Large stat panel (dark/light variants). |
| `FeatureGridItem`      | Icon + title + description grid item. |
| `WorkflowTimeline`     | Numbered step timeline. |
| `TrustLayerDiagram`    | Fixed 4-stage "AI Output → Enterprise Use" diagram. |
| `DimensionGrid`        | Renders `PBRS_DIMENSIONS` with optional sample scores. |
| `PBRSScorePreview`     | Circular score gauge + grade/tier/derived-signal summary. |
| `ContactFormShell`     | Static contact form UI (not wired to a backend). |

## Navigation Convention

`CTAButton` and `PageHero`'s CTA props accept any `href`. Internal routes render as a
Next.js `<Link>`; external protocols (`mailto:`, `tel:`, `http://`, `https://`) render
as a plain `<a>`. This is handled automatically — callers don't need to choose.

## Brand Colors

Never hardcode a hex value in this package. Use the `phx-*` Tailwind classes (e.g.
`bg-phx-navy`, `text-phx-cyan`, `border-phx-navy-mid`, `bg-phx-surface`) — these are
resolved per-consuming-app via that app's `tailwind.config.ts`, which maps them onto the
CSS variables defined in `@phoenix/design-system/tokens.css`.
