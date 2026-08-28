import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

/**
 * Standard court-service error codes and their HTTP status mapping.
 *
 * Source of truth: design.md § Error Handling → Standard Error Codes. Domain code
 * paths raise `HttpError` with one of these codes; the app-level error handler
 * serialises them into the standard envelope (see `toErrorEnvelope`). Raw
 * Postgres/Redis errors are NEVER leaked to clients.
 */
export const ERROR_CODES = {
  CASE_NOT_FOUND: 404,
  CASE_INVALID_TRANSITION: 422,
  CASE_VERSION_CONFLICT: 409,
  CNR_ALREADY_EXISTS: 409,
  INVALID_CNR: 400,
  HEARING_NOT_FOUND: 404,
  HEARING_INVALID_TRANSITION: 422,
  HEARING_VERSION_CONFLICT: 409,
  CAUSELIST_SLOT_CONFLICT: 409,
  ORDER_NOT_FOUND: 404,
  ORDER_INVALID_TRANSITION: 422,
  ORDER_VERSION_CONFLICT: 409,
  MAKER_CHECKER_VIOLATION: 403,
  APPEAL_NOT_FOUND: 404,
  APPEAL_INVALID_TRANSITION: 422,
  APPEAL_VERSION_CONFLICT: 409,
  NOTICE_NOT_FOUND: 404,
  NOTICE_INVALID_TRANSITION: 422,
  NOTICE_VERSION_CONFLICT: 409,
  EVIDENCE_NOT_FOUND: 404,
  EVIDENCE_INVALID_TRANSITION: 422,
  EVIDENCE_VERSION_CONFLICT: 409,
  COMPLIANCE_NOT_FOUND: 404,
  COMPLIANCE_INVALID_TRANSITION: 422,
  COMPLIANCE_VERSION_CONFLICT: 409,
  FILING_INVALID: 400,
  COURT_NOT_FOUND: 404,
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
 * context (e.g. allowed transitions, conflicting slot) surfaced in the envelope.
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

/**
 * Shared shape for the synchronous pre-check a write-intent command runs
 * before publish: read the row's current (status, version), and -- UNLESS
 * it is already at `target` (the same idempotent-retry no-op the consumer
 * itself allows) -- enforce optimistic locking, then transition legality via
 * the SAME `assertTransition` the consumer uses, so this can never drift
 * from what the consumer will actually enforce.
 *
 * Deliberately skips both checks on the already-at-target path, mirroring
 * every consumer's own `if (current.status === target) return;` no-op. That
 * makes this helper WRONG for a security invariant (e.g. maker-checker):
 * such checks must run unconditionally, before calling this, not be folded
 * into it.
 */
export function assertVersionAndTransition<T extends string>(
  current: { status: string; version: number },
  expectedVersion: number,
  target: T,
  assertTransition: (from: string, to: T) => void,
  codes: { versionConflict: ErrorCode; invalidTransition: ErrorCode },
): void {
  if (current.status === target) return;
  if (current.version !== expectedVersion) {
    throw httpError(
      codes.versionConflict,
      `Expected version ${expectedVersion}, found ${current.version}`,
    );
  }
  try {
    assertTransition(current.status, target);
  } catch (e) {
    throw httpError(codes.invalidTransition, (e as Error).message);
  }
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
