// ============================================================
// Phoenix Backend — Report Artifact Store
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Provider-neutral artifact storage boundary + a safe local-development
// adapter. Cloud object storage, signed URLs, and bucket provisioning
// are explicitly out of scope for this sprint (task brief §5) — only
// the interface and a local filesystem adapter exist today.
//
// ---- Key generation is server-only ------------------------------------
// buildReportArtifactKey() is the ONLY place a storage key is ever
// constructed, and it is deterministic
// (reports/<reportId>/v<reportVersion>/artifact.<ext> — Phase 1
// Addendum A §4, corrected from a random-UUID suffix specifically so
// restart reconciliation is tractable: a deterministic key means a file
// found on disk can be matched back to the (report_id, report_version)
// it belongs to without needing a durable record of a random component
// that might not have survived a crash). No client input ever reaches
// this function or any storage key.
//
// ---- Path-traversal prevention -----------------------------------------
// Even though keys are always server-generated (never client input),
// every local-adapter operation resolves the final path via path.join()
// and asserts the result stays within the configured storage root before
// touching the filesystem — defense in depth, not reliance on "the key
// happens to be safe today".
//
// ---- Atomic write ------------------------------------------------------
// write() writes to a temporary path under <root>/.tmp/ then
// fs.renameSync()s into the final key path — atomic on the same
// filesystem/volume, so no partial file is ever visible at the final
// key (task brief §4.5).
//
// ---- Fail-closed production default ------------------------------------
// getReportArtifactStore() resolves to the local adapter whenever
// REPORT_STORAGE_LOCAL_DIR is configured (the only supported adapter
// this sprint) regardless of NODE_ENV — there is no cloud adapter to
// prefer instead. If REPORT_STORAGE_LOCAL_DIR resolution itself somehow
// fails (e.g. the configured directory cannot be created), the disabled
// adapter is used instead, and every one of its methods throws a clear
// ArtifactStoreNotConfiguredError — the generation service catches this
// and marks the job/report Failed with a sanitized reason (never crashes
// the process), matching config/env.ts's "never throws at
// config-resolution time, fails closed at the point of use" philosophy.
// ============================================================

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getReportWorkerConfig } from '../config/report-worker-env';

export class ArtifactStoreNotConfiguredError extends Error {
  constructor() {
    super('Report artifact storage is not configured. No supported artifact store adapter is available.');
    this.name = 'ArtifactStoreNotConfiguredError';
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(key: string) {
    super(`Artifact not found for key: ${key}`);
    this.name = 'ArtifactNotFoundError';
  }
}

export class ArtifactTooLargeError extends Error {
  constructor(actualBytes: number, maxBytes: number) {
    super(`Artifact of ${actualBytes} bytes exceeds the configured maximum of ${maxBytes} bytes.`);
    this.name = 'ArtifactTooLargeError';
  }
}

export interface ReportArtifactStoreWriteResult {
  sha256: string;
  sizeBytes: number;
}

/**
 * Provider-neutral artifact store boundary (task brief §4.5). All
 * methods operate on server-generated keys only — never accept a raw
 * client-supplied path/filename.
 */
export interface ReportArtifactStore {
  write(input: { key: string; bytes: Buffer; maxBytes: number }): Promise<ReportArtifactStoreWriteResult>;
  /**
   * Reads the full artifact into memory, enforcing maxBytes
   * independently of any stored metadata (Phase 1 Addendum B §4) —
   * throws ArtifactTooLargeError if the file on disk is larger than
   * maxBytes, ArtifactNotFoundError if it does not exist/cannot be
   * read.
   */
  readAll(input: { key: string; maxBytes: number }): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Deterministic, server-only storage key for one report version's
 * artifact. See file header for why this is deterministic rather than
 * randomly suffixed.
 */
export function buildReportArtifactKey(reportId: string, reportVersion: number, format: 'pdf' | 'html' | 'csv'): string {
  return `reports/${reportId}/v${reportVersion}/artifact.${format}`;
}

function assertWithinRoot(root: string, candidate: string): void {
  const resolvedRoot = resolve(root) + sep;
  const resolvedCandidate = resolve(candidate);
  if (!(resolvedCandidate + sep).startsWith(resolvedRoot) && resolvedCandidate !== resolve(root)) {
    throw new Error(`Refusing to operate outside the configured artifact storage root: ${candidate}`);
  }
}

/**
 * Explicit key-format guard, checked BEFORE any path resolution.
 * path.join() alone already prevents an absolute-looking key
 * (`/etc/x`) from ever escaping the storage root (Node re-interprets a
 * leading `/` in a join() argument as a relative segment, not a jump to
 * filesystem root — verified in QA), so this is defense-in-depth
 * clarity, not a fix for an actual escape: a key that LOOKS like an
 * absolute path or contains a `..` segment is rejected outright with a
 * clear error, rather than being silently reinterpreted as a safe
 * nested subpath. Keys are always server-generated (see
 * buildReportArtifactKey()) and never derived from client input, so
 * this should never actually fire in normal operation.
 */
function assertKeyFormat(key: string): void {
  if (key.startsWith('/') || key.startsWith('\\')) {
    throw new Error(`Refusing to operate on an absolute-looking storage key: ${key}`);
  }
  if (key.split(/[/\\]/).some((segment) => segment === '..')) {
    throw new Error(`Refusing to operate on a storage key containing a traversal segment: ${key}`);
  }
}

/**
 * Local filesystem adapter — local/dev only (task brief §4.5). Storage
 * root comes from validated env config (config/report-worker-env.ts).
 * Generated files are never committed to Git (see root .gitignore).
 */
class LocalReportArtifactStore implements ReportArtifactStore {
  constructor(private readonly root: string) {}

  private resolvePath(key: string): string {
    assertKeyFormat(key);
    const candidate = join(this.root, key);
    assertWithinRoot(this.root, candidate);
    return candidate;
  }

  async write(input: { key: string; bytes: Buffer; maxBytes: number }): Promise<ReportArtifactStoreWriteResult> {
    if (input.bytes.byteLength > input.maxBytes) {
      throw new ArtifactTooLargeError(input.bytes.byteLength, input.maxBytes);
    }

    const finalPath = this.resolvePath(input.key);
    const tmpDir = join(this.root, '.tmp');
    assertWithinRoot(this.root, tmpDir);
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(dirname(finalPath), { recursive: true });

    const tmpPath = join(tmpDir, `${randomUUID()}.tmp`);
    writeFileSync(tmpPath, input.bytes);
    // Atomic on the same filesystem/volume — no partial file is ever
    // visible at finalPath.
    renameSync(tmpPath, finalPath);

    // Belt-and-suspenders: re-read the just-renamed file's bytes to
    // compute the checksum from what is ACTUALLY on disk, not from the
    // in-memory buffer before write (catches a truncated/corrupted
    // write that renameSync itself wouldn't detect).
    const writtenBytes = readFileSync(finalPath);
    const sha256 = createHash('sha256').update(writtenBytes).digest('hex');

    return { sha256, sizeBytes: writtenBytes.byteLength };
  }

  async readAll(input: { key: string; maxBytes: number }): Promise<Buffer> {
    const path = this.resolvePath(input.key);
    if (!existsSync(path)) {
      throw new ArtifactNotFoundError(input.key);
    }
    const stat = statSync(path);
    if (stat.size > input.maxBytes) {
      throw new ArtifactTooLargeError(stat.size, input.maxBytes);
    }
    try {
      return readFileSync(path);
    } catch {
      throw new ArtifactNotFoundError(input.key);
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.resolvePath(key);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolvePath(key));
  }

  /** Non-interface helper used only by the reconciliation sweep to enumerate on-disk files without loading them into memory. */
  createReadStreamForReconciliation(key: string) {
    return createReadStream(this.resolvePath(key));
  }

  get storageRoot(): string {
    return this.root;
  }
}

/** Fail-closed adapter — every method throws. Used when no supported store could be resolved. */
class DisabledReportArtifactStore implements ReportArtifactStore {
  async write(): Promise<ReportArtifactStoreWriteResult> {
    throw new ArtifactStoreNotConfiguredError();
  }
  async readAll(): Promise<Buffer> {
    throw new ArtifactStoreNotConfiguredError();
  }
  async delete(): Promise<void> {
    throw new ArtifactStoreNotConfiguredError();
  }
  async exists(): Promise<boolean> {
    throw new ArtifactStoreNotConfiguredError();
  }
}

let cachedStore: ReportArtifactStore | undefined;
let cachedStoreRoot: string | undefined;

/**
 * Resolves the active ReportArtifactStore. Never throws itself (matches
 * config/env.ts's "resolution never throws" contract) — a resolution
 * failure (e.g. the configured directory cannot be created) results in
 * the DisabledReportArtifactStore being returned instead, whose methods
 * throw ArtifactStoreNotConfiguredError at the point of use.
 */
export function getReportArtifactStore(): ReportArtifactStore {
  const config = getReportWorkerConfig();

  if (cachedStore && cachedStoreRoot === config.storageLocalDir) {
    return cachedStore;
  }

  try {
    const root = resolve(config.storageLocalDir);
    mkdirSync(root, { recursive: true });
    cachedStore = new LocalReportArtifactStore(root);
    cachedStoreRoot = config.storageLocalDir;
    return cachedStore;
  } catch {
    cachedStore = new DisabledReportArtifactStore();
    cachedStoreRoot = config.storageLocalDir;
    return cachedStore;
  }
}

/** Exposed for the reconciliation sweep only, which needs filesystem enumeration beyond the ReportArtifactStore interface's scope. */
export function getLocalReportArtifactStoreRootForReconciliation(): string | null {
  const store = getReportArtifactStore();
  return store instanceof LocalReportArtifactStore ? store.storageRoot : null;
}
