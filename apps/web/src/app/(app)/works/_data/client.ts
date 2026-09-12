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
