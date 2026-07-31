# PHX-LAUNCH-001-R6 — Legal Draft Review Notes

## Status: DRAFT. Not legal advice. Not approved for publication. Unchanged from the original sprint, R1, R2, R3, R4, and R5.

This revision (R6) made **no changes** to `apps/website/src/app/privacy/page.tsx`,
`apps/website/src/app/terms/page.tsx`, or the consent-version constants in
`apps/website/src/lib/intake/config.ts` — `git diff` between the R6 starting
HEAD (`97f6a0b`) and the final HEAD confirms all three are untouched (empty
diff). The two mandatory publishing stops remain fully open:

## 1. "PheonixOPS" spelling — still unresolved

R6's corrections were entirely to client-side upload recovery UI (retry
wiring, cancellation safety, and state reconciliation) — none of it
touches legal page content. The mandatory stop stands unchanged:

**Do not publish either page until the owner confirms** whether
"PheonixOPS" is the intentional legal name (vs. "PhoenixOPS") and confirms
the legal entity/form behind it.

## 2. UAE governing law / dispute forum — still unresolved

Both drafts still state the placeholder governing-law text with the same
explicit `[DRAFT PLACEHOLDER — PENDING OWNER CONFIRMATION]` marker and the
same no-court/emirate/ADGM/DIFC-invented language. R6 did not add, remove,
or alter this text in any way.

**Do not publish either page until** the owner confirms the exact forum and
qualified UAE counsel has reviewed the final wording.

## 3. Recommended next step (unchanged)

Route both drafts to qualified UAE counsel alongside the owner's
confirmation of items 1 and 2 above, exactly as recommended in the original
review notes and reaffirmed, unchanged, in R1 through R5. R6 does not
change this recommendation.
