// ============================================================
// Phoenix Platform — Async State Helpers
// PHX-PLATFORM-009 — Backend Integration Readiness Layer
// ------------------------------------------------------------
// Small, generic loading/error state shape and constructors for
// client components that will eventually call through the real API
// boundary (see api-config.ts / real-api-client.ts). This is a
// readiness utility, not a refactor of existing pages — most
// platform pages are Server Components that already `await` mock
// functions directly and do not need this. Reach for AsyncState<T>
// when adding a new client-side data fetch (e.g. a future
// client-driven mutation or polling UI).
// ============================================================

import type { PhoenixApiError } from './api-types';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: PhoenixApiError | null;
}

export function createIdleState<T>(): AsyncState<T> {
  return { status: 'idle', data: null, error: null };
}

export function createLoadingState<T>(previousData: T | null = null): AsyncState<T> {
  return { status: 'loading', data: previousData, error: null };
}

export function createSuccessState<T>(data: T): AsyncState<T> {
  return { status: 'success', data, error: null };
}

export function createErrorState<T>(error: PhoenixApiError, previousData: T | null = null): AsyncState<T> {
  return { status: 'error', data: previousData, error };
}

export const isIdle = <T>(state: AsyncState<T>): boolean => state.status === 'idle';
export const isLoading = <T>(state: AsyncState<T>): boolean => state.status === 'loading';
export const isSuccess = <T>(state: AsyncState<T>): boolean => state.status === 'success';
export const isError = <T>(state: AsyncState<T>): boolean => state.status === 'error';
