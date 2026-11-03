/**
 * UAT bundle 15 (F133): turn a tenant.tenant.created event into the admin directory row.
 *
 * tenant-service now sends the v1.1 payload (directory fields, contract tenantTenantCreated in
 * @civitasone/events/contracts). A v1.0 event -- `{ tenantId, plan }`, the shape sent before the fix and still sitting
 * in queues/DLQs -- lacks name, domain, region and residency; those are fetched from tenant-service (the owner of the
 * tenant record) instead of being guessed. A name or domain is never fabricated: if the owner does not know the
 * tenant the event is refused, so it is retried / dead-lettered loudly rather than registering a wrong row.
 */
import { NonRetryableError } from "@civitasone/queue";
import { missingTenantDirectoryFields, tenantTenantCreated, type TenantCreatedEvent } from "@civitasone/events/contracts";

export type TenantDirectoryRow = {
  id: string;
  name: string;
  domain: string;
  edition: string;
  status: string;
  region: string;
  residency: string;
};

/** The tenant record as tenant-service returns it (GET /v1/tenants/:id); only the directory fields are read. */
export type FetchedTenant = Partial<Pick<TenantCreatedEvent, "id" | "name" | "domain" | "edition" | "status" | "region" | "residency">>;
export type FetchTenant = (tenantId: string) => Promise<FetchedTenant | null>;

/**
 * The event cannot become a directory row (contract violation, no tenant id, the owner does not know the tenant, or a
 * field is still missing). Retrying cannot help, so it is a NonRetryableError: the queue dead-letters it at once.
 */
export class TenantCreatedIncompleteError extends NonRetryableError {
  constructor(message: string) {
    super(message);
    this.name = "TenantCreatedIncompleteError";
  }
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v : undefined);

/** tenant-service edition "govt" is the admin directory edition "govt_dept"; every other edition is the same word. */
export function adminEdition(edition: string): string {
  return edition === "govt" ? "govt_dept" : edition;
}

export async function resolveTenantCreated(p: TenantCreatedEvent, fetchTenant: FetchTenant): Promise<TenantDirectoryRow> {
  const id = text(p.id) ?? text(p.tenantId);
  if (!id) throw new TenantCreatedIncompleteError("tenant.tenant.created carries no tenant id");
  const check = tenantTenantCreated.validate(p);
  if (!check.ok) {
    const fields = check.violation?.issues.map((i) => i.path).join(", ") ?? "payload";
    throw new TenantCreatedIncompleteError(`tenant.tenant.created violates the contract (${fields})`);
  }
  if (text(p.id) && text(p.tenantId) && p.id !== p.tenantId) {
    throw new TenantCreatedIncompleteError("tenant.tenant.created: id and tenantId name different tenants");
  }

  let fetched: FetchedTenant | null = null;
  if (missingTenantDirectoryFields(p).length > 0) {
    fetched = await fetchTenant(id);
  }
  // The event wins for every field it carries; the owner record only fills gaps.
  const pick = (k: keyof FetchedTenant): string | undefined => text(p[k]) ?? text(fetched?.[k]);
  const name = pick("name");
  const domain = pick("domain");
  const edition = text(p.edition) ?? text(p.plan) ?? text(fetched?.edition);
  const region = pick("region");
  const residency = pick("residency");
  const missing = Object.entries({ name, domain, edition, region, residency }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new TenantCreatedIncompleteError(
      `tenant ${id}: tenant.tenant.created lacks ${missing.join(", ")} and tenant-service ${fetched ? "does not supply them" : "does not know the tenant"}`,
    );
  }
  return {
    id, name: name!, domain: domain!, edition: adminEdition(edition!),
    status: pick("status") ?? "draft", region: region!, residency: residency!,
  };
}

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface TenantServiceFetcherOptions {
  baseUrl?: string;
  secret?: string;
  fetchFn?: FetchLike;
  correlationId?: string;
  timeoutMs?: number;
}

/**
 * Read one tenant from tenant-service over the internal service seam (x-internal + INTERNAL_SERVICE_SECRET), scoped
 * to that same tenant (x-tenant-id), the way lead-ingestion/crm-client.ts calls crm-service. Read-only.
 * 404 -> null (tenant-service does not know it). Any other failure throws, so the event is redelivered.
 */
export function makeTenantServiceFetcher(opts: TenantServiceFetcherOptions = {}): FetchTenant {
  const baseUrl = (opts.baseUrl ?? process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
  const secret = opts.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? "";
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 10000;
  return async (tenantId: string) => {
    const res = await fetchFn(`${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}`, {
      method: "GET",
      headers: {
        "x-internal": "1",
        "x-service-secret": secret,
        "x-tenant-id": tenantId,
        "x-correlation-id": opts.correlationId ?? `admin-tenant-sync-${tenantId}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tenant-service GET /v1/tenants/${tenantId} failed: HTTP ${res.status}`);
    const body = JSON.parse(await res.text()) as unknown;
    const view = body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body;
    return view && typeof view === "object" ? (view as FetchedTenant) : null;
  };
}
