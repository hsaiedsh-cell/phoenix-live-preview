# PHX-LAUNCH-001-R5 — Legal Draft Review Notes

## Status: DRAFT. Not legal advice. Not approved for publication. Unchanged from the original sprint, R1, R2, R3, and R4.

This revision (R5) made **no changes** to `apps/website/src/app/privacy/page.tsx`,
`apps/website/src/app/terms/page.tsx`, or the consent-version constants in
`apps/website/src/lib/intake/config.ts` — `git diff` between the R5 starting
HEAD (`57b5203`) and the final HEAD confirms all three are untouched (empty
diff). The two mandatory publishing stops remain fully open:

## 1. "PheonixOPS" spelling — still unresolved

R5's corrections were entirely to upload-session reissue, email
idempotency, finalization/reservation lifecycle, client-side entry
identity and state refresh, sign-request idempotency, monitoring privacy,
and bearer-token page/response protections — none of it touches legal page
content. The mandatory stop stands unchanged:

**Do not publish either page until the owner confirms** whether
"PheonixOPS" is the intentional legal name (vs. "PhoenixOPS") and confirms
the legal entity/form behind it.

## 2. UAE governing law / dispute forum — still unresolved

Both drafts still state the placeholder governing-law text with the same
explicit `[DRAFT PLACEHOLDER — PENDING OWNER CONFIRMATION]` marker and the
same no-court/emirate/ADGM/DIFC-invented language. R5 did not add, remove,
or alter this text in any way.

**Do not publish either page until** the owner confirms the exact forum and
qualified UAE counsel has reviewed the final wording.

## 3. Recommended next step (unchanged)

Route both drafts to qualified UAE counsel alongside the owner's
confirmation of items 1 and 2 above, exactly as recommended in the original
review notes and reaffirmed, unchanged, in R1 through R4. R5 does not
change this recommendation. Per the R5 addendum's own framing, this is
also a good point to confirm both items before or during the next phase
(Preview deployment), since a real, browsable Preview URL is exactly the
kind of artifact that tends to surface "wait, is this actually ready to
be public-facing?" questions.
