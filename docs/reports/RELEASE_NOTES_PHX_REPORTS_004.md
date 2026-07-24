# Release Notes — PHX-REPORTS-004

**Report Generation Lifecycle & Secure Artifact Delivery Foundation**

## What changed

- The four remaining stub endpoints under `/api/reports` and
  `/api/workspaces/:workspaceId/reports` are now real: list, detail, generate
  (start/retry/regenerate), and authenticated download.
- Reports are now actually generated — a persistent, database-backed worker
  renders real PDF, HTML, and CSV files from live PBRS data for both approved
  templates (`asset-readiness-summary`, `workspace-portfolio-summary`) and
  stores them via a local artifact store with checksummed, immutable
  per-version metadata.
- Downloads are integrity-verified (size + SHA-256) before any bytes are sent;
  a corrupted or missing artifact is detected and the report self-heals to a
  `Failed` state with a sanitized reason, recoverable via a normal retry.
- The Reports page in `real-dev`/`production-auth` mode now shows live data
  with real Start/Retry/Regenerate/Download actions and bounded status
  polling, replacing the previous mock-data placeholder for those two modes.

## What was preserved

- The six-dimension PBRS model (Accuracy, Compliance, Brand Alignment,
  Structure, Consistency, Completeness) — unchanged, unreferenced beyond
  read-only display in report output.
- Certification/passport rules, the auth-mode resolver, and workspace
  isolation — unchanged.
- `mock` mode — unchanged, still the original mock `ReportCard` grid.
- `vercel-supabase-preview` mode — unchanged except for one additive field
  (`version`) in its existing read-only query; still no write path.

## Limitations

- Local filesystem artifact storage only this release — cloud object storage
  is out of scope.
- The workspace-portfolio-summary template has a configured maximum asset
  count (`REPORT_PORTFOLIO_MAX_ASSETS`, default 500); a workspace exceeding
  this fails generation closed with a clear reason rather than producing a
  silently-truncated report.
- No proactive integrity check on list/detail reads — only a download attempt
  triggers artifact verification.
- Real browser-driven UI QA (click/poll/download interaction) was not
  possible in this development sandbox (no browser available); the
  underlying backend behavior these actions call is exhaustively tested
  directly.

## Setup

See `docs/reports/PHX_REPORTS_004_SETUP_GUIDE.md` for migration, backend,
worker, and local storage run instructions.
