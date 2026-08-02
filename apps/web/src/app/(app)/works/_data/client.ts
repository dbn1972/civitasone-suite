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

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `Request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as {
        message?: string;
        code?: string;
        error?: { message?: string; code?: string };
      };
      return j.error?.message ?? j.message ?? j.error?.code ?? j.code ?? text;
    } catch {
      return text;
    }
  } catch {
    return `Request failed (${res.status})`;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await browserFetch(path);
  if (!res.ok) throw new Error(await readError(res));
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
