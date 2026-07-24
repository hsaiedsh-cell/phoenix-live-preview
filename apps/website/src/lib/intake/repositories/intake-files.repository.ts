// ============================================================
// public_intake_files repository
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Per-session file COUNT and TOTAL byte budget are enforced here in
// application code (see migration 0001's comment on
// public_intake_files: PostgreSQL CHECK constraints cannot express a
// cross-row aggregate). Per-file MIME allowlist and per-file size
// are enforced both here and by the database CHECK constraints
// (defense in depth).
// ============================================================

import { intakeQuery } from '../db';
import { UPLOAD_LIMITS } from '../config';

export interface IntakeFileRow {
  id: string;
  request_id: string;
  upload_session_id: string;
  storage_object_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  scan_status: 'pending_review' | 'cleared' | 'quarantined';
  created_at: Date;
}

export interface SessionFileTotals {
  fileCount: number;
  totalSizeBytes: number;
}

export async function getSessionTotals(uploadSessionId: string): Promise<SessionFileTotals> {
  const rows = await intakeQuery<{ file_count: string; total_size_bytes: string | null }>(
    `SELECT count(*) AS file_count, COALESCE(sum(size_bytes), 0) AS total_size_bytes
     FROM public_intake_files WHERE upload_session_id = $1`,
    [uploadSessionId]
  );
  return {
    fileCount: Number(rows[0]?.file_count ?? 0),
    totalSizeBytes: Number(rows[0]?.total_size_bytes ?? 0),
  };
}

export type FileAcceptanceDecision =
  | { accepted: true }
  | { accepted: false; reason: 'file_count_exceeded' | 'total_size_exceeded' | 'per_file_size_exceeded' | 'content_type_not_allowed' };

/** Pure decision function — no I/O — trivially unit-testable without a database. */
export function evaluateFileAcceptance(
  totals: SessionFileTotals,
  candidate: { sizeBytes: number; contentType: string }
): FileAcceptanceDecision {
  if (!(UPLOAD_LIMITS.allowedContentTypes as readonly string[]).includes(candidate.contentType)) {
    return { accepted: false, reason: 'content_type_not_allowed' };
  }
  if (candidate.sizeBytes > UPLOAD_LIMITS.maxFileSizeBytes) {
    return { accepted: false, reason: 'per_file_size_exceeded' };
  }
  if (totals.fileCount + 1 > UPLOAD_LIMITS.maxFiles) {
    return { accepted: false, reason: 'file_count_exceeded' };
  }
  if (totals.totalSizeBytes + candidate.sizeBytes > UPLOAD_LIMITS.maxTotalSizeBytes) {
    return { accepted: false, reason: 'total_size_exceeded' };
  }
  return { accepted: true };
}

export async function recordCompletedFile(input: {
  requestId: string;
  uploadSessionId: string;
  storageObjectKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<IntakeFileRow> {
  const rows = await intakeQuery<IntakeFileRow>(
    `INSERT INTO public_intake_files
       (request_id, upload_session_id, storage_object_key, original_filename, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.requestId,
      input.uploadSessionId,
      input.storageObjectKey,
      input.originalFilename,
      input.contentType,
      input.sizeBytes,
    ]
  );
  return rows[0];
}

export async function listFilesForSession(uploadSessionId: string): Promise<IntakeFileRow[]> {
  return intakeQuery<IntakeFileRow>(
    `SELECT * FROM public_intake_files WHERE upload_session_id = $1 ORDER BY created_at ASC`,
    [uploadSessionId]
  );
}
