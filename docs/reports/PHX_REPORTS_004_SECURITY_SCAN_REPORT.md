# PHX-REPORTS-004 — Security Scan Report

## 1. Manual security checklist

See `01_MANUAL_SECURITY_CHECKLIST.md` in the QA evidence bundle for the full
category-by-category review (path traversal, SQL injection, header injection,
HTML injection, CSV formula injection, authorization bypass, secret leakage,
stack-trace leakage, artifact integrity, and the execution-control #9
concurrent-state-change handling). This is a manual code-level review
checklist, explicitly not an automated static-analysis tool run — labeled as
such, no false claim of automated tooling beyond what actually executed.

## 2. Dependency vulnerability scan

**Command**: `pnpm audit --audit-level=high` (repository root — this is the
lockfile pnpm's workspace resolution and `pnpm install --frozen-lockfile`
actually use).

**Result**: 26 findings — **2 low, 12 moderate, 12 high** (`--audit-level=high`
threshold means only high/critical are shown in the summary table, though the
tool reports the full breakdown regardless of the filter). Full raw output:
`02_pnpm_audit_output.txt`.

**All 26 findings trace to exactly 4 packages**: `next`, `postcss` (a
transitive dependency of `next`'s build pipeline), `brace-expansion`, and
`glob` (both transitive through `eslint`'s dependency tree). **Zero findings
involve `pdfkit`, `@types/pdfkit`, or `pdf-parse`** — the three dependencies
this sprint introduced — confirmed by direct grep of the audit output.

| Category | Result |
|---|---|
| Runtime vulnerabilities | All in `next` (used by `apps/platform`, `apps/dashboard`, `apps/website` — not `apps/backend`, which has no `next` dependency) and `postcss` (a build-time dependency of `next`'s CSS pipeline). |
| Development-only vulnerabilities | `brace-expansion`, `glob` — both transitive through `eslint`'s toolchain, never present in any built runtime bundle. |
| Pre-existing findings | All 26. `next@14.2.35`, the eslint toolchain, and `postcss` were all already pinned at these versions before this sprint began — this sprint added no dependency to any app other than `apps/backend`'s `pdfkit`/`pdf-parse`/`@types/pdfkit`. |
| Findings introduced by PHX-REPORTS-004 | **None.** |

Per instruction: no high/critical finding affects a dependency this sprint
introduced, so no dependency-version change was made and none is proposed
here. No broad automatic dependency upgrade or `audit fix` was run.

**Command**: `npm audit --omit=dev` inside `apps/backend`.

**Result**: `found 0 vulnerabilities`. **This result is not meaningful
evidence** and should not be relied on: `apps/backend/package-lock.json` is a
stale, pre-existing artifact that this pnpm workspace does not actually
consult for dependency resolution (confirmed: it predates this sprint, per
`git log`, and does not even list `pdfkit`/`pdf-parse`, which are present in
`apps/backend/package.json`). The authoritative dependency-resolution source
for this entire workspace, including `apps/backend`, is the root
`pnpm-lock.yaml` — which is exactly what `pnpm audit` above already covers.
This discrepancy is documented here rather than silently presenting the
`npm audit` "0 vulnerabilities" result as if it were meaningful confirmation.

## 3. PDF validation

**Command**: `npx tsx apps/backend/scripts/verify-report-pdf.ts <path>`
(uses `pdf-parse`, a devDependency, never imported by production code).

**Result** (against the real generated sample in this handoff):
```
PDF signature OK: %PDF-1.3
pdf-parse OK: 1 page(s), Producer=PDFKit
PASS
```

## 4. Artifact integrity — real adversarial test

A real, successfully-generated PDF was deliberately corrupted on disk (bytes
overwritten, metadata left untouched) to simulate disk-level corruption or
external tampering. The download endpoint:
- Detected the size/checksum mismatch before sending any bytes.
- Sent **zero** artifact bytes.
- Returned a 409 with a message containing no path, hash, or internal detail
  (asserted programmatically via a regex check for `artifact\.pdf|sha256|
  [0-9a-f]{64}|/mnt/` in the response — none matched).
- Transitioned the report `Available → Failed` with `actor_user_id = NULL`
  and a sanitized reason.
- Allowed a subsequent authorized retry to recover normally.

## 5. Storage security — real adversarial tests

19/19 real checks against `LocalReportArtifactStore` (size limits, path
traversal on write/read/delete, absolute-path handling, encoded/normalized
traversal variants) — see the QA report §4 for the full breakdown. One real
gap was found (absolute-looking keys were safely contained by `path.join` but
not explicitly rejected) and fixed with an added `assertKeyFormat()` guard.

## 6. What this scan does not cover

- No automated static-analysis (SAST) tool was run beyond the manual
  checklist — none was added to this sprint's scope, and none is claimed to
  have run.
- No dynamic/fuzz testing of the HTTP endpoints beyond the specific adversarial
  cases above (corrupted artifact, traversal keys, oversized payloads).
- No load/rate-limit/DoS testing — out of this sprint's scope per the task
  brief.
- Real browser-based XSS/CSP testing was not performed (no browser available
  in this sandbox) — the HTML-escaping review in the manual checklist is a
  code-level control verification, not a live browser exploit attempt.
