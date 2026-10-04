/**
 * GAP-ADMIN-OPERATORS-05: browser-side model for platform-operator management.
 *
 * Every change to an operator (suspend, reactivate, role change) is a REQUEST that a
 * different super admin approves. The server is the authority on every rule below;
 * these helpers only decide which buttons to offer and map the server's machine
 * `code` to catalogued copy (the server's own text and the HTTP status never reach
 * the screen).
 */

export type OperatorChangeKind = "suspend" | "reactivate" | "role_change";
export type PlatformRole = "super_admin" | "platform_admin";
export type OperatorDecision = "approve" | "reject" | "cancel";

export interface PendingRequestRef {
  id: string;
  kind: string;
  toRole: string | null;
  requestedBy: string;
}

export interface OperatorRequest {
  id: string;
  kind: string;
  targetName: string;
  fromRole: string;
  toRole: string | null;
  reason: string;
  status: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
}

const API = "/api/proxy/v1/admin/operators";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function parsePendingRequest(v: unknown): PendingRequestRef | null {
  if (!isRecord(v) || typeof v.id !== "string") return null;
  return { id: v.id, kind: text(v.kind), toRole: typeof v.toRole === "string" ? v.toRole : null, requestedBy: text(v.requestedBy) };
}

export function otherRole(role: string): PlatformRole | null {
  if (role === "super_admin") return "platform_admin";
  if (role === "platform_admin") return "super_admin";
  return null;
}

/**
 * The changes to offer for an operator row. Nothing for your own row (the server refuses it
 * too), for a row that already has a change waiting, or for a row without an id.
 */
export function availableChanges(
  op: { id?: string | undefined; role: string; status: string; pendingRequest: PendingRequestRef | null },
  viewerId: string | null,
): OperatorChangeKind[] {
  if (!op.id || op.pendingRequest) return [];
  if (viewerId && op.id.toLowerCase() === viewerId.toLowerCase()) return [];
  const s = op.status.trim().toLowerCase();
  if (s === "active") return otherRole(op.role) ? ["suspend", "role_change"] : ["suspend"];
  if (s === "suspended") return ["reactivate"];
  return [];
}

export function toOperatorRequests(raw: unknown): OperatorRequest[] {
  const rows = isRecord(raw) && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return rows.filter(isRecord).map((r) => ({
    id: text(r.id), kind: text(r.kind), targetName: text(r.targetName), fromRole: text(r.fromRole),
    toRole: typeof r.toRole === "string" ? r.toRole : null, reason: text(r.reason), status: text(r.status),
    requestedBy: text(r.requestedBy), requestedByName: text(r.requestedByName), requestedAt: text(r.requestedAt),
  })).filter((r) => r.id !== "");
}

/** The maker never decides their own request; only a super admin decides. */
export function canDecide(req: Pick<OperatorRequest, "status" | "requestedBy">, viewerId: string | null, viewerRoles: readonly string[]): boolean {
  return req.status === "pending" && viewerRoles.includes("super_admin") && !!viewerId && req.requestedBy.toLowerCase() !== viewerId.toLowerCase();
}

export function canCancel(req: Pick<OperatorRequest, "status" | "requestedBy">, viewerId: string | null): boolean {
  return req.status === "pending" && !!viewerId && req.requestedBy.toLowerCase() === viewerId.toLowerCase();
}

/** Machine codes the server sends; anything else falls back to a generic message. */
export const OPERATOR_ERROR_CODES = [
  "SELF_ACTION", "NOT_AN_OPERATOR", "ALREADY_PENDING", "INVALID_STATE", "INVALID_ROLE", "LAST_SUPER_ADMIN",
  "NOT_PENDING", "NOT_FOUND", "FORBIDDEN", "VALIDATION_FAILED", "OPERATOR_REQUIRES_APPROVAL",
] as const;
export type OperatorErrorCode = (typeof OPERATOR_ERROR_CODES)[number] | "generic";

export function errorCodeFrom(body: unknown): OperatorErrorCode {
  const code = isRecord(body) ? (typeof body.code === "string" ? body.code : isRecord(body.error) && typeof body.error.code === "string" ? body.error.code : "") : "";
  return (OPERATOR_ERROR_CODES as readonly string[]).includes(code) ? (code as OperatorErrorCode) : "generic";
}

export type ActionResult = { ok: true } | { ok: false; code: OperatorErrorCode };

async function send(url: string, method: "POST", body: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* no body */ }
    return { ok: false, code: errorCodeFrom(parsed) };
  } catch {
    return { ok: false, code: "generic" };
  }
}

/** `grant` makes a user who holds no platform role an operator (needs a second super admin's approval). */
export type OperatorRequestKind = OperatorChangeKind | "grant";

export function requestOperatorChange(userId: string, body: { kind: OperatorRequestKind; reason: string; toRole?: PlatformRole }): Promise<ActionResult> {
  return send(`${API}/${encodeURIComponent(userId)}/requests`, "POST", body);
}

export function decideOperatorRequest(requestId: string, decision: OperatorDecision, note?: string): Promise<ActionResult> {
  return send(`${API}/requests/${encodeURIComponent(requestId)}/${decision}`, "POST", note ? { note } : {});
}

export type RequestsLoad = { ok: true; requests: OperatorRequest[] } | { ok: false };

export async function loadPendingRequests(): Promise<RequestsLoad> {
  try {
    const res = await fetch(`${API}/requests?status=pending&limit=50`, { cache: "no-store" });
    if (!res.ok) return { ok: false };
    return { ok: true, requests: toOperatorRequests(await res.json()) };
  } catch {
    return { ok: false };
  }
}

export interface GrantCandidate { id: string; name: string; email: string }
export type CandidatesLoad = { ok: true; candidates: GrantCandidate[] } | { ok: false };

/**
 * Active people who could be made operators. The server does the filtering (it already excludes every
 * operator, so the list is complete however many there are) and the name / e-mail search; the page only
 * asks for a bounded page of matches.
 */
export async function loadGrantCandidates(query: string): Promise<CandidatesLoad> {
  try {
    const q = query.trim();
    const res = await fetch(`${API}/candidates?limit=25${q ? `&q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    const rows = isRecord(body) && Array.isArray(body.data) ? body.data : [];
    const candidates = rows.filter(isRecord)
      .filter((u) => typeof u.id === "string")
      .map((u) => ({ id: u.id as string, name: text(u.name) || text(u.email), email: text(u.email) }));
    return { ok: true, candidates };
  } catch {
    return { ok: false };
  }
}
