# PBRS Certification Threshold Addendum — PHX-CERT-003

**Addendum to:** `PBRS_CERTIFICATION_ARCHITECTURE_PHX_CERT_001.md` (PHX-CERT-001-R1)
**Also supersedes, on this specific point:** any statement in `PHX_CERT_002_IMPLEMENTATION_REPORT.md`, `PHX_CERT_002_QA_REPORT.md`, or `RELEASE_NOTES_PHX_CERT_002.md` describing the 70–72 Certification Level / Internal Tier gap as unresolved or as a display-suppression workaround.

---

## 1. Gap Now Resolved

`PBRS_CERTIFICATION_ARCHITECTURE_PHX_CERT_001.md` §6.4 documented a genuine three-point gap: scores of 70–72 were eligible for the client-facing **PBRS Foundation** Certification Level but resolved to **Not Certified** at the internal-metadata **Internal Tier** level, because Bronze did not begin until 73. PHX-CERT-002 addressed this only by suppressing the Internal Tier display for that band.

**As of PHX-CERT-003, this gap is resolved at the source**, not merely hidden in the UI.

## 2. Bronze Internal Tier Now Begins at 70

The Internal Tier floor for Bronze is lowered from 73 to 70 in `@phoenix/core`'s tier-derivation logic (`tierFromScore()`, which is now the system of record for `PBRSScore.tier`, replacing the prior `tierFromGrade(gradeFromScore(score))` path).

| Tier | Prior Floor | Current Floor (PHX-CERT-003) |
|---|---|---|
| Platinum | ≥ 93 | ≥ 93 *(unchanged)* |
| Gold | ≥ 87 | ≥ 87 *(unchanged)* |
| Silver | ≥ 80 | ≥ 80 *(unchanged)* |
| Bronze | ≥ 73 | **≥ 70** |
| Not Certified | < 73 | **< 70** |

## 3. Certification Level Thresholds Unchanged

PBRS Foundation (≥ 70), PBRS Practitioner (≥ 83), and PBRS Enterprise (≥ 92) — the client-facing, PRIMARY vocabulary established in PHX-CERT-001-R1 §6.1 and implemented in PHX-CERT-002 — are **not modified** by this addendum.

## 4. Internal Tier Thresholds Updated

Only the Bronze floor changed, per §2. Silver, Gold, and Platinum floors are unchanged. This is a change to the platform-default floor for Internal Tier derivation (an internal, system-facing vocabulary), not a change to any workspace-level override.

## 5. Safe Wording Unchanged

`PBRS_CERTIFICATION_SAFE_DISCLAIMER` and all safe-language requirements from `PBRS_CERTIFICATION_COMMERCIAL_LANGUAGE_GUIDE_PHX_CERT_001.md` and `PBRS_STANDARD_V1_0.md` §15.4 are unchanged. No new certification-facing copy implying third-party, regulatory, or government certification authority was introduced.

## 6. Client-Facing Language Unchanged

`PBRS_CERTIFICATION_UI_COPY_GUIDE_PHX_CERT_001.md`'s client-facing labels, list/table short labels, and eligibility-sentence patterns are unchanged. `Foundation` / `Practitioner` / `Enterprise` remain the only names a client sees; `Bronze` / `Silver` / `Gold` / `Platinum` remain internal-only.

## 7. PBRS Scoring Model Unchanged

The six scored PBRS dimensions, their weights, the aggregate score formula, `gradeFromScore()`, the PBRSGrade scale, and all three derived signals (Risk Level, Confidence Index, Automation Readiness) are unaffected by this addendum. Only Internal Tier *derivation* — a downstream labeling function applied to an already-computed overall score — changed.

## 8. Bronze Remains Internal-Only

This addendum does not reopen PHX-CERT-001-R1 §7's disposition of Bronze. Bronze (and Silver, Gold, Platinum) **shall not** appear as a standalone client-facing certification name or marketing tier. It continues to appear only as: internal metadata on Admin/Owner-context surfaces (where shown at all), the certification ID suffix (`formatCertificationId()`'s `BZ`/`SV`/`GD`/`PT` codes), and system-of-record data contracts.

## 9. Open Item Not Resolved by This Addendum

`PBRS_STANDARD_V1_0.md` §15.2 documents Internal Tier bands as "typical" minimums (Bronze ≥ 55, Silver ≥ 70, Gold ≥ 83, Platinum ≥ 90) that differ from the platform's actual code-level thresholds both before and after PHX-CERT-003. Reconciling the Standard document's tier table with the platform's implemented thresholds remains an open item tracked in `PBRS_STANDARD_ALIGNMENT_NOTES_PHX_STD_PBRS_ALIGN_001.md` §5, and is **not** resolved by this addendum.

## 10. Full Rationale

See `PHX_CERT_003_THRESHOLD_DECISION.md` for the complete options analysis (Options A–D), impact analysis, governance notes, and risk mitigations behind this decision.
