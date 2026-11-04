/**
 * Who issues and who signs an official document, resolved over the internal service boundary
 * (x-internal + x-service-secret + x-tenant-id, as every peer-service client in the suite does).
 *
 *   resolveDocIdentity(tenantId) - the issuing authority and its statutory identifiers, from the
 *     tenant configuration (tenant-service `settings.documentIdentity`, set by the tenant admin,
 *     the server-side counterpart of the GIGW department identity on the web).
 *   resolveSignatories(tenantId, actorIds) - officer name and designation for actor ids (HRMS
 *     employee linked to the login; identity-service display name as the fallback).
 *
 * Both fail OPEN to "unknown" (null / no entry). A document that must name its issuer or signatory
 * then refuses to generate (see requireIssuer) instead of printing a placeholder.
 */

export interface DocIdentity {
  /** Organisation / office name ("Office of the Commissioner, ..."). */
  orgName: string | null;
  orgNameHi: string | null;
  ministry: string | null;
  department: string | null;
  address: string | null;
  /** Tax deduction account number of the deductor (Form 16 / 12BA). */
  tan: string | null;
  /** PAN of the deductor / organisation. */
  pan: string | null;
  /** GSTIN of the organisation as buyer or supplier. */
  gstin: string | null;
  /** Two-digit GST state code of the organisation (falls back to the GSTIN prefix). */
  stateCode: string | null;
}

export const EMPTY_DOC_IDENTITY: DocIdentity = {
  orgName: null, orgNameHi: null, ministry: null, department: null, address: null, tan: null, pan: null, gstin: null, stateCode: null,
};

/** The tenant setting a tenant admin fills in (PATCH /v1/tenants/:id { settings: { documentIdentity } }). */
export const DOC_IDENTITY_SETTING = "documentIdentity";

const str = (v: unknown, max = 400): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Parse the tenant settings object into a DocIdentity (unknown keys ignored, wrong types dropped). */
export function docIdentityFromTenant(tenant: { name?: unknown; settings?: unknown } | null | undefined): DocIdentity {
  const settings = tenant && typeof tenant.settings === "object" && tenant.settings !== null ? (tenant.settings as Record<string, unknown>) : {};
  const raw = settings[DOC_IDENTITY_SETTING];
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const gstin = str(d.gstin, 15)?.toUpperCase() ?? null;
  const stateCode = str(d.stateCode, 2) ?? (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null);
  return {
    orgName: str(d.orgName, 200) ?? str(tenant?.name, 200),
    orgNameHi: str(d.orgNameHi, 200),
    ministry: str(d.ministry, 200),
    department: str(d.department, 200),
    address: str(d.address, 400),
    tan: str(d.tan, 10)?.toUpperCase() ?? null,
    pan: str(d.pan, 10)?.toUpperCase() ?? null,
    gstin,
    stateCode,
  };
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function internalHeaders(tenantId: string): Record<string, string> {
  return { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId };
}

const identityCache = new Map<string, { value: DocIdentity; at: number }>();
const IDENTITY_TTL_MS = 60_000;

/** The tenant document identity; EMPTY_DOC_IDENTITY when tenant-service cannot be read. */
export async function resolveDocIdentity(tenantId: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<DocIdentity> {
  const hit = identityCache.get(tenantId);
  if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.value;
  const base = (process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/tenants/${encodeURIComponent(tenantId)}`, { headers: internalHeaders(tenantId), signal: AbortSignal.timeout(3000) });
    if (!res.ok) return EMPTY_DOC_IDENTITY;
    const body = (await res.json()) as { name?: unknown; settings?: unknown; data?: { name?: unknown; settings?: unknown } };
    const value = docIdentityFromTenant(body.data ?? body);
    identityCache.set(tenantId, { value, at: Date.now() });
    return value;
  } catch {
    return EMPTY_DOC_IDENTITY;
  }
}

/** Test hook. */
export function resetDocIdentityCache(): void { identityCache.clear(); }

export interface Signatory { name: string; designation: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Officer name + designation per actor id. HRMS first (the employee whose login is the actor,
 * with designation), identity-service display name for anyone HRMS does not know.
 */
export async function resolveSignatories(
  tenantId: string,
  actorIds: ReadonlyArray<string | null | undefined>,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Map<string, Signatory>> {
  const wanted = [...new Set(actorIds.filter((a): a is string => typeof a === "string" && UUID_RE.test(a)))];
  const out = new Map<string, Signatory>();
  if (wanted.length === 0) return out;
  const hrms = (process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012").replace(/\/$/, "");
  for (let i = 0; i < wanted.length; i += 50) {
    const chunk = wanted.slice(i, i + 50);
    try {
      const res = await fetchImpl(`${hrms}/v1/hrms/internal/employee-summaries?actorIds=${chunk.map(encodeURIComponent).join(",")}`, { headers: internalHeaders(tenantId), signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const rows = (await res.json()) as Array<{ fullName?: unknown; designation?: unknown; designationName?: unknown; userRef?: unknown }>;
      for (const r of Array.isArray(rows) ? rows : []) {
        const ref = typeof r.userRef === "string" ? r.userRef : null;
        const name = str(r.fullName, 200);
        // r1-approvals names it designationName; older builds of this PR sent designation.
        if (ref && name) out.set(ref, { name, designation: str(r.designationName, 200) ?? str(r.designation, 200) });
      }
    } catch { /* fail open: identity fallback below */ }
  }
  const missing = wanted.filter((a) => !out.has(a));
  if (missing.length > 0) {
    const identity = (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
    try {
      const res = await fetchImpl(`${identity}/identity/internal/user-summaries`, { headers: internalHeaders(tenantId), signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const rows = (await res.json()) as Array<{ id?: unknown; name?: unknown }>;
        const set = new Set(missing);
        for (const r of Array.isArray(rows) ? rows : []) {
          const id = typeof r.id === "string" ? r.id : null;
          const name = str(r.name, 200);
          if (id && name && set.has(id)) out.set(id, { name, designation: null });
        }
      }
    } catch { /* fail open */ }
  }
  return out;
}

/** Thrown when a document cannot be issued because a mandatory identity is not configured or resolvable. */
export class DocumentNotIssuableError extends Error {
  constructor(public readonly code: string, message: string, public readonly missing: string[] = []) {
    super(message);
    this.name = "DocumentNotIssuableError";
  }
}
