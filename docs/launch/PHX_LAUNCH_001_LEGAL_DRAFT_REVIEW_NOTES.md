# PHX-LAUNCH-001 — Legal Draft Review Notes

## Status: DRAFT. Not legal advice. Not approved for publication.

`apps/website/src/app/privacy/page.tsx` and `apps/website/src/app/terms/page.tsx`
are Private Beta drafts only. Both pages render a visible amber "Draft notice"
banner and are excluded from being treated as final anywhere in this codebase.

## 1. "PheonixOPS" spelling

The owner supplied the legal/operating name as **"PheonixOPS"** (note: not
"PhoenixOPS"). This exact spelling has been preserved verbatim in both draft
pages, per the execution package's explicit instruction, even though it differs
from the product name "Phoenix" used everywhere else on the site.

**Mandatory stop, not resolved by this sprint:** do not publish either page to
production until the owner confirms:
- whether "PheonixOPS" is the intentional legal name, or whether "PhoenixOPS" (or
  another spelling) was actually meant; and
- the legal form/entity status behind that name — e.g. a registered company, a
  free-zone entity, or the founder operating personally (Phase 1 Charter
  Section 16, item 7).

## 2. Governing law

Both drafts state the intended governing law as the United Arab Emirates, with a
clearly marked placeholder:

> [DRAFT PLACEHOLDER — PENDING OWNER CONFIRMATION] ... The specific Emirate,
> court, or free-zone forum (for example, Abu Dhabi courts, Dubai courts, ADGM, or
> DIFC) has not yet been selected...

No specific court, emirate, or free-zone forum (ADGM, DIFC, Abu Dhabi courts,
Dubai courts, or otherwise) has been invented, assumed, or selected by this
sprint. This is intentional, per the execution package's explicit instruction not
to invent a dispute forum.

**Mandatory stop, not resolved by this sprint:** the owner must confirm the exact
forum, and qualified UAE counsel must review the final wording, before either page
is published.

## 3. Scope of legal content drafted

Privacy Policy draft covers: information collected, purposes, service providers
(Vercel, Supabase, Resend, Cloudflare, Sentry), retention defaults, security
controls and limitations, cross-border processing, data-subject rights, Private
Beta limitations, governing law (placeholder), and contact.

Terms draft covers: Private Beta status, no guarantee of acceptance, manual
quotation/payment, customer's authority to upload content, prohibited content,
pre-agreement confidentiality limitations, IP ownership, service limitations,
cancellation/refunds, acceptable use, limitation of liability, governing law
(placeholder), and contact.

## 4. What this sprint did NOT do

- Did not consult or represent input from a lawyer.
- Did not determine whether UAE law is actually the correct or enforceable
  choice of law for this business (that determination belongs to the owner and
  counsel).
- Did not publish, deploy, or otherwise make either page reachable from
  production — they exist only in this reviewable branch.
- Did not add cookie-consent UI (out of scope per Phase 1 Charter Section 9 — no
  marketing analytics or advertising pixels during Private Beta).

## 5. Recommended next step

Route both drafts to qualified UAE counsel alongside the owner's confirmation of
items 1 and 2 above. Only after both are resolved should the placeholder text be
replaced with final wording and the "Draft notice" banners removed.
