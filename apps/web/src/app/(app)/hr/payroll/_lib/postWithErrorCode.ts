import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { UserFacingError } from "@/lib/userFacingError";
import { referenceFromHeaders } from "@/lib/errorCatalogue";

/**
 * Send a request through the BFF proxy and, on failure, let the caller turn a
 * KNOWN payroll-service error `code` (e.g. "PT_SLAB_OVERLAP",
 * "DUPLICATE_CHALLAN", "SELF_APPROVAL_FORBIDDEN") into its own translated,
 * field-specific sentence. Any other failure falls back to browserJson's
 * catalogued generic message (errorMessageFromResponse) -- the backend's raw
 * `message` text is never shown (UX-020).
 *
 * `codeMessages` maps code -> already-translated display text. `opts.area` is
 * an optional plain noun ("professional tax slab") that makes the generic
 * fallback specific. The fallback is the app-wide status-aware standard
 * (apps/web/docs/ERROR-MESSAGES.md) for every caller; `opts.statusAware` is a
 * deprecated no-op kept so call sites written against the old opt-in still compile.
 */
export type ErrorCodeOptions = {
  area?: string;
  /** @deprecated status-aware is now the default. */
  statusAware?: boolean;
  /** Sent as `x-idempotency-key` so a retried submit cannot double-apply. */
  idempotencyKey?: string;
};

/**
 * The Error thrown for a failed request. `message` is always the clerk-safe
 * translated/catalogued text; `code` is the backend machine code (never
 * displayed) and `details` the backend `details` object, for callers that need
 * structured data from a rejection (e.g. the per-row result of a rejected bulk
 * assign). Still an `Error`, so every existing `err instanceof Error` caller
 * is unaffected. Being a UserFacingError, `fromException` keeps its message.
 */
export class CodedRequestError extends UserFacingError {
  readonly code: string | undefined;
  readonly details: unknown;
  constructor(message: string, code?: string, details?: unknown, reference: string | null = null) {
    super(message, reference);
    this.name = "CodedRequestError";
    this.code = code;
    this.details = details;
  }
}

export async function requestWithErrorCode<T = unknown>(
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts: ErrorCodeOptions = {},
): Promise<T> {
  const res = await browserFetch(path, {
    method,
    body: JSON.stringify(body),
    ...(opts.idempotencyKey ? { headers: { "x-idempotency-key": opts.idempotencyKey } } : {}),
  });
  if (res.ok) return (await res.json().catch(() => ({}))) as T;
  let code: string | undefined;
  let details: unknown;
  try {
    const parsed = (await res.clone().json()) as { code?: unknown; details?: unknown };
    code = typeof parsed?.code === "string" ? parsed.code : undefined;
    details = parsed?.details;
  } catch {
    code = undefined;
  }
  if (code && Object.prototype.hasOwnProperty.call(codeMessages, code)) {
    throw new CodedRequestError(codeMessages[code], code, details);
  }
  throw new CodedRequestError(
    await errorMessageFromResponse(res, undefined, opts.area),
    code,
    details,
    referenceFromHeaders(res.headers),
  );
}

export function postWithErrorCode<T = unknown>(
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts?: ErrorCodeOptions,
): Promise<T> {
  return requestWithErrorCode<T>("POST", path, body, codeMessages, opts);
}

export function patchWithErrorCode<T = unknown>(
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts?: ErrorCodeOptions,
): Promise<T> {
  return requestWithErrorCode<T>("PATCH", path, body, codeMessages, opts);
}

export function putWithErrorCode<T = unknown>(
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts?: ErrorCodeOptions,
): Promise<T> {
  return requestWithErrorCode<T>("PUT", path, body, codeMessages, opts);
}
