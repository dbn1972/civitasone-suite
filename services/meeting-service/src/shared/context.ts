import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

/**
 * Standard meeting-service error codes and their HTTP status mapping.
 *
 * Source of truth: design.md § Error Handling → Standard Error Codes. Domain code
 * paths raise `HttpError` with one of these codes; the app-level error handler
 * serialises them into the standard envelope (see `toErrorEnvelope`). Raw
 * Postgres/Redis errors are NEVER leaked to clients.
 *
 * Note `MEETING_UNAUTHORIZED_ACCESS` and `PARTICIPANT_NOT_MEMBER` deliberately map
 * to 404 — classified/unauthorized access must not leak resource existence.
 */
export const ERROR_CODES = {
  MEETING_NOT_FOUND: 404,
  MEETING_INVALID_TRANSITION: 422,
  MEETING_QUORUM_NOT_MET: 422,
  MEETING_AGENDA_LOCKED: 422,
  MEETING_PAST_DEADLINE: 422,
  MEETING_VERSION_CONFLICT: 409,
  MEETING_DUPLICATE_VOTE: 409,
  MEETING_MEMBER_RECUSED: 422,
  MEETING_SHORT_NOTICE: 422,
  MEETING_UNAUTHORIZED_ACCESS: 404,
  COMMITTEE_NOT_FOUND: 404,
  COMMITTEE_QUORUM_RULE_INVALID: 400,
  PARTICIPANT_ALREADY_ADDED: 409,
  PARTICIPANT_NOT_MEMBER: 422,
  ACTION_ITEM_NOT_ACKNOWLEDGED: 422,
  ACTION_ITEM_DEADLINE_INVALID: 422,
  RESOLUTION_CIRCULATION_INVALID: 422,
  VC_PROVIDER_UNAVAILABLE: 503,
  VC_SESSION_NOT_FOUND: 404,
  DOCUMENT_TOO_LARGE: 400,
  DOCUMENT_INVALID_TYPE: 400,
  DSC_SIGNING_FAILED: 500,
  AI_PROCESSING_FAILED: 500,
  ROOM_DOUBLE_BOOKED: 409,
  CALENDAR_CONFLICT: 409,
  TENANT_CONFIG_MISSING: 500,
  // Cross-cutting auth/generic codes (also raised by resolveContext / requireRole).
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Domain HTTP error. The (status, code, message) constructor shape is kept
 * compatible with `@civitasone/schemas` `registerSchemaErrorHandler`, which reads
 * `err.status`, `err.code`, `err.message`. Optional `details` carries structured
 * context (e.g. allowed transitions, conflicting booking) surfaced in the envelope.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Construct an `HttpError` from a known `ErrorCode`, deriving the HTTP status from
 * the `ERROR_CODES` mapping. Prefer this over `new HttpError(...)` in domain code so
 * status/code stay in sync with the design contract.
 */
export function httpError(code: ErrorCode, message?: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(ERROR_CODES[code], code, message ?? code, details);
}

/** Standard error envelope shape: `{ error: { code, message, details?, correlationId } }`. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    correlationId: string;
  };
}

/**
 * Serialise any error into the standard envelope. Known `HttpError`s pass through
 * their code/message/details; unknown errors collapse to a generic `INTERNAL` 500
 * so internal details never leak to clients.
 */
export function toErrorEnvelope(err: unknown, correlationId: string): { status: number; body: ErrorEnvelope } {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
          correlationId,
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "internal error", correlationId } },
  };
}

/**
 * Resolve the multi-tenant RequestContext (tenantId, actorId, roles, correlationId)
 * for a route. Auth resolution failures are mapped to the service `HttpError`.
 */
export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    return resolveServiceContext(req);
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/** Assert the actor holds at least one of `roles`; otherwise throw 403 FORBIDDEN. */
export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", `requires one of: ${roles.join(", ")}`);
  }
}
