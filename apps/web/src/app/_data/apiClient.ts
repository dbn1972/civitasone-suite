import { cookies } from "next/headers";
import type { ZodType, ZodTypeDef } from "zod";
import { COOKIE } from "@/lib/auth/config";
import { recordLoaderFallback, type LoaderFallbackReason } from "./loaderTelemetry";

export type LoaderSource = "api" | "error";
export type LoaderResult<T> = { data: T; source: LoaderSource };

interface FetchJsonOptions<TApi, TOutput> {
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
    return { data: empty, source: "error" };
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
      return { data: empty, source: "error" };
    }

    const raw = await response.json();
    if (options.responseSchema) {
      const parsed = options.responseSchema.safeParse(raw);
      if (!parsed.success) {
        emitError(options.telemetryKey, "invalid_payload", path, response.status);
        return { data: empty, source: "error" };
      }
      const mapped = options.mapResponse(parsed.data);
      if (mapped === null) {
        emitError(options.telemetryKey, "invalid_payload", path, response.status);
        return { data: empty, source: "error" };
      }
      return { data: mapped, source: "api" };
    }

    const payload = raw as TApi;
    const mapped = options.mapResponse(payload);
    if (mapped === null) {
      emitError(options.telemetryKey, "invalid_payload", path, response.status);
      return { data: empty, source: "error" };
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
