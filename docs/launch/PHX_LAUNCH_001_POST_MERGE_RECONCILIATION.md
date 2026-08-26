# PHX-LAUNCH-001 — Post-Merge Release Reconciliation

## Document Purpose

This document reconciles the final hosted and post-merge state of
PHX-LAUNCH-001 with its earlier implementation reports.

The R1–R7 reports remain authoritative point-in-time evidence for the local
implementation and review stages in which they were written. They must not be
rewritten retrospectively.

This reconciliation supersedes only their statements about the later hosted,
provider, deployment, merge, and release state.

## Final Git Release State

- Pull request: `#5`
- Pull request title:
  `PHX-LAUNCH-001: Private Beta Request Intake & Secure Upload`
- Merge target: `main`
- Merge commit:
  `c041ba0759cb3e385758d910c590046273d9adfd`
- Approved Release Candidate:
  `4e11167892f803dad7b1103a79e16472a21c9c14`
- Annotated release tag:
  `phx-launch-001-private-beta`
- Release tag target:
  `c041ba0759cb3e385758d910c590046273d9adfd`
- Retired branch:
  `phx-launch-001`
- Retired branch status:
  deleted locally and remotely after merge and tagging

## Hosted Verification Completed

The following gates were executed after the original local implementation
reports were produced.

### Request Intake

- Real Cloudflare Turnstile challenge completed successfully.
- Legal consent was required.
- Marketing consent remained optional.
- Successful requests persisted to the hosted database.
- Public references were generated.
- Confirmation emails were received.
- Same-key idempotency returned the same request reference without sending a
  duplicate semantic email.
- Client-side validation and API validation failed closed.
- Database-backed IP rate limiting returned the expected `429`.
- Stale consent versions were rejected without database side effects.

### Secure Upload Lifecycle

- A real upload invitation was issued and delivered by email.
- The request moved to `under_review`.
- The invitation was expiring, revocable, and single-use.
- A real private-storage upload completed successfully.
- File metadata and final request state were verified in the hosted database.
- Oversized files were rejected.
- Revoked sessions were rejected.
- Replacement sessions could be issued.
- Interrupted uploads could be recovered.
- Cancelled reservations released quota.
- Finalization counted completed files only.
- Final request state became `files_received`.
- Final session state became `used`.

### Credential Transport and Request-Path Privacy

Live Vercel Runtime Log inspection established that bearer credentials placed
inside request paths would be retained in the platform `requestPath`.

The high-severity issue was resolved by changing the transport contract to:

- Invitation URL:
  `/upload#token=<credential>`
- Fixed API family:
  `/api/upload/session`
  and `/api/upload/session/*`
- API authentication:
  `Authorization: Bearer <credential>`

Live verification confirmed:

- only fixed upload request paths were retained;
- the bearer credential was absent from Vercel Runtime Logs;
- legacy `/upload/[token]` and `/api/upload/[token]` routes were removed;
- upload pages retained `no-store`, `no-referrer`, and `noindex` protections.

### Monitoring and Sentry Privacy

- A controlled Sentry error was ingested successfully.
- Public responses remained generic and carried a safe request ID.
- Request bodies, query values, authorization data, cookies, and synthetic
  private markers were absent from the captured event.
- `server_name` infrastructure identity metadata was removed in application
  sanitization.
- Sentry Advanced Data Scrubbing removed `$user.geo.**`.
- The final controlled event retained safe correlation tags while containing no
  tested synthetic private values, infrastructure IP, or geography value.
- `SENTRY_DSN` is retained as a general Preview environment variable rather
  than a retired-branch override.

### Browser and Visual Verification

- Public website desktop and mobile smoke checks passed.
- Privacy and Terms readability checks passed.
- Request-intake browser validation passed.
- Secure upload initiation, upload, finalization, receipt, and single-use
  behavior passed in a real browser.

Formal automated WCAG/axe browser testing was not completed and remains a
separate quality gate.

## Release and Deployment Containment

Merging into `main` caused Vercel to create the first Production deployment
for the project.

The deployment had no Production environment variables and was not authorized
as a public Production launch.

Containment actions completed:

- public Production aliases were removed;
- anonymous requests to the removed aliases returned `404`;
- the unique deployment URL and remaining Preview URLs required Vercel
  authentication;
- anonymous access tests returned protected redirects;
- automatic assignment of custom Production domains was disabled;
- no `phoenixops.ai` custom domain was assigned;
- no Production secrets were added;
- the repository remained clean and synchronized.

The retained deployment is therefore a protected build, not an authorized
public Production release.

## Final PHX-LAUNCH-001 Classification

```text
Merged: yes
Tagged: yes
Hosted-provider QA: completed for the approved Private Beta flow
Public Production launch: no
Anonymous access: contained
Production secrets: absent
Production DNS: absent
Legal publication approval: still required
```

Final status:

```text
PHX-LAUNCH-001 — MERGED, TAGGED, PROTECTED, AND CLOSED
```

## Remaining Stops

The following remain outside the PHX-LAUNCH-001 authorization:

- final legal entity and operating-name confirmation;
- final UAE court, forum, or free-zone jurisdiction confirmation;
- qualified UAE legal review;
- public Production launch authorization;
- Production secrets;
- Production DNS and `phoenixops.ai`;
- unrestricted registration or onboarding;
- formal automated browser accessibility audit.

These stops are not waived by the successful Private Beta technical release.
