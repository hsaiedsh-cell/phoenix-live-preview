// ============================================================
// Phoenix Backend — Route Registration
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Central place where every route module is mounted onto the Express app.
// Health/version/readiness are the only fully-active endpoints this
// sprint; the rest are documented NOT_IMPLEMENTED stubs (see each
// module's file header) — no fake business persistence is added.
// ============================================================

import type { Express } from 'express';
import { apiHealthRouter, plainHealthRouter } from './health';
import { versionRouter } from './version';
import { readinessRouter } from './readiness';
import { workspacesRouter } from './workspaces';
import { assessmentsRouter } from './assessments';
import { passportsRouter } from './passports';
import { certificationsRouter } from './certifications';
import { reportsRouter } from './reports';
import { activityRouter } from './activity';
import { auditRouter } from './audit';
import { intakeOperationsRouter } from './intake-operations';
import { intakeProvisioningRouter } from './intake-provisioning';

export function registerRoutes(app: Express): void {
  // Foundation endpoints — active this sprint.
  app.use(plainHealthRouter); // GET /health
  app.use('/api', apiHealthRouter); // GET /api/health
  app.use('/api', versionRouter); // GET /api/version
  app.use('/api', readinessRouter); // GET /api/readiness

  // Read/write endpoints implemented against the real database —
  // see each module's file header for exactly which routes are live
  // vs. still a documented NOT_IMPLEMENTED (501) stub.
  app.use('/api', workspacesRouter);
  app.use('/api', assessmentsRouter);
  app.use('/api', passportsRouter);
  app.use('/api', certificationsRouter);
  app.use('/api', reportsRouter);
  // PHX-BACKEND-008: GET /api/workspaces/:workspaceId/activity and
  // GET /api/workspaces/:workspaceId/audit-records are now
  // implemented, read-only, requiring an actor with audit.read — see
  // each module's file header.
  app.use('/api', activityRouter);
  app.use('/api', auditRouter);
  app.use('/api', intakeOperationsRouter);
  app.use('/api', intakeProvisioningRouter);
}
