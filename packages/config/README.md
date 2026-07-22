# @phoenix/config

Shared, non-visual configuration consumed by apps: site metadata, navigation, and
footer structure.

## Exports

- `siteConfig` — name, tagline, canonical URL, description, contact email, social links.
- `navigationItems` — primary nav items (label + href) used by `Header`.
- `footerSections` — grouped footer link sections used by `Footer`.

## Guardrail

Keep this package free of brand colors or PBRS domain logic — those belong in
`@phoenix/design-system` and `@phoenix/core` respectively.
