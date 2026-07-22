# PHX-AUTH-004 — Real Clerk QA on Unified Source Tree

**Status:** PASS — Real Clerk QA completed locally on unified source tree  
**Source tree:** PHX-DEPLOY-003-R1-HOSTED-PREVIEW-BLOCKER-RESOLUTION  
**Execution type:** Local machine / real Clerk / local PostgreSQL / production-auth mode  
**Public deployment:** Not performed  
**Hosted private preview:** Ready for next hosted execution sprint, subject to hosted environment setup  
**Public Deployment:** No-Go  
**Date:** July 21, 2026

---

## 1. Source Identity

QA was executed against the unified source tree from:

PHX-DEPLOY-003-R1-HOSTED-PREVIEW-BLOCKER-RESOLUTION

Confirmed source structure:

- apps/backend
- apps/platform
- packages
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml

---

## 2. Security Pre-Scan

Result: PASS

Confirmed before execution:

- No .env included in source package
- No .env.local included in source package
- No real Clerk secret included
- No raw JWT included
- No session cookie included
- No DATABASE_URL secret included
- No CORS wildcard found
- No dangerous dev-header production override enabled

Local .env files were created only on the operator machine and are not included in this report or package.

---

## 3. Build / Type / Lint

Result: PASS

Commands executed:

- pnpm install
- pnpm --filter @phoenix/backend type-check
- pnpm --filter @phoenix/backend lint
- pnpm --filter @phoenix/backend build
- pnpm --filter @phoenix/platform type-check
- pnpm --filter @phoenix/platform lint
- pnpm --filter @phoenix/platform build

Observed result:

- backend type-check: PASS
- backend lint: PASS
- backend build: PASS
- platform type-check: PASS
- platform lint: PASS
- platform build: PASS

Non-blocking warning:

- TypeScript version warning from @typescript-eslint was observed.
- Build completed successfully.

---

## 4. Database Setup

Result: PASS

Local PostgreSQL was used.

Commands executed:

- pnpm --filter @phoenix/backend db:migrate:dev
- pnpm --filter @phoenix/backend db:seed:dev
- pnpm --filter @phoenix/backend db:smoke:dev

Observed result:

- migrations applied / already applied
- seed completed
- database connected
- migrations table found
- applied migrations: 2
- public tables: 23
- auth_identities table present

No customer data was used.

---

## 5. Clerk to Phoenix Identity Mapping

Result: PASS

The real Clerk test user was linked to an existing Phoenix seeded user through auth_identities.

Confirmed:

- provider=clerk
- email_verified=true
- Phoenix user_id=00000004-1111-4111-8111-000000000001
- no new Phoenix user was created
- workspace role remains DB-derived

No Clerk secret key, raw token, or session cookie is included in this report.

---

## 6. Backend Readiness

Result: PASS

Backend was started locally on port 4000 with:

- PHOENIX_AUTH_MODE=oidc-jwt
- PHOENIX_AUTH_PROVIDER=clerk
- PHOENIX_AUTH_AUDIENCE=phoenix-backend
- PHOENIX_ENABLE_DATABASE=true
- PHOENIX_ALLOWED_ORIGINS=http://localhost:3001

Readiness endpoint:

- GET http://localhost:4000/api/readiness

Observed:

- HTTP 200
- database.status=connected
- auth.mode=oidc-jwt
- auth.status=enabled
- auth.productionSafe=true
- auth.provider=clerk
- cors.status=configured
- cors.allowedOriginsCount=1
- cors.wildcardAllowed=false

Health endpoint:

- GET http://localhost:4000/health

Observed:

- HTTP 200
- service=phoenix-backend
- status=healthy

---

## 7. CORS Runtime QA

Result: PASS

Configured allowed origin:

- http://localhost:3001

Allowed OPTIONS request:

- Origin: http://localhost:3001
- Result: PASS
- HTTP 204
- Access-Control-Allow-Origin: http://localhost:3001
- Vary: Origin
- Access-Control-Allow-Headers includes Authorization
- No wildcard

Disallowed OPTIONS request:

- Origin: https://evil.example.com
- Result: PASS
- No Access-Control-Allow-Origin
- No wildcard

Allowed GET request:

- Origin: http://localhost:3001
- Result: PASS
- HTTP 200
- Access-Control-Allow-Origin: http://localhost:3001
- Vary: Origin
- No wildcard

Disallowed GET request:

- Origin: https://evil.example.com
- Result: PASS
- HTTP 200
- No Access-Control-Allow-Origin
- No wildcard

---

## 8. Platform Production-Auth QA

Result: PASS

Platform was rebuilt after production-auth env configuration and started on port 3001.

Confirmed:

- production-auth mode active
- Clerk configuration present
- platform renders production-auth banner
- mock login is not used after rebuild
- live backend data is rendered
- no silent mock fallback on live-read pages

Known UI wording limitation:

- User menu still displays "Alpha Role Preview" wording.
- This appears to be a UI label carried over from alpha role tooling.
- It did not block production-auth live data verification.

---

## 9. Real Clerk Browser QA

Result: PASS

Real Clerk browser QA was executed locally.

Verified route: /dashboard

Observed:

- Production-auth is active
- Live backend data badge visible
- Total assessments: 4
- Statuses represented: 3
- Scored assessments: 2
- backend seeded assessment titles visible

Verified route: /assessments

Observed:

- Production-auth is active
- Live backend data badge visible
- 4 total assessments shown
- backend seeded assessment rows visible
- no mock fallback

Verified route: /assessments/[assessmentId]

Observed for Q3 Investor Update Draft:

- Live backend data badge visible
- Score: 87.15
- Grade: B+
- Risk: Low
- Confidence: 92%
- Automation readiness: 65%
- Six PBRS dimensions only:
  - Accuracy
  - Compliance
  - Brand Alignment
  - Structure
  - Consistency
  - Completeness
- Evidence items visible

Verified route: /settings

Observed:

- API mode: Production Auth (Clerk)
- Backend URL: http://localhost:4000
- Backend URL configured: yes
- Clerk publishable key configured: yes
- Clerk server key configured: yes
- Auth state: signed in
- Data source activity/audit: live
- Audit Preview live backend data
- 3 activity records
- 1 audit record

---

## 10. Preview-Only Pages

Result: PASS

Verified route: /passports

Observed:

- Preview-only label visible
- Message confirms live backend endpoint is not available
- Data shown is mock-backed, not real workspace data

Verified route: /certifications

Observed:

- Preview-only label visible
- Certification workflow warning visible
- No live certification endpoint claim

Verified route: /reports

Observed:

- Preview-only label visible
- Data shown is mock-backed, not real workspace data
- No live reports endpoint claim

---

## 11. Failure-State QA

Result: PARTIAL PASS

Backend stopped test:

- Result: PASS
- Route tested: /assessments
- Observed: Backend unavailable
- Message: Backend unavailable at http://localhost:4000. Is it running?
- No mock fallback occurred

No-token protected route test:

- Result: PASS
- Route tested: /api/workspaces/[workspaceId]/assessments
- Observed: HTTP 401 Unauthorized
- Error code: AUTH_REQUIRED
- Message: Missing required Authorization: Bearer <token> header

Signed-out test:

- Result: NOT TESTED
- Reason: Current UI did not expose a Clerk sign-out control. User menu still shows alpha role preview UI.
- Impact: Non-blocking for this local QA, but should be retested before hosted private preview.

Other failure states not tested in this local run:

- Missing Clerk publishable key
- Missing CLERK_SECRET_KEY
- Missing production workspace id
- Backend oidc-jwt missing config

These should be tested during hosted preview execution QA.

---

## 12. Auth Boundary Verification

Result: PASS

Confirmed:

- production-auth uses Authorization: Bearer flow
- platform source requests Clerk JWT template token: phoenix-backend
- backend accepts Clerk JWT template token
- auth_identities maps Clerk identity to Phoenix user
- workspace role and access remain DB-derived
- no Phoenix role/workspace authority is trusted from Clerk claims
- X-Phoenix-User-Id was not used for production-auth verification
- no raw token was pasted into this report
- no session cookie was pasted into this report

---

## 13. PBRS Integrity

Result: PASS

No PBRS scoring, dimension, or certification threshold changes were made.

Verified active dimensions:

- Accuracy
- Compliance
- Brand Alignment
- Structure
- Consistency
- Completeness

Public Deployment remains No-Go.

---

## 14. Final Result

PHX-AUTH-004 Real Clerk QA on Unified Source Tree: PASS

Final verified flow:

Real Clerk sign-in
→ Clerk JWT template phoenix-backend
→ Platform production-auth
→ Authorization Bearer token
→ Backend oidc-jwt verification
→ auth_identities mapping
→ DB-derived workspace permissions
→ live backend data
→ dashboard/assessments/detail/settings verified

---

## 15. Executive Decision

PHX-AUTH-004 is verified locally.

Recommended release label:

PHX-AUTH-004 — Real Clerk QA on Unified Source Tree RC1 / Local E2E Verified

Hosted Private Preview may proceed to the next execution planning step, but public deployment remains No-Go.

Public Deployment remains No-Go until hosted preview execution, security review, monitoring/logging, backup/restore, legal/domain/DNS, and remaining endpoint readiness are completed.
