// ============================================================
// Phoenix Backend — Website Intake Service Client
// PHX-LAUNCH-002-R2 — Operator Request Queue API
// ------------------------------------------------------------
// Typed, fail-closed service boundary from the authenticated Phoenix
// Backend to the Website-owned Private Beta intake data.
//
// Security and reliability contract:
// - fixed configured origin and fixed internal route templates only;
// - dedicated Bearer credential, never the legacy ops secret;
// - bounded correlation id on every request;
// - database-derived actor UUID only on status-action requests;
// - one AbortController timeout covering fetch and response reading;
// - no retries, especially for status actions;
// - strict response validation before any data is returned;
// - no logging of bodies, URLs, customer data, credentials, or config.
// ============================================================

import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { z, type ZodType } from 'zod';
import {
  getBackendEnv,
  isIntakeServiceConfigured,
  type PhoenixIntakeServiceConfig,
} from '../config/env';

const MAX_INTAKE_SERVICE_RESPONSE_BYTES = 1_000_000;
const SERVICE_SECRET_PATTERN = /^[\x21-\x2B\x2D-\x7E]+$/;
const SERVICE_REQUEST_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const intakeRequestStatusSchema = z.enum([
  'received',
  'under_review',
  'upload_invited',
  'files_received',
  'quoted',
  'accepted',
  'rejected',
  'closed',
]);

const intakeRequestTypeSchema = z.enum([
  'assessment',
  'demo',
  'general',
]);

const uploadSessionStatusSchema = z
  .enum(['active', 'used', 'revoked', 'expired'])
  .nullable();

const operatorActionSchema = z.enum([
  'under_review',
  'reject',
  'quote',
  'accept',
  'close',
]);

const serviceRequestIdSchema = z
  .string()
  .regex(SERVICE_REQUEST_ID_PATTERN);

const operatorQueueItemSchema = z
  .object({
    requestId: z.string().uuid(),
    publicReference: z.string().min(1).max(100),
    status: intakeRequestStatusSchema,
    requestType: intakeRequestTypeSchema,
    company: z.string().min(1).max(500),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    fileCount: z.number().int().nonnegative(),
    uploadSessionStatus: uploadSessionStatusSchema,
  })
  .strict();

const websiteQueueResponseSchema = z
  .object({
    items: z.array(operatorQueueItemSchema).max(100),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().min(1).max(500).nullable(),
    requestId: serviceRequestIdSchema,
  })
  .strict();

const operatorActionHistoryItemSchema = z
  .object({
    eventId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    from: intakeRequestStatusSchema,
    to: intakeRequestStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

const operatorRequestDetailSchema = z
  .object({
    requestId: z.string().uuid(),
    publicReference: z.string().min(1).max(100),
    requestType: intakeRequestTypeSchema,
    status: intakeRequestStatusSchema,
    firstName: z.string().min(1).max(200),
    lastName: z.string().min(1).max(200),
    workEmail: z.string().min(1).max(320),
    company: z.string().min(1).max(500),
    role: z.string().min(1).max(300),
    phone: z.string().max(100).nullable(),
    country: z.string().max(200).nullable(),
    estimatedTimeline: z.string().max(300).nullable(),
    message: z.string().min(1).max(20_000),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    fileCount: z.number().int().nonnegative(),
    uploadSessionStatus: uploadSessionStatusSchema,
    operatorActions: z.array(operatorActionHistoryItemSchema),
  })
  .strict();

const websiteDetailResponseSchema = z
  .object({
    request: operatorRequestDetailSchema,
    requestId: serviceRequestIdSchema,
  })
  .strict();

const websiteActionResponseSchema = z
  .object({
    status: intakeRequestStatusSchema,
    requestId: serviceRequestIdSchema,
  })
  .strict();

const websiteErrorResponseSchema = z
  .object({
    error: z.string().min(1).max(500),
    requestId: serviceRequestIdSchema,
  })
  .strict();

export type IntakeRequestStatus = z.infer<
  typeof intakeRequestStatusSchema
>;
export type IntakeRequestType = z.infer<
  typeof intakeRequestTypeSchema
>;
export type IntakeOperatorAction = z.infer<
  typeof operatorActionSchema
>;
export type IntakeOperatorQueueItem = z.infer<
  typeof operatorQueueItemSchema
>;
export type IntakeOperatorRequestDetail = z.infer<
  typeof operatorRequestDetailSchema
>;

export interface IntakeOperatorQueueQuery {
  search?: string;
  statuses?: IntakeRequestStatus[];
  requestTypes?: IntakeRequestType[];
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  cursor?: string;
}

export interface IntakeQueueData {
  items: IntakeOperatorQueueItem[];
  total: number;
  nextCursor: string | null;
}

export interface IntakeDetailData {
  request: IntakeOperatorRequestDetail;
}

export interface IntakeActionData {
  status: IntakeRequestStatus;
}

export type IntakeServiceResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      kind: 'unavailable';
    }
  | {
      ok: false;
      kind: 'error';
    }
  | {
      ok: false;
      kind: 'upstream';
      status: 404 | 409;
    };

export interface IntakeServiceClient {
  query(
    input: IntakeOperatorQueueQuery,
    requestId: string
  ): Promise<IntakeServiceResult<IntakeQueueData>>;

  detail(
    intakeRequestId: string,
    requestId: string
  ): Promise<IntakeServiceResult<IntakeDetailData>>;

  action(
    intakeRequestId: string,
    action: IntakeOperatorAction,
    actorUserId: string,
    requestId: string
  ): Promise<IntakeServiceResult<IntakeActionData>>;
}

export interface CreateIntakeServiceClientOptions {
  config?: PhoenixIntakeServiceConfig;
  fetchImpl?: typeof fetch;
}

interface ExecuteInput<T> {
  path: string;
  method: 'GET' | 'POST';
  requestId: string;
  successSchema: ZodType<T>;
  body?: unknown;
  actorUserId?: string;
  allowedUpstreamStatuses?: readonly (404 | 409)[];
}

type ParsedResponseBody =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
    };

function resolveServiceOrigin(
  config: PhoenixIntakeServiceConfig
): string | null {
  if (
    !isIntakeServiceConfigured(config) ||
    !config.baseUrl ||
    !config.secret ||
    !SERVICE_SECRET_PATTERN.test(config.secret)
  ) {
    return null;
  }

  try {
    const url = new URL(config.baseUrl);

    if (
      (url.protocol !== 'https:' &&
        url.protocol !== 'http:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function normalizeServiceRequestId(
  requestId: string
): string {
  return SERVICE_REQUEST_ID_PATTERN.test(requestId)
    ? requestId
    : randomUUID();
}

async function readBoundedJsonResponse(
  response: Response
): Promise<ParsedResponseBody> {
  const contentType =
    response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!contentType.startsWith('application/json')) {
    return { ok: false };
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (
      Number.isFinite(parsedLength) &&
      parsedLength > MAX_INTAKE_SERVICE_RESPONSE_BYTES
    ) {
      return { ok: false };
    }
  }

  const text = await response.text();

  if (
    Buffer.byteLength(text, 'utf8') >
    MAX_INTAKE_SERVICE_RESPONSE_BYTES
  ) {
    return { ok: false };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text) as unknown,
    };
  } catch {
    return { ok: false };
  }
}

export function createIntakeServiceClient(
  options: CreateIntakeServiceClientOptions = {}
): IntakeServiceClient {
  const config =
    options.config ?? getBackendEnv().intakeService;
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = resolveServiceOrigin(config);

  async function execute<T>(
    input: ExecuteInput<T>
  ): Promise<IntakeServiceResult<T>> {
    if (!origin || !config.secret) {
      return {
        ok: false,
        kind: 'unavailable',
      };
    }

    const outboundRequestId =
      normalizeServiceRequestId(input.requestId);
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${config.secret}`,
      'X-Phoenix-Request-Id': outboundRequestId,
    });

    if (input.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (input.actorUserId !== undefined) {
      const actorUserId = z
        .string()
        .uuid()
        .parse(input.actorUserId);

      headers.set(
        'X-Phoenix-Actor-User-Id',
        actorUserId.toLowerCase()
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.timeoutMs
    );

    try {
      const response = await fetchImpl(
        new URL(input.path, origin),
        {
          method: input.method,
          headers,
          ...(input.body !== undefined
            ? { body: JSON.stringify(input.body) }
            : {}),
          signal: controller.signal,
          redirect: 'error',
        }
      );

      const parsedBody =
        await readBoundedJsonResponse(response);

      if (!parsedBody.ok) {
        return {
          ok: false,
          kind: 'error',
        };
      }

      if (response.ok) {
        const parsedSuccess =
          input.successSchema.safeParse(
            parsedBody.value
          );

        if (!parsedSuccess.success) {
          return {
            ok: false,
            kind: 'error',
          };
        }

        return {
          ok: true,
          data: parsedSuccess.data,
        };
      }

      const parsedFailure =
        websiteErrorResponseSchema.safeParse(
          parsedBody.value
        );

      if (!parsedFailure.success) {
        return {
          ok: false,
          kind: 'error',
        };
      }

      if (response.status === 401) {
        return {
          ok: false,
          kind: 'unavailable',
        };
      }

      if (response.status >= 500) {
        return {
          ok: false,
          kind: 'unavailable',
        };
      }

      if (
        (response.status === 404 ||
          response.status === 409) &&
        input.allowedUpstreamStatuses?.includes(
          response.status
        )
      ) {
        return {
          ok: false,
          kind: 'upstream',
          status: response.status,
        };
      }

      return {
        ok: false,
        kind: 'error',
      };
    } catch {
      return {
        ok: false,
        kind: 'unavailable',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async query(input, requestId) {
      const result = await execute({
        path:
          '/api/internal/operations/intake-requests/query',
        method: 'POST',
        requestId,
        successSchema: websiteQueueResponseSchema,
        body: input,
      });

      if (!result.ok) return result;

      return {
        ok: true,
        data: {
          items: result.data.items,
          total: result.data.total,
          nextCursor: result.data.nextCursor,
        },
      };
    },

    async detail(intakeRequestId, requestId) {
      const validatedRequestId = z
        .string()
        .uuid()
        .parse(intakeRequestId);

      const result = await execute({
        path:
          '/api/internal/operations/intake-requests/' +
          encodeURIComponent(validatedRequestId),
        method: 'GET',
        requestId,
        successSchema: websiteDetailResponseSchema,
        allowedUpstreamStatuses: [404],
      });

      if (!result.ok) return result;

      return {
        ok: true,
        data: {
          request: result.data.request,
        },
      };
    },

    async action(
      intakeRequestId,
      action,
      actorUserId,
      requestId
    ) {
      const validatedRequestId = z
        .string()
        .uuid()
        .parse(intakeRequestId);
      const validatedAction =
        operatorActionSchema.parse(action);

      const result = await execute({
        path:
          '/api/internal/operations/intake-requests/' +
          encodeURIComponent(validatedRequestId) +
          '/actions',
        method: 'POST',
        requestId,
        actorUserId,
        successSchema: websiteActionResponseSchema,
        body: {
          action: validatedAction,
        },
        allowedUpstreamStatuses: [404, 409],
      });

      if (!result.ok) return result;

      return {
        ok: true,
        data: {
          status: result.data.status,
        },
      };
    },
  };
}

export function getIntakeServiceClient(): IntakeServiceClient {
  return createIntakeServiceClient();
}
