import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

/** asset-service WRITEOFF_APPROVER_ROLES (modules/verification/routes.ts) -- a strict subset of who may REQUEST one. */
export const WRITEOFF_APPROVER_ROLES = ["asset_admin", "super_admin", "finance_officer"] as const;

export function canApproveWriteoff(roles: readonly string[]): boolean {
  return roles.some((r) => (WRITEOFF_APPROVER_ROLES as readonly string[]).includes(r));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Service error codes that get their own (translated) copy; anything else falls back to the service message. */
export type WriteoffErrorKey = "selfApproval" | "alreadyDecided" | "notFound" | null;

export function writeoffErrorKey(status: number, code: string | undefined): WriteoffErrorKey {
  if (code === "SELF_APPROVAL_FORBIDDEN") return "selfApproval";
  if (status === 409) return "alreadyDecided";
  if (status === 404) return "notFound";
  return null;
}

export type WriteoffResult = { ok: true; id: string } | { ok: false; key: WriteoffErrorKey; message: string };

async function send(path: string, body?: unknown): Promise<WriteoffResult> {
  const res = await browserFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const code = await errorCodeFromResponse(res);
    const key = writeoffErrorKey(res.status, code);
    return { ok: false, key, message: key ? "" : await errorMessageFromResponse(res) };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: typeof data.id === "string" ? data.id : "" };
}

/** POST /v1/assets/assets/:id/writeoff-request (202). Returns the new write-off request reference. */
export function requestWriteoff(assetId: string, remarks?: string): Promise<WriteoffResult> {
  return send(`v1/asset/assets/${encodeURIComponent(assetId)}/writeoff-request`, remarks ? { remarks } : {});
}

/** POST /v1/assets/writeoff-requests/:id/approve (202). Service refuses the requester (403 SELF_APPROVAL_FORBIDDEN). */
export function approveWriteoff(requestId: string): Promise<WriteoffResult> {
  return send(`v1/asset/writeoff-requests/${encodeURIComponent(requestId)}/approve`);
}
