// Next 15: cookies() is async. This synchronous helper has many callers, so it uses the
// supported transitional UnsafeUnwrappedCookies cast (sync access is removed in Next 16).
import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import type { ZodType, ZodTypeDef } from "zod";
import { COOKIE } from "@/lib/auth/config";
import { cachedFetchOptions } from "@/lib/dataCache";
import { recordLoaderFallback, type LoaderFallbackReason } from "./loaderTelemetry";

export type LoaderSource = "api" | "error";
/**
 * `status` is the raw HTTP status code when one was actually received
 * (undefined for network errors / missing config, where there was no
 * response to read one from). It is optional and additive on purpose: every
 * existing caller keys off `source` alone and is unaffected. It exists so a
 * detail-by-id page CAN tell a real 404 ("this record doesn't exist") apart
 * from every other failure ("we couldn't load it") when that distinction
 * matters — `source: "error"` alone conflates them (see UX-009 follow-up).
 *
 * `errorCode`/`errorMessage` are the same kind of additive, optional escape
 * hatch for the response BODY: every route handler in this codebase throws
 * a typed `HttpError(status, code, message)` (every service's own src/shared/context.ts)
 * whose module-level Fastify error handler serializes it as
 * `{ code, message, correlationId, ... }` — see e.g.
 * services/hrms-service/src/modules/employee/routes.ts's `errorHandler`.
 * `message` is always already a clerk-safe, specific, plain-language reason
 * ("managers may only view their own direct reports' records", "requires
 * one of: hr_admin, hr_officer, super_admin") — never a raw stack trace or
 * internal detail — so it is safe to surface directly to a caller instead of
 * a generic fallback. This is what lets `status === 403` be rendered as an
 * honest, specific "Access restricted" message (see
 * `ds/LoadErrorState.tsx`) instead of the generic "couldn't load, try
 * again" copy, which is actively misleading for a permanent authorization
 * boundary — retrying a 403 can never succeed.
 */
export type LoaderResult<T> = {
  data: T;
  source: LoaderSource;
  status?: number;
  /** The backend's own machine-readable error code (e.g. "FORBIDDEN"), when a response body could be parsed. */
  errorCode?: string;
  /** The backend's own plain-language reason (HttpError's `message`), when a response body could be parsed. */
  errorMessage?: string;
  /** True when the loader gave up because the gateway took longer than its timeout (no status then). */
  timedOut?: boolean;
};

export interface FetchJsonOptions<TApi, TOutput> {
  revalidateSeconds?: number;
  telemetryKey: string;
  mapResponse: (payload: TApi) => TOutput | null;
  /**
   * Parses the raw JSON body, so its input side is `unknown` rather than TApi.
   * Pinning both sides to TApi would reject any schema that fills in a missing
   * field — which is how a loader stays readable against a service that has
   * not yet been rolled out.
   */
  responseSchema?: ZodType<TApi, ZodTypeDef, unknown>;
  /**
   * CLOS3-S3-24: abort the upstream call after this many ms and fall into the existing
   * `source: "error"` state. Defaults to DEFAULT_FETCH_TIMEOUT_MS; raise it per loader for
   * known-slow report endpoints.
   */
  timeoutMs?: number;
  /**
   * UAT-P2-D1: the service answered 404 with its own typed `NOT_FOUND` error
   * for a "the caller's own record" endpoint (e.g. GET /v1/tenants/current,
   * GET /v1/themes/branding) -- that means "nothing is on record yet", not an
   * outage. When set, such a 404 resolves as `{ data: empty, source: "api",
   * status: 404 }` so the screen renders its empty state instead of
   * "We couldn't load ...". A gateway "no upstream for path" 404 and a bare
   * Fastify route-not-found 404 (no typed code) still surface as errors, so a
   * real wiring gap is never hidden. Opt-in; every existing loader is unchanged.
   */
  notFoundAsEmpty?: boolean;
}

/** The gateway's own 404 for an unrouted path (services/gateway-service/src/app.ts). */
const GATEWAY_NO_UPSTREAM_MESSAGE = "no upstream for path";

/** True for a service-level "no record" 404 (typed NOT_FOUND), false for a routing/wiring 404. */
export function isRecordNotFound(status: number, code: string | undefined, message: string | undefined): boolean {
  return status === 404 && code === "NOT_FOUND" && message !== GATEWAY_NO_UPSTREAM_MESSAGE;
}

/** Without a bound, a hung gateway pins the SSR render, a socket and a request slot per page view. */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

function getGatewayBaseUrl(): string | null {
  const base =
    process.env.CIVITASONE_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    null;
  return base && base.length > 0 ? base.replace(/\/$/, "") : null;
}

function emitError(
  telemetryKey: string,
  reason: LoaderFallbackReason,
  path: string,
  statusCode?: number,
): void {
  recordLoaderFallback({
    key: telemetryKey,
    reason,
    statusCode,
    path,
    timestamp: new Date().toISOString(),
  });
}

function serverAuthHeaders(): Record<string, string> {
  const token = (cookies() as unknown as UnsafeUnwrappedCookies).get(COOKIE.ACCESS)?.value;
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

/**
 * Best-effort parse of a failed response's JSON body for the `{ code,
 * message }` shape every service's HttpError-backed error handler sends.
 * Never throws: a non-JSON or unexpectedly-shaped error body (a raw 502
 * from a proxy that never reached the service, say) just yields
 * `{ code: undefined, message: undefined }`, and the caller falls back to
 * the generic error copy exactly as it did before this existed.
 */
async function readErrorBody(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await response.clone().json()) as unknown;
    if (body && typeof body === "object") {
      const { code, message } = body as { code?: unknown; message?: unknown };
      return {
        code: typeof code === "string" ? code : undefined,
        message: typeof message === "string" ? message : undefined,
      };
    }
  } catch {
    // not JSON, or already consumed — fall through to the empty result.
  }
  return {};
}

/**
 * UAT-P1A-01: the payload inside a `{ data, meta }` / `{ data, pagination }` /
 * `{ items, total, ... }` list envelope (or a `{ data: {...} }` record
 * envelope), or `undefined` when `raw` is not such an envelope. Services
 * wrap their responses inconsistently, and many loader schemas describe only
 * the bare array/record; validating the envelope against those schemas failed
 * every time, so the screen showed "We couldn't load ..." over a 200 with data.
 */
export function envelopePayload(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const env = raw as { data?: unknown; items?: unknown };
  if (Array.isArray(env.data)) return env.data;
  if (typeof env.data === "object" && env.data !== null) return env.data;
  if (Array.isArray(env.items)) return env.items;
  return undefined;
}

/**
 * Validate the body as-is first: schemas that model the envelope (and bare
 * array/record responses) are unaffected. Only when that fails is the
 * envelope's payload validated against the same schema, so a schema for the
 * bare array/record accepts the enveloped response too. Field-level
 * mismatches still fail -- the payload is held to the same schema.
 */
export function parseWithEnvelope<TApi>(
  schema: ZodType<TApi, ZodTypeDef, unknown>,
  raw: unknown,
): { success: true; data: TApi } | { success: false } {
  const direct = schema.safeParse(raw);
  if (direct.success) return { success: true, data: direct.data };
  const inner = envelopePayload(raw);
  if (inner === undefined) return { success: false };
  const unwrapped = schema.safeParse(inner);
  return unwrapped.success ? { success: true, data: unwrapped.data } : { success: false };
}

/**
 * API-only loader — no mock fallback. On failure returns empty data + source:"error".
 */
export async function fetchJson<TApi, TOutput>(
  path: string,
  empty: TOutput,
  options: FetchJsonOptions<TApi, TOutput>,
): Promise<LoaderResult<TOutput>> {
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl) {
    emitError(options.telemetryKey, "no_base_url", path);
    return { data: empty, source: "error" };
  }

  const auth = serverAuthHeaders();
  if (!auth.authorization) {
    emitError(options.telemetryKey, "http_error", path, 401);
    return { data: empty, source: "error", status: 401 };
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  const apiPath = normalized.startsWith("/api/") ? normalized : `/api${normalized}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      headers: {
        "content-type": "application/json",
        ...auth,
      },
      next: options.revalidateSeconds ? cachedFetchOptions(options.revalidateSeconds, auth.authorization.slice(7)) : undefined,
      cache: options.revalidateSeconds ? undefined : "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const { code, message } = await readErrorBody(response);
      if (options.notFoundAsEmpty && isRecordNotFound(response.status, code, message)) {
        return { data: empty, source: "api", status: 404, errorCode: code, errorMessage: message };
      }
      emitError(options.telemetryKey, "http_error", path, response.status);
      return { data: empty, source: "error", status: response.status, errorCode: code, errorMessage: message };
    }

    const raw = await response.json();
    if (options.responseSchema) {
      const parsed = parseWithEnvelope(options.responseSchema, raw);
      if (!parsed.success) {
        emitError(options.telemetryKey, "invalid_payload", path, response.status);
        return { data: empty, source: "error", status: response.status };
      }
      const mapped = options.mapResponse(parsed.data);
      if (mapped === null) {
        emitError(options.telemetryKey, "invalid_payload", path, response.status);
        return { data: empty, source: "error", status: response.status };
      }
      return { data: mapped, source: "api" };
    }

    // UAT-P1A-01: a mapper written for the bare record/array gets the
    // envelope's payload when it rejects the envelope itself.
    let mapped = options.mapResponse(raw as TApi);
    if (mapped === null) {
      const inner = envelopePayload(raw);
      if (inner !== undefined) mapped = options.mapResponse(inner as TApi);
    }
    if (mapped === null) {
      emitError(options.telemetryKey, "invalid_payload", path, response.status);
      return { data: empty, source: "error", status: response.status };
    }

    return { data: mapped, source: "api" };
  } catch {
    emitError(options.telemetryKey, "network_error", path);
    // Our own timer fired: say "taking longer than usual", not "a problem on our side".
    return controller.signal.aborted ? { data: empty, source: "error", timedOut: true } : { data: empty, source: "error" };
  } finally {
    // Cleared only after the body is read too, so a stalled body is bounded by the same timer.
    clearTimeout(timer);
  }
}

/** @deprecated use fetchJson — kept for gradual migration */
export const fetchJsonWithFallback = fetchJson;

export function staticLoaderResult<T>(data: T): LoaderResult<T> {
  return { data, source: "api" };
}
