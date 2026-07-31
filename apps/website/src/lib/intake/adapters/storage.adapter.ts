// ============================================================
// Private storage adapter (Supabase Storage)
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §1.3)
// ------------------------------------------------------------
// Route handlers depend on the `StorageAdapter` interface. The live
// Supabase-backed implementation is never exercised in this sprint's
// QA (no hosted Supabase project/service-role key available) -- every
// storage test runs against createFakeStorageAdapter and is reported
// as an adapter/mock test.
//
// The bucket used (serverConfig.supabaseIntakeBucket) MUST be a
// private bucket -- this adapter never calls a "public URL" API and
// never sets a bucket to public. Object keys are always supplied by
// the caller (see ../object-key.ts) -- this module never derives a
// key from a filename.
//
// R1/R2: verifyObjectExists now returns the provider-recorded size
// and Content-Type metadata alongside size. Supabase Storage records
// the Content-Type the upload request DECLARED at PUT time -- this is
// not independent file-byte MIME sniffing/detection, and nothing in
// this codebase should describe it that way (PHX-LAUNCH-001-R2 §5).
// Completion must never trust a client-supplied contentType (see
// upload-flow.service.ts) -- only this provider-recorded value.
// FAIL CLOSED: if Supabase Storage's own object metadata is missing
// mimetype (which normally cannot happen -- Storage always records
// the type from the actual PUT's Content-Type -- but could in
// principle happen for an object uploaded through some other path),
// this adapter returns null (verification failure) rather than
// guessing or falling back to the declared type. There is no
// "trust the declared type instead" branch anywhere in this file.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { serverConfig } from '../config';

export interface SignedUploadUrl {
  uploadUrl: string;
  storageObjectKey: string;
  token: string;
}

export interface VerifiedObjectMetadata {
  sizeBytes: number;
  contentType: string;
}

export interface DeleteObjectResult {
  /** True when the object was deleted OR was already absent (idempotent success — see header comment). */
  success: boolean;
}

export interface StorageAdapter {
  /** Creates a one-time signed upload URL scoped to exactly one object key. */
  createSignedUploadUrl(objectKey: string): Promise<SignedUploadUrl>;
  /**
   * Verifies the object actually exists in the private bucket and
   * returns the provider-recorded size and Content-Type metadata, or
   * null if the object is absent OR the provider did not record a
   * usable content type (fail closed -- see header comment).
   */
  verifyObjectExists(objectKey: string): Promise<VerifiedObjectMetadata | null>;
  /**
   * R2 (§4.2): deletes exactly one orphaned (never-completed) object
   * from the private bucket. Narrowly scoped by design -- it takes
   * only an object key, never a prefix or wildcard, so it cannot be
   * used to delete more than the caller explicitly names. A "not
   * found" response from the provider counts as success (the object
   * is already gone, which is the desired end state) rather than a
   * failure -- this is what makes cleanup safely re-runnable. This
   * method must NEVER be called for a 'completed' reservation; the
   * caller (scripts/ops/intake-ops.ts) enforces that by construction,
   * only ever invoking this for rows already identified as orphaned.
   */
  deleteObject(objectKey: string): Promise<DeleteObjectResult>;
}

export function createLiveSupabaseStorageAdapter(): StorageAdapter {
  const client = createClient(serverConfig.supabaseUrl, serverConfig.supabaseServiceRoleKey);
  const bucket = serverConfig.supabaseIntakeBucket;

  return {
    async createSignedUploadUrl(objectKey: string): Promise<SignedUploadUrl> {
      const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(objectKey);
      if (error || !data) {
        throw new Error('storage_signed_url_failed');
      }
      return { uploadUrl: data.signedUrl, storageObjectKey: objectKey, token: data.token };
    },
    async verifyObjectExists(objectKey: string): Promise<VerifiedObjectMetadata | null> {
      const lastSlash = objectKey.lastIndexOf('/');
      const dir = objectKey.slice(0, lastSlash);
      const name = objectKey.slice(lastSlash + 1);
      const { data, error } = await client.storage.from(bucket).list(dir, { search: name });
      if (error || !data) return null;
      const match = data.find((entry) => entry.name === name);
      if (!match) return null;
      const sizeBytes = match.metadata?.size;
      const contentType = match.metadata?.mimetype;
      // Fail closed: both must be present and well-formed, or this
      // object cannot be verified at all.
      if (typeof sizeBytes !== 'number' || sizeBytes <= 0) return null;
      if (typeof contentType !== 'string' || contentType.length === 0) return null;
      return { sizeBytes, contentType };
    },
    async deleteObject(objectKey: string): Promise<DeleteObjectResult> {
      const { error } = await client.storage.from(bucket).remove([objectKey]);
      if (!error) return { success: true };
      // Supabase Storage returns a 404-shaped error for an
      // already-absent object -- treat that as success (idempotent),
      // any other error as a real, retriable failure.
      const status = (error as { statusCode?: string | number }).statusCode;
      if (status === '404' || status === 404) return { success: true };
      return { success: false };
    },
  };
}

export function createFakeStorageAdapter(): StorageAdapter & {
  signedUrlCalls: string[];
  simulatedObjects: Map<string, VerifiedObjectMetadata>;
  deleteCalls: string[];
  simulatedDeleteFailures: Set<string>;
  verifyObjectExistsCalls: string[];
} {
  const signedUrlCalls: string[] = [];
  const simulatedObjects = new Map<string, VerifiedObjectMetadata>();
  const deleteCalls: string[] = [];
  const simulatedDeleteFailures = new Set<string>();
  const verifyObjectExistsCalls: string[] = [];
  return {
    signedUrlCalls,
    simulatedObjects,
    deleteCalls,
    simulatedDeleteFailures,
    verifyObjectExistsCalls,
    async createSignedUploadUrl(objectKey: string): Promise<SignedUploadUrl> {
      signedUrlCalls.push(objectKey);
      const fakeToken = `fake-token-${signedUrlCalls.length}`;
      return {
        // R6: the token is embedded in the URL (as it would be for a
        // real Supabase signed upload URL) so that two calls for the
        // SAME object key -- e.g. an original sign and a same-key
        // retry after a lost response -- return genuinely DIFFERENT
        // URLs, matching real provider behavior; only storageObjectKey
        // is expected to be identical across such calls.
        uploadUrl: `https://fake-storage.test/upload/${objectKey}?token=${fakeToken}`,
        storageObjectKey: objectKey,
        token: fakeToken,
      };
    },
    async verifyObjectExists(objectKey: string) {
      // R7: tracked so QA can prove an idempotent completion replay
      // (§2) never calls this a second time for the same object key.
      verifyObjectExistsCalls.push(objectKey);
      return simulatedObjects.get(objectKey) ?? null;
    },
    async deleteObject(objectKey: string): Promise<DeleteObjectResult> {
      deleteCalls.push(objectKey);
      if (simulatedDeleteFailures.has(objectKey)) {
        return { success: false };
      }
      // Deleting an already-absent (or never-existed) object is a
      // no-op success, matching the live adapter's "not found is
      // idempotent success" contract.
      simulatedObjects.delete(objectKey);
      return { success: true };
    },
  };
}
