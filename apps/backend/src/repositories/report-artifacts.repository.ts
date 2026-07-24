// ============================================================
// Phoenix Backend — Report Artifacts Repository
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only functions against
// report_artifacts (migration 0006_report_artifacts.sql). INSERT-only —
// there is no UPDATE/DELETE-by-application-code path here; the table is
// immutable metadata, matching audit_records' append-only discipline.
// storage_key/sha256 are never returned to any route that builds a
// public API response body — see reports.repository.ts's canonical read
// model, which deliberately omits both.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';

type Queryable = Pool | PoolClient;

export interface ReportArtifactRecord {
  id: string;
  reportId: string;
  reportVersion: number;
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

interface ReportArtifactRow {
  id: string;
  report_id: string;
  report_version: number;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: string; // BIGINT comes back as string from pg by default
  sha256: string;
  created_at: string;
}

function mapReportArtifactRow(row: ReportArtifactRow): ReportArtifactRecord {
  return {
    id: row.id,
    reportId: row.report_id,
    reportVersion: row.report_version,
    storageKey: row.storage_key,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

export interface CreateReportArtifactInput {
  reportId: string;
  reportVersion: number;
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Inserts one immutable report_artifacts row. Callers must only call
 * this AFTER the artifact store's write has already succeeded (see
 * services/report-generation.service.ts) — this function performs only
 * the insert, no storage I/O. A unique-violation on
 * (report_id, report_version) indicates this version already has an
 * artifact row (should be unreachable in normal operation, since a new
 * job always corresponds to a freshly-incremented version) and is
 * rethrown for the caller's existing unique-violation handling.
 */
export async function createReportArtifact(
  input: CreateReportArtifactInput,
  client: PoolClient
): Promise<ReportArtifactRecord> {
  const result = await client.query<ReportArtifactRow>(
    `INSERT INTO report_artifacts (
       report_id, report_version, storage_key, filename, content_type, size_bytes, sha256
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id, report_id, report_version, storage_key, filename, content_type,
       size_bytes, sha256, created_at`,
    [
      input.reportId,
      input.reportVersion,
      input.storageKey,
      input.filename,
      input.contentType,
      input.sizeBytes,
      input.sha256,
    ]
  );
  return mapReportArtifactRow(result.rows[0]);
}

/**
 * Fetches the artifact metadata row for exactly (reportId,
 * reportVersion) — used by the download endpoint (which only ever
 * downloads the CURRENT version, per the task brief) and by the
 * reconciliation sweep's "does metadata exist for this file's version"
 * check.
 */
export async function getReportArtifact(
  reportId: string,
  reportVersion: number,
  client: Queryable = getDatabasePool()
): Promise<ReportArtifactRecord | null> {
  const result = await client.query<ReportArtifactRow>(
    `SELECT id, report_id, report_version, storage_key, filename, content_type,
            size_bytes, sha256, created_at
     FROM report_artifacts
     WHERE report_id = $1 AND report_version = $2
     LIMIT 1`,
    [reportId, reportVersion]
  );
  const row = result.rows[0];
  return row ? mapReportArtifactRow(row) : null;
}

/** Lists every artifact-metadata row for a report (all versions) — QA/audit-history introspection use only; no route returns this list directly. */
export async function listReportArtifactsForReport(reportId: string): Promise<ReportArtifactRecord[]> {
  const pool = getDatabasePool();
  const result = await pool.query<ReportArtifactRow>(
    `SELECT id, report_id, report_version, storage_key, filename, content_type,
            size_bytes, sha256, created_at
     FROM report_artifacts
     WHERE report_id = $1
     ORDER BY report_version ASC`,
    [reportId]
  );
  return result.rows.map(mapReportArtifactRow);
}
