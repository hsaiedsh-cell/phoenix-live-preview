// ============================================================
// Private storage adapter (Supabase Storage)
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Route handlers depend on the `StorageAdapter` interface. The live
// Supabase-backed implementation is never exercised in this sprint's
// QA (no hosted Supabase project/service-role key available) — every
// storage test in Gate 6 runs against createFakeStorageAdapter and
// is reported as an adapter/mock test.
//
// The bucket used (serverConfig.supabaseIntakeBucket) MUST be a
// private bucket — this adapter never calls a "public URL" API and
// never sets a bucket to public. Object keys are always supplied by
// the caller (see ../object-key.ts) — this module never derives a
// key from a filename.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { serverConfig } from '../config';

export interface SignedUploadUrl {
  uploadUrl: string;
  storageObjectKey: string;
  token: string;
}

export interface StorageAdapter {
  /** Creates a one-time signed upload URL scoped to exactly one object key. */
  createSignedUploadUrl(objectKey: string): Promise<SignedUploadUrl>;
  /** Verifies the object actually exists in the private bucket and returns its real size, or null if absent. */
  verifyObjectExists(objectKey: string): Promise<{ sizeBytes: number } | null>;
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
    async verifyObjectExists(objectKey: string): Promise<{ sizeBytes: number } | null> {
      const lastSlash = objectKey.lastIndexOf('/');
      const dir = objectKey.slice(0, lastSlash);
      const name = objectKey.slice(lastSlash + 1);
      const { data, error } = await client.storage.from(bucket).list(dir, { search: name });
      if (error || !data) return null;
      const match = data.find((entry) => entry.name === name);
      if (!match) return null;
      return { sizeBytes: match.metadata?.size ?? 0 };
    },
  };
}

export function createFakeStorageAdapter(): StorageAdapter & {
  signedUrlCalls: string[];
  simulatedObjects: Map<string, { sizeBytes: number }>;
} {
  const signedUrlCalls: string[] = [];
  const simulatedObjects = new Map<string, { sizeBytes: number }>();
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
