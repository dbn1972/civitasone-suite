import type { TenantLifecycleRequest, TenantApprovalPolicyView } from "@/app/_data/loaders";
import { listSignature } from "./lifecycleModel";

/**
 * GAP-ADMIN-TENANTS-DETAIL-05: browser-side calls for the lifecycle UI. Every
 * write is a 202 (the backend publishes a command), so after a write we poll
 * the read endpoints a few times until the change shows up.
 */

const base = (tenantId: string) => `/api/proxy/v1/admin/tenants/${encodeURIComponent(tenantId)}`;

export async function sendJson(method: "POST" | "PUT", path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
}

export const requestsUrl = (tenantId: string) => `${base(tenantId)}/lifecycle-requests`;
export const decisionUrl = (tenantId: string, requestId: string) => `${base(tenantId)}/lifecycle-requests/${encodeURIComponent(requestId)}/decision`;
export const cancelUrl = (tenantId: string, requestId: string) => `${base(tenantId)}/lifecycle-requests/${encodeURIComponent(requestId)}/cancel`;
export const policyUrl = (tenantId: string) => `${base(tenantId)}/approval-policy`;

/** The backend's machine `code` for a failed response (never shown to the user, only mapped to catalogued copy). */
export async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export async function fetchRequests(tenantId: string): Promise<TenantLifecycleRequest[] | null> {
  try {
    const res = await fetch(`${requestsUrl(tenantId)}?limit=50`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    return Array.isArray(body.items) ? (body.items as TenantLifecycleRequest[]) : null;
  } catch {
    return null;
  }
}

export async function fetchPolicy(tenantId: string): Promise<TenantApprovalPolicyView | null> {
  try {
    const res = await fetch(policyUrl(tenantId), { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as TenantApprovalPolicyView;
    return body && typeof body === "object" && body.policy ? body : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls until the request list differs from `before` (or gives up and returns the latest). */
export async function pollRequests(tenantId: string, before: string, attempts = 6, gapMs = 700): Promise<TenantLifecycleRequest[] | null> {
  let latest: TenantLifecycleRequest[] | null = null;
  for (let i = 0; i < attempts; i++) {
    await sleep(gapMs);
    latest = await fetchRequests(tenantId);
    if (latest && listSignature(latest) !== before) return latest;
  }
  return latest;
}
