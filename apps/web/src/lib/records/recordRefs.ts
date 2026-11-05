import { fetchJson } from "@/app/_data/apiClient";
import { resolveUsers } from "@/lib/directory/resolveUsers";
import { isUuid, type PersonRef } from "./labels";

/**
 * UX-R5 (names, not ids): the ONE shared people / record-reference resolver for web record screens.
 *
 * A record screen collects every id it is about to show (maker, checker, officer, vendor ...) and makes one
 * call. Under the hood it batches the existing name endpoints, all in parallel:
 *
 *   people   -> hrms   GET /v1/hrms/employees/officers?ids=   name + designation; ids may be employee ids or
 *                                                          login user refs (the JWT sub stored as created_by)
 *            -> identity GET /v1/identity/users/directory?ids= name only; matches identity ids AND Keycloak subs
 *               (fallback for logins with no employee record, e.g. administrators)
 *   vendors  -> procurement GET /v1/procurement/vendors/names?ids=   (user-facing twin of internal/vendor-names)
 *
 * Tenant scope: every call carries the signed-in user session, and each endpoint filters by the token tenant
 * server-side, so a name outside the caller tenant can never resolve.
 * Caching: identical lookups in one render are deduped by Next fetch memoisation; across renders they are cached
 * for REVALIDATE_SECONDS. Batched: at most 100 ids per request, never one request per row.
 * Fail-soft: a failed or partial lookup simply leaves ids out of the maps; labels.ts then renders the honest
 * "Name not available (ID ending ...)" text. Never throws.
 *
 * Server-only (imports apiClient -> next/headers). Client components receive the resolved maps or labels as props.
 */

const IDS_PER_REQUEST = 100;
const REVALIDATE_SECONDS = 60;

export type RecordRefsRequest = {
  people?: Iterable<string | null | undefined>;
  vendors?: Iterable<string | null | undefined>;
};

export type RecordRefs = {
  people: Map<string, PersonRef>;
  vendors: Map<string, string>;
};

function uniqueUuids(ids: Iterable<string | null | undefined> | undefined): string[] {
  if (!ids) return [];
  const out = new Set<string>();
  for (const id of ids) if (isUuid(id)) out.add(id.trim());
  return [...out];
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type OfficerRow = { id?: unknown; name?: unknown; designation?: unknown };
type NameRow = { id?: unknown; name?: unknown };

function rowsOf(payload: unknown): unknown[] | null {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  return Array.isArray(rows) ? rows : null;
}

export function toOfficerEntries(payload: unknown): Array<[string, PersonRef]> | null {
  const rows = rowsOf(payload);
  if (!rows) return null;
  const out: Array<[string, PersonRef]> = [];
  for (const raw of rows as OfficerRow[]) {
    if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string" || !raw.name.trim()) continue;
    out.push([raw.id, { name: raw.name.trim(), designation: typeof raw.designation === "string" && raw.designation.trim() ? raw.designation.trim() : null }]);
  }
  return out;
}

export function toNameEntries(payload: unknown): Array<[string, string]> | null {
  const rows = rowsOf(payload);
  if (!rows) return null;
  const out: Array<[string, string]> = [];
  for (const raw of rows as NameRow[]) {
    if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string" || !raw.name.trim()) continue;
    out.push([raw.id, raw.name.trim()]);
  }
  return out;
}

async function batched<T>(ids: string[], load: (chunk: string[]) => Promise<Array<[string, T]>>): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (ids.length === 0) return out;
  const pages = await Promise.all(chunks(ids, IDS_PER_REQUEST).map(load));
  for (const page of pages) for (const [k, v] of page) out.set(k, v);
  return out;
}

async function loadOfficers(ids: string[]): Promise<Map<string, PersonRef>> {
  return batched(ids, async (chunk) => {
    const res = await fetchJson<unknown, Array<[string, PersonRef]>>(
      `/v1/hrms/employees/officers?ids=${chunk.map(encodeURIComponent).join(",")}`,
      [],
      { telemetryKey: "records.refs.officers", revalidateSeconds: REVALIDATE_SECONDS, mapResponse: toOfficerEntries },
    );
    return Array.isArray(res.data) ? res.data : [];
  });
}

async function loadVendors(ids: string[]): Promise<Map<string, string>> {
  return batched(ids, async (chunk) => {
    const res = await fetchJson<unknown, Array<[string, string]>>(
      `/v1/procurement/vendors/names?ids=${chunk.map(encodeURIComponent).join(",")}`,
      [],
      { telemetryKey: "records.refs.vendors", revalidateSeconds: REVALIDATE_SECONDS, mapResponse: toNameEntries },
    );
    return Array.isArray(res.data) ? res.data : [];
  });
}

/** Merge: an officer entry (name + designation) wins; a directory-only name fills the rest. */
export function mergePeople(officers: ReadonlyMap<string, PersonRef>, directory: ReadonlyMap<string, string>): Map<string, PersonRef> {
  const out = new Map<string, PersonRef>(officers);
  for (const [id, name] of directory) if (!out.has(id) && name.trim()) out.set(id, { name: name.trim(), designation: null });
  return out;
}

/** Resolve every reference a record screen shows, in one parallel, batched, cached, tenant-scoped pass. */
export async function resolveRecordRefs(req: RecordRefsRequest): Promise<RecordRefs> {
  const people = uniqueUuids(req.people);
  const vendors = uniqueUuids(req.vendors);
  const [officers, directory, vendorNames] = await Promise.all([
    loadOfficers(people).catch(() => new Map<string, PersonRef>()),
    people.length ? resolveUsers(people).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
    loadVendors(vendors).catch(() => new Map<string, string>()),
  ]);
  return { people: mergePeople(officers, directory), vendors: vendorNames };
}
