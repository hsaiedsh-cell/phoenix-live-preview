// ============================================================
// @phoenix/core/contracts — Common Primitives
// PHX-PLATFORM-002 — Backend Contract Definition
// ------------------------------------------------------------
// Shared primitive types reused across every domain contract.
// No backend, database, or transport implementation lives here —
// contract types only.
// ============================================================

/** UUID v4 string identifier. */
export type UUID = string;

/** ISO 8601 date-time string, always UTC (e.g. "2026-07-07T12:00:00Z"). */
export type ISODateTime = string;

/** ISO 8601 calendar date string (e.g. "2026-07-07"), used where time-of-day is not meaningful. */
export type ISODate = string;

/** Standard cursor-based pagination request params. */
export interface PaginationParams {
  /** Opaque cursor returned by a previous page; omit for the first page. */
  cursor?: string;
  /** Max records to return. Default 25, max 100. */
  limit?: number;
}

/** Standard cursor-based pagination response envelope. */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  totalCount: number;
}

/** Standard success envelope for single-resource responses. */
export interface ApiResult<T> {
  data: T;
}

/** Standard error envelope. Every non-2xx response returns this shape. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Field-level validation issues, when applicable. */
    details?: Array<{ field: string; issue: string }>;
    requestId: string;
  };
}

/** Fields present on every soft-deletable, auditable record. */
export interface BaseRecord {
  id: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Soft delete marker. Null while active. */
  deletedAt: ISODateTime | null;
}

/** Fields present on every record scoped to a workspace. */
export interface WorkspaceScoped {
  workspaceId: UUID;
}

/** Minimal actor reference — who performed an action, for audit/attribution. */
export interface ActorRef {
  userId: UUID;
  displayName: string;
}
