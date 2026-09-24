import { cookies } from "next/headers";
import type { ZodType, ZodTypeDef } from "zod";
import { COOKIE } from "@/lib/auth/config";
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
}

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
  const token = cookies().get(COOKIE.ACCESS)?.value;
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

  try {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      headers: {
        "content-type": "application/json",
        ...auth,
      },
      next: options.revalidateSeconds ? { revalidate: options.revalidateSeconds } : undefined,
      cache: options.revalidateSeconds ? undefined : "no-store",
    });

    if (!response.ok) {
      emitError(options.telemetryKey, "http_error", path, response.status);
      const { code, message } = await readErrorBody(response);
      return { data: empty, source: "error", status: response.status, errorCode: code, errorMessage: message };
    }

    const raw = await response.json();
    if (options.responseSchema) {
      const parsed = options.responseSchema.safeParse(raw);
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

    const payload = raw as TApi;
    const mapped = options.mapResponse(payload);
    if (mapped === null) {
      emitError(options.telemetryKey, "invalid_payload", path, response.status);
      return { data: empty, source: "error", status: response.status };
    }

    return { data: mapped, source: "api" };
  } catch {
    emitError(options.telemetryKey, "network_error", path);
    return { data: empty, source: "error" };
  }
}

/** @deprecated use fetchJson — kept for gradual migration */
export const fetchJsonWithFallback = fetchJson;

export function staticLoaderResult<T>(data: T): LoaderResult<T> {
  return { data, source: "api" };
}
