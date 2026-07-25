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
// R1: verifyObjectExists now returns the PROVIDER-OBSERVED content
// type alongside size. Completion must never trust a client-supplied
// contentType (see upload-flow.service.ts) -- only this value.
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

export interface StorageAdapter {
  /** Creates a one-time signed upload URL scoped to exactly one object key. */
  createSignedUploadUrl(objectKey: string): Promise<SignedUploadUrl>;
  /**
   * Verifies the object actually exists in the private bucket and
   * returns the PROVIDER'S OWN observed size and content type, or
   * null if the object is absent OR the provider did not record a
   * usable content type (fail closed -- see header comment).
   */
  verifyObjectExists(objectKey: string): Promise<VerifiedObjectMetadata | null>;
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
  };
}

export function createFakeStorageAdapter(): StorageAdapter & {
  signedUrlCalls: string[];
  simulatedObjects: Map<string, VerifiedObjectMetadata>;
} {
  const signedUrlCalls: string[] = [];
  const simulatedObjects = new Map<string, VerifiedObjectMetadata>();
  return {
    signedUrlCalls,
    simulatedObjects,
    async createSignedUploadUrl(objectKey: string): Promise<SignedUploadUrl> {
      signedUrlCalls.push(objectKey);
      return {
        uploadUrl: `https://fake-storage.test/upload/${objectKey}`,
        storageObjectKey: objectKey,
        token: `fake-token-${signedUrlCalls.length}`,
      };
    },
    async verifyObjectExists(objectKey: string) {
      return simulatedObjects.get(objectKey) ?? null;
    },
  };
}
