# Release Notes — PHX-CERT-002

**Release label:** PHX-CERT-002 — Certification Level Implementation
**Builds on:** PHX-PLATFORM-005 (Evidence Traceability), PHX-CERT-001-R1 (Certification Tier Architecture, docs-only)

---

## What Changed

- **New `certification-levels.ts` helper module** (`apps/platform/src/lib`) — the single source of truth for deriving the client-facing **PBRS Certification Level** (`PBRS Foundation` / `PBRS Practitioner` / `PBRS Enterprise`) from a PBRS score, plus presentation helpers for labels, eligibility copy, and the 70–72 gap display rule.
- **`/certifications`** — the certified-assets table now includes a **Certification Level** column, leading with the client-facing name. Level cards were already correctly named and are unchanged. Disclaimer copy updated to the exact approved safe-language string.
- **`/passports`** — each `PassportCard` now leads with **`Certification Level: {level}`** (or **`Pending Certification`**) instead of the old ambiguous `Certified` / `Not Certified` status line. **Internal Tier** appears only as a small, optional secondary line, and is automatically suppressed for the documented 70–72 gap band. A safe-language disclaimer was added to the page.
- **`/assessments/[id]`** — the assessment header now shows a **Certification Eligibility** line (e.g. "Eligible for PBRS Foundation" / "Not eligible — remediation required"), derived from the score.
- **Fixture-text fix** — corrected two mock activity/audit-log entries that incorrectly read "Granted PBRS Platinum certification" (a vocabulary-conflating and factually-stale string) to "Granted PBRS Enterprise certification."

## What Was Preserved

- The PBRS scoring model, the six scored dimensions, and every dimension weight — byte-for-byte unchanged.
- `CertificationTier` (`Bronze | Silver | Gold | Platinum | Not Certified`) as the system-of-record tier for the certification-ID suffix and `PBRSCertificationRecord.tier` — unchanged, unrenamed.
- Bronze remains internal-tier-only; no "PBRS Candidate"/"PBRS Baseline" label was introduced.
- All existing view-model fields — every change in this sprint is additive.
- `apps/website` and `apps/dashboard` — untouched.
- No backend, database, or authentication was added.

## Architecture Notes

This sprint implements the naming architecture approved in `PBRS_CERTIFICATION_ARCHITECTURE_PHX_CERT_001.md`:

- **PBRS Certification Level** is client-facing and primary everywhere a certification-related label is shown.
- **PBRS Internal Tier** is system-facing, secondary metadata only — never a headline.
- The known 70–72-score gap (Foundation-eligible at the Certification Level, "Not Certified" at the Internal Tier because Bronze begins at 73) is handled with the documented interim workaround: Internal Tier is suppressed for that exact band rather than shown contradictorily beside a granted Foundation certification. This gap itself remains open and untouched, per the Architecture doc's explicit scope boundary.

## Known Limitations

- The 70–72 gap band has no live example in current sample data, so the suppression behavior is implemented and type-checked but not visually demonstrated in this sprint's screenshots.
- Reports (`/reports`) do not yet surface Certification Level text, since no current report content includes a certification-status line to update; the view model is ready (optional fields added) for whichever future sprint builds real report content.
- Internal Tier is omitted entirely (not just de-emphasized) from `/certifications`, per Architecture doc §8's "may appear... never as primary" language — a future sprint could add it as muted metadata behind a details disclosure if desired.

## Next Recommended Sprint

- Standards Committee review of the 70–72 gap (Architecture doc §6.4, §14) — either adjust Bronze's internal-tier floor or formally document the gap as permanent in a future minor revision of `PBRS_STANDARD_V1_0.md`.
- Wire Certification Level into real report content once `/reports` grows beyond "Coming Soon" placeholders.
- Consider adding Internal Tier as optional Admin/Owner-only metadata on `/certifications`, consistent with the Architecture doc's "Admin/Owner visibility" allowance (not built this sprint to avoid scope creep beyond the certification-level headline work).
