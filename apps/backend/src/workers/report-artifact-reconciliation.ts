// ============================================================
// Phoenix Backend — Artifact Reconciliation Sweep
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Cleans up orphaned artifact files — a file on disk with no matching
// report_artifacts row. Run at worker startup and optionally on a
// periodic interval (see workers/report-generation-worker.ts).
//
// ---- Three-condition safety (Phase 1 Addendum B §1) --------------------
// A file is deleted ONLY when ALL THREE hold:
//   1. No report_artifacts row exists for its (report_id, report_version).
//   2. No valid (non-stale) Processing job/lease exists for the same
//      (report_id, report_version) — a file backing a job still
//      genuinely being processed is never touched, regardless of age.
//   3. The file is older than REPORT_ARTIFACT_RECONCILIATION_GRACE_SECONDS
//      (required to exceed the lease timeout — see
//      config/report-worker-env.ts's assertReportWorkerConfigSafe()) —
//      only a file old enough that no realistic in-flight worker could
//      still be mid-transaction on it is eligible.
// A file failing any one check is left alone, re-examined on the next
// sweep — never force-deleted on a single signal.
// ============================================================

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getReportWorkerConfig } from '../config/report-worker-env';
import { getLocalReportArtifactStoreRootForReconciliation, getReportArtifactStore } from '../storage/report-artifact-store';
import { getReportArtifact } from '../repositories/report-artifacts.repository';
import { hasValidProcessingLease } from '../repositories/report-jobs.repository';

interface CandidateFile {
  reportId: string;
  reportVersion: number;
  key: string;
  absolutePath: string;
}

/** Parses the deterministic reports/<reportId>/v<version>/artifact.<ext> key shape back into its (reportId, reportVersion) components. Returns null for any file that doesn't match this backend's own naming convention (never deleted — only files this backend itself could have written are ever candidates). */
function parseCandidate(root: string, reportId: string, versionDir: string, filename: string): CandidateFile | null {
  const match = /^v(\d+)$/.exec(versionDir);
  if (!match) return null;
  const reportVersion = Number.parseInt(match[1], 10);
  if (!Number.isInteger(reportVersion)) return null;
  if (!/^artifact\.(pdf|html|csv)$/.test(filename)) return null;

  const key = `reports/${reportId}/${versionDir}/${filename}`;
  return { reportId, reportVersion, key, absolutePath: join(root, key) };
}

function listCandidateFiles(root: string): CandidateFile[] {
  const candidates: CandidateFile[] = [];
  let reportDirs: string[];
  try {
    reportDirs = readdirSync(join(root, 'reports'));
  } catch {
    return candidates; // No reports/ directory yet — nothing to reconcile.
  }

  for (const reportId of reportDirs) {
    let versionDirs: string[];
    try {
      versionDirs = readdirSync(join(root, 'reports', reportId));
    } catch {
      continue;
    }
    for (const versionDir of versionDirs) {
      let filenames: string[];
      try {
        filenames = readdirSync(join(root, 'reports', reportId, versionDir));
      } catch {
        continue;
      }
      for (const filename of filenames) {
        const candidate = parseCandidate(root, reportId, versionDir, filename);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  return candidates;
}

export interface ReconciliationSummary {
  scanned: number;
  deleted: number;
  retainedNoMetadataButRecentOrLeased: number;
}

/**
 * Runs one reconciliation pass. Never throws for an individual file's
 * check failing — a file that can't be safely evaluated is left alone.
 */
export async function runArtifactReconciliation(): Promise<ReconciliationSummary> {
  const root = getLocalReportArtifactStoreRootForReconciliation();
  const config = getReportWorkerConfig();
  const summary: ReconciliationSummary = { scanned: 0, deleted: 0, retainedNoMetadataButRecentOrLeased: 0 };

  if (!root) return summary; // No local adapter configured — nothing to reconcile.

  const candidates = listCandidateFiles(root);
  const store = getReportArtifactStore();

  for (const candidate of candidates) {
    summary.scanned += 1;

    // Condition 1: no report_artifacts row for this exact (report_id, report_version).
    const artifact = await getReportArtifact(candidate.reportId, candidate.reportVersion);
    if (artifact) continue; // Has metadata — never a reconciliation target.

    // Condition 2: no valid (non-stale) Processing lease for this (report_id, report_version).
    const hasLease = await hasValidProcessingLease(candidate.reportId, candidate.reportVersion, config.leaseTimeoutSeconds);
    if (hasLease) {
      summary.retainedNoMetadataButRecentOrLeased += 1;
      continue;
    }

    // Condition 3: file is older than the configured grace period
    // (which is validated at boot to exceed the lease timeout).
    let ageSeconds: number;
    try {
      const stat = statSync(candidate.absolutePath);
      ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
    } catch {
      continue; // File vanished between listing and stat — nothing to do.
    }

    if (ageSeconds <= config.reconciliationGraceSeconds) {
      summary.retainedNoMetadataButRecentOrLeased += 1;
      continue;
    }

    // All three conditions hold — safe to delete.
    await store.delete(candidate.key);
    summary.deleted += 1;
  }

  return summary;
}
