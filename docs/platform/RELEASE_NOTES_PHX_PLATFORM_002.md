# Phoenix Platform — Release Notes

## PHX-PLATFORM-002 — Backend Contract Definition

**Type:** Architecture / contract-definition sprint. No backend, database,
or authentication was implemented — this release defines the contract a
future backend must satisfy.

---

### Added

**TypeScript Contracts (`@phoenix/core`)**

New `packages/core/src/contracts/` module, barrel-exported from
`@phoenix/core`'s existing top-level `index.ts` (no existing export was
removed, renamed, or changed in behavior):

- `common.ts` — `UUID`, `ISODateTime`, `ISODate`, `PaginationParams`, `PaginatedResult<T>`, `ApiResult<T>`, `ApiError`, `BaseRecord`, `WorkspaceScoped`, `ActorRef`
- `enums.ts` — `UserRole`, `WorkspaceRole`, `AssetType`, `AssetStatus`, `AssessmentStatus`, `AssessmentStepStatus`, `RiskLevel`, `ReadinessGrade`, `CertificationStatus`, `PassportStatus`, `ReportStatus`, `EvidenceType`, `IntegrationStatus`, `ActivityType`
- `workspace.ts` — `Organization`, `Department`, `Workspace`, `WorkspaceSettings`, `WorkspaceMembership`
- `user.ts` — `User`, `UserWorkspaceSummary`
- `asset.ts` — `Asset`, `AssetVersion`
- `assessment.ts` — `Assessment`, `AssessmentStep`
- `evidence.ts` — `EvidenceItem`
- `pbrs-score.ts` — `PBRSDimensionScore`, `DerivedSignalValue`, `PBRSScoreRecord` (extends, does not duplicate, the existing `@phoenix/core` `PBRSScore`/`PBRSDimensionKey`/`PBRS_DIMENSIONS`)
- `passport.ts` — `PBRSPassport`
- `certification.ts` — `PBRSCertificationRecord` (extends, does not duplicate, the existing `@phoenix/core` `PBRSCertification`/`CertificationTier`)
- `report.ts` — `Report`, `ReportTemplate`
- `activity.ts` — `ActivityLog`, `Notification`, `Integration`
- `audit.ts` — `AuditRecord`

All 20 domain entities specified in the PHX-PLATFORM-002 brief are covered.

**Documentation (`/docs/platform/`)**

- `API_CONTRACT_PHX_PLATFORM_002.md` — full REST-style endpoint specification across workspaces, users, assets, assessments, evidence, PBRS score, passports, certifications, reports, and activity/audit.
- `DATABASE_SCHEMA_PHX_PLATFORM_002.md` — PostgreSQL schema draft for all 20 tables with columns, keys, indexes, and constraints.
- `DATA_LIFECYCLE_PHX_PLATFORM_002.md` — state machines for Asset, Assessment, Passport, Certification, and Report lifecycles.
- `PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md` — scoring input/output contract, draft grade/risk thresholds, override rules, and auditability requirements, aligned to the existing six-dimension PBRS model.
- `PERMISSIONS_MODEL_PHX_PLATFORM_002.md` — full role permission matrix across six workspace roles and ten action areas.
- `SAMPLE_DATA_MIGRATION_PLAN_PHX_PLATFORM_002.md` — current sample data → backend entity mapping, page-to-endpoint mapping, and a five-phase migration sequence.

### Changed

- `packages/core/src/index.ts` — appended one export statement (`export * from './contracts';`) at the end of the file. No existing exports, types, functions, or constants were modified.

### Unchanged (by design, per task constraints)

- No backend service, server, or database connection was added.
- No authentication was implemented.
- The public website (`apps/website`) was not touched.
- The platform UI (`apps/platform`) was not redesigned; `sample-data.ts` was not modified (migration is planned, not executed, per `SAMPLE_DATA_MIGRATION_PLAN_PHX_PLATFORM_002.md`).
- The PBRS six-dimension model, weights, and derived signals are unchanged — this contract only adds a persistence/audit shape around the existing model.
- No external vendors were introduced. `Integration.category` is intentionally generic (`DocumentSource` / `IdentityProvider` / `NotificationChannel` / `Other`) with no vendor names or SDKs referenced.

### Build Verification

`pnpm install`, `pnpm type-check`, `pnpm lint`, and `pnpm build` all pass
across `apps/website`, `apps/platform`, and `apps/dashboard`. See
`BUILD_REPORT_PHX_PLATFORM_002.md` for full output.
