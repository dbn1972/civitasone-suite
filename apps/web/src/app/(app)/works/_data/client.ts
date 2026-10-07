/**
 * works feature — client-side API calls (interactive reads).
 *
 * Uses the app's browser client (src/lib/api/browserClient.ts) which routes
 * through the BFF proxy /api/proxy/<path> (httpOnly session cookie + device
 * headers). Paths are the gateway paths WITHOUT the /api prefix, e.g.
 * "v1/works/..."; the gateway then rewrites "/api/v1/works" → the service's
 * internal "/v1/works". Every function throws on non-2xx; callers show a
 * plain-language error state. Mirrors the read surface backing the server
 * loaders in ./loaders.ts, for client components that need to refetch after
 * a mutation without a full page reload.
 */
import { browserFetch } from "@/lib/api/browserClient";
import { toHumanError } from "@/lib/messages";

/**
 * Plain-language failure message for any non-2xx response from a works-data
 * read. Every exported function below throws `Error(readError())` and
 * callers render that message directly as the UI's error state, so it must
 * never be (or contain) a raw HTTP status code or raw server response body
 * — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016. This module
 * is a plain async data-fetching client, not a component, so it can't use
 * the useFormError hook; toHumanError is the same catalogued-message
 * building block that hook is built on.
 */
function readError(): string {
  const human = toHumanError("load", { area: "works data" });
  return `${human.what} ${human.next}`;
}

async function get<T>(path: string): Promise<T> {
  const res = await browserFetch(path);
  if (!res.ok) throw new Error(readError());
  return (await res.json()) as T;
}

type Row = Record<string, unknown>;

export async function fetchBills(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/billing/bills?pageSize=100");
  return out.data ?? [];
}

export async function fetchTenders(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/tenders?pageSize=100");
  return out.data ?? [];
}

export async function fetchAaApprovals(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/approvals/aa?pageSize=100");
  return out.data ?? [];
}

export async function fetchTsApprovals(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/approvals/ts?pageSize=100");
  return out.data ?? [];
}

export async function fetchExecutionProgress(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/execution/progress?pageSize=100");
  return out.data ?? [];
}

export async function fetchExecutionIssues(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/execution/issues?pageSize=100");
  return out.data ?? [];
}

export async function fetchClosures(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/closure?pageSize=100");
  return out.data ?? [];
}

export async function fetchBoqItems(): Promise<Row[]> {
  const out = await get<{ data?: Row[] }>("v1/works/boq?pageSize=100");
  return out.data ?? [];
}

// ─── EntityPicker adapters (SF-06 shared picker) ──────────────────────────────

/** One SR master item, as the BoQ Add-item picker needs it. */
export interface SrItemOption {
  id: string;
  itemCode: string;
  description: string;
  unit: string;
  /** rate in paise (bigint-serialised string) */
  rate: string;
}

function asSrItem(r: Row): SrItemOption {
  return {
    id: String(r.id ?? ""),
    itemCode: String(r.itemCode ?? ""),
    description: String(r.description ?? ""),
    unit: String(r.unit ?? ""),
    rate: String(r.rate ?? "0"),
  };
}

/**
 * GAP-WORKS-BOQ-NEW-01: typeahead over the Schedule of Rates. `signal` is
 * passed through so a superseded keystroke's request is aborted (EntityPicker
 * contract). Returns the canonical SR rows so the form can prefill
 * code/unit/rate and post a real srItemId.
 */
export async function searchSrItems(query: string, signal?: AbortSignal): Promise<SrItemOption[]> {
  const res = await browserFetch(`v1/works/masters/sr-items/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(readError());
  const out = (await res.json()) as { data?: Row[] };
  return (out.data ?? []).map(asSrItem);
}

/** One work, as a picker option. */
export interface WorkOption {
  id: string;
  workNumber: string;
  description: string;
}

function asWork(r: Row): WorkOption {
  return {
    id: String(r.id ?? ""),
    workNumber: String(r.workNumber ?? ""),
    description: String(r.description ?? ""),
  };
}

/** GAP-WORKS-BOQ-NEW-03 / CLOSURE-01: typeahead over works by number/description. */
export async function searchWorks(query: string, signal?: AbortSignal): Promise<WorkOption[]> {
  const res = await browserFetch(`v1/works/proposals?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(readError());
  const out = (await res.json()) as { data?: Row[] };
  return (out.data ?? []).map(asWork);
}

/** Resolve work ids to options — EntityPicker seeding for a pre-set workId. */
export async function resolveWorks(ids: string[]): Promise<WorkOption[]> {
  if (ids.length === 0) return [];
  const res = await browserFetch(`v1/works/proposals?ids=${encodeURIComponent(ids.join(","))}`);
  if (!res.ok) throw new Error(readError());
  const out = (await res.json()) as { data?: Row[] };
  return (out.data ?? []).map(asWork);
}
