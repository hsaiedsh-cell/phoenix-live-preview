# PHX-LAUNCH-001-R1 — Legal Draft Review Notes

## Status: DRAFT. Not legal advice. Not approved for publication. Unchanged from the original sprint.

This revision (R1) made **no changes** to `apps/website/src/app/privacy/page.tsx`
or `apps/website/src/app/terms/page.tsx` — `git diff` between the R1 starting
HEAD (`3b2436e`) and the final HEAD confirms both files are untouched. The
two mandatory publishing stops from the original sprint remain fully open:

## 1. "PheonixOPS" spelling — still unresolved

The owner-supplied spelling **"PheonixOPS"** is still preserved verbatim in
both draft pages. Nothing in R1 touched, corrected, or reinterpreted this
spelling. The mandatory stop from the original review notes stands
unchanged:

**Do not publish either page until the owner confirms** whether
"PheonixOPS" is the intentional legal name (vs. "PhoenixOPS") and confirms
the legal entity/form behind it.

## 2. UAE governing law / dispute forum — still unresolved

Both drafts still state the placeholder governing-law text naming the
United Arab Emirates generally, with the same explicit `[DRAFT
PLACEHOLDER — PENDING OWNER CONFIRMATION]` marker and the same
no-court/emirate/ADGM/DIFC-invented language. R1 did not add, remove, or
alter this text in any way.

**Do not publish either page until** the owner confirms the exact forum
and qualified UAE counsel has reviewed the final wording.

## 3. What R1 did instead

R1's corrections were entirely to the request-intake and file-upload
*application logic* (concurrency, idempotency, monitoring privacy, email
safety, operations tooling) — none of it touches the legal page content,
the draft-notice banners, or the consent-capture mechanism on `/contact`
(which still records `privacyVersion`/`termsVersion` exactly as before; the
version constants `CURRENT_PRIVACY_VERSION`/`CURRENT_TERMS_VERSION` in
`src/lib/intake/config.ts` are also unchanged by R1).

## 4. Recommended next step (unchanged)

Route both drafts to qualified UAE counsel alongside the owner's
confirmation of items 1 and 2 above, exactly as recommended in the
original review notes. R1 does not change this recommendation.
