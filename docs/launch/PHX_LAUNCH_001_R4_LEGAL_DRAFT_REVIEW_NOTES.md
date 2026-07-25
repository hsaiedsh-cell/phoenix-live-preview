# PHX-LAUNCH-001-R4 — Legal Draft Review Notes

## Status: DRAFT. Not legal advice. Not approved for publication. Unchanged from the original sprint, R1, R2, and R3.

This revision (R4) made **no changes** to `apps/website/src/app/privacy/page.tsx`,
`apps/website/src/app/terms/page.tsx`, or the consent-version constants in
`apps/website/src/lib/intake/config.ts` — `git diff` between the R4 starting
HEAD (`e6f4210`) and the final HEAD confirms all three are untouched (empty
diff). The two mandatory publishing stops remain fully open:

## 1. "PheonixOPS" spelling — still unresolved

R4's corrections were entirely to upload-session state reporting, reservation
retry/cancellation, post-commit reliability, operational event handling,
internal-route input validation, monitoring privacy, and the Turnstile
hostname/action contract — none of it touches legal page content. The
mandatory stop stands unchanged:

**Do not publish either page until the owner confirms** whether
"PheonixOPS" is the intentional legal name (vs. "PhoenixOPS") and confirms
the legal entity/form behind it.

## 2. UAE governing law / dispute forum — still unresolved

Both drafts still state the placeholder governing-law text with the same
explicit `[DRAFT PLACEHOLDER — PENDING OWNER CONFIRMATION]` marker and the
same no-court/emirate/ADGM/DIFC-invented language. R4 did not add, remove,
or alter this text in any way.

**Do not publish either page until** the owner confirms the exact forum and
qualified UAE counsel has reviewed the final wording.

## 3. Recommended next step (unchanged)

Route both drafts to qualified UAE counsel alongside the owner's
confirmation of items 1 and 2 above, exactly as recommended in the original
review notes and reaffirmed, unchanged, in R1, R2, and R3. R4 does not change
this recommendation.
