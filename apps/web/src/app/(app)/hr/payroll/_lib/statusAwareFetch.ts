import { cookies } from "next/headers";
import { COOKIE } from "@/lib/auth/config";

export type StatusFetchResult =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "http_error"; status: number; body: unknown }
  /** No gateway configured, no auth token, or a network failure — the same
   *  "can't reach the API" bucket fetchJson collapses into source:"error". */
  | { kind: "unavailable" };

function getGatewayBaseUrl(): string | null {
  const base = process.env.CIVITASONE_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || null;
  return base && base.length > 0 ? base.replace(/\/$/, "") : null;
}

/**
 * Status-aware server-side GET.
 *
 * `fetchJson` (the house loader) collapses every non-2xx response into
 * `source:"error"` with no status code, which is right for a genuine outage
 * but wrong when the endpoint's contract uses a specific status as a normal
 * business state — e.g. bulk-status returning 404 "no job yet" on first
 * visit, or form24q returning 409 "TDS reconciliation gate". Callers that
 * need to branch on the exact status (legitimate empty vs. blocked vs. a
 * real 401/403/5xx failure) should use this instead of fetchJson.
 */
export async function statusAwareGet(path: string): Promise<StatusFetchResult> {
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl) return { kind: "unavailable" };

  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return { kind: "unavailable" };

  const normalized = path.startsWith("/") ? path : `/${path}`;
  const apiPath = normalized.startsWith("/api/") ? normalized : `/api${normalized}`;

  try {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    return response.ok ? { kind: "ok", status: response.status, body } : { kind: "http_error", status: response.status, body };
  } catch {
    return { kind: "unavailable" };
  }
}
