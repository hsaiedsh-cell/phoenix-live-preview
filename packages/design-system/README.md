# @phoenix/design-system

Centralized brand tokens for every Phoenix app. This is the **single source of truth**
for brand colors, typography, spacing, motion, and border radius.

## Files

- `src/index.ts` — canonical hex color values (`colors`), typography scale, spacing
  presets, motion durations/easings, and border radius scale, as plain TS constants.
- `src/tokens.css` — the same colors expressed as global CSS custom properties (as
  `R G B` triples, e.g. `--phx-cyan-rgb: 3 167 199`), plus `rgb(...)`-resolved
  convenience variables (e.g. `--phx-cyan`). Imported once per app via that app's
  `globals.css`:

  ```css
  @import '@phoenix/design-system/tokens.css';
  ```

## Colors

| Token              | Hex       | CSS variable            |
|--------------------|-----------|--------------------------|
| Navy (primary)     | `#0C1929` | `--phx-navy`             |
| Navy Light         | `#132238` | `--phx-navy-light`       |
| Navy Mid           | `#1A2D47` | `--phx-navy-mid`         |
| Navy Surface       | `#0F1E30` | `--phx-navy-surface`     |
| Cyan (accent)      | `#03A7C7` | `--phx-cyan`             |
| Cyan Light         | `#05C8ED` | `--phx-cyan-light`       |
| Cyan Dark          | `#028BA6` | `--phx-cyan-dark`        |
| Surface (neutral)  | `#F8F9FA` | `--phx-surface`          |
| White              | `#FFFFFF` | `--phx-white`            |

## How Apps Consume This

Each app's `tailwind.config.ts` maps a `phx-*` color scale onto these CSS variables
using the `rgb(var(--phx-*-rgb) / <alpha-value>)` pattern, which makes Tailwind's
opacity modifiers work correctly (e.g. `bg-phx-cyan/10`, `border-phx-navy-mid/40`).
Components then use classes like `bg-phx-navy`, `text-phx-cyan`,
`border-phx-navy-mid`, `bg-phx-surface` — never raw hex.

For contexts where Tailwind classes aren't available (inline SVG `fill`/`stroke`
attributes), reference the CSS variable directly, e.g. `fill="var(--phx-cyan)"`.

## Updating Brand Colors

If a brand color ever changes, update **both** `src/index.ts` and `src/tokens.css`
together — they must stay in sync. The one intentional exception in the whole monorepo
is `apps/website/src/app/icon.svg` (the favicon), which is rendered outside the page's
CSS scope and must keep literal hex values; it's commented in-file to explain why.
