// Server-only data for the unified approvals inbox (UX R1). Imports next/headers via apiClient.
import { cookies } from "next/headers";
import { COOKIE } from "@/lib/auth/config";
import { fetchJson } from "@/app/_data/apiClient";
import type { InboxCounts, InboxTab, InboxTask, RefSummary } from "../_lib/inboxModel";

/** The inbox renders at most this many rows per tab on the first load (client-side paging of 25). */
export const INBOX_WINDOW = 200;

export type InboxData = {
  tasks: InboxTask[];
  total: number;
  counts: InboxCounts | null;
  summaries: RefSummary[];
  source: "api" | "error";
  status?: number;
};

const EMPTY: InboxData = { tasks: [], total: 0, counts: null, summaries: [], source: "error" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mapCounts(v: unknown): InboxCounts | null {
  if (!isRecord(v)) return null;
  const n = (k: string) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? (v[k] as number) : null);
  const waiting = n("waiting"), overdue = n("overdue"), sent = n("sent"), done = n("done");
  return waiting === null || overdue === null || sent === null || done === null ? null : { waiting, overdue, sent, done };
}

function mapTask(v: unknown): InboxTask | null {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.instanceId !== "string") return null;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
  return {
    id: v.id,
    instanceId: v.instanceId,
    name: s("name") ?? "",
    status: s("status") ?? "pending",
    decision: s("decision"),
    refType: s("refType"),
    refId: s("refId"),
    dueAt: s("dueAt"),
    createdAt: s("createdAt"),
    completedAt: s("completedAt"),
    instanceName: s("instanceName"),
  };
}

function mapSummary(v: unknown): RefSummary | null {
  if (!isRecord(v) || typeof v.refType !== "string" || typeof v.refId !== "string") return null;
  const stage = isRecord(v.stage) ? v.stage : {};
  const maker = isRecord(v.maker) && typeof v.maker.name === "string"
    ? { name: v.maker.name, designation: typeof v.maker.designation === "string" ? v.maker.designation : null }
    : null;
  return {
    refType: v.refType,
    refId: v.refId,
    kind: v.kind === "business" ? "business" : "generic",
    instanceId: typeof v.instanceId === "string" ? v.instanceId : "",
    instanceName: typeof v.instanceName === "string" ? v.instanceName : "",
    reference: typeof v.reference === "string" ? v.reference : null,
    amountMinor: typeof v.amountMinor === "string" ? v.amountMinor : null,
    fields: Array.isArray(v.fields)
      ? v.fields.filter((f): f is { key: string; value: string } => isRecord(f) && typeof f.key === "string" && typeof f.value === "string")
      : [],
    maker,
    stage: {
      level: typeof stage.level === "number" ? stage.level : 1,
      of: typeof stage.of === "number" ? stage.of : null,
      step: typeof stage.step === "string" ? stage.step : null,
    },
    ...(typeof v.parentId === "string" ? { parentId: v.parentId } : {}),
  };
}

function gatewayBase(): string | null {
  const base = process.env.CIVITASONE_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || null;
  return base ? base.replace(/\/$/, "") : null;
}

/** POST /v1/workflow/ref-summaries (a read; POST only because the refs are a body). Fails soft to []. */
export async function loadSummaries(tasks: readonly InboxTask[]): Promise<RefSummary[]> {
  const refs = [...new Map(tasks.filter((t) => t.refType && t.refId).map((t) => [`${t.refType}:${t.refId}`, { refType: t.refType!, refId: t.refId! }])).values()];
  if (refs.length === 0) return [];
  const base = gatewayBase();
  const token = (await cookies()).get(COOKIE.ACCESS)?.value;
  if (!base || !token) return [];
  try {
    const res = await fetch(`${base}/api/v1/workflow/ref-summaries`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ refs: refs.slice(0, INBOX_WINDOW) }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: unknown };
    return Array.isArray(body.data) ? body.data.map(mapSummary).filter((s): s is RefSummary => s !== null) : [];
  } catch {
    return [];
  }
}

/** One tab of GET /v1/workflow/inbox (up to INBOX_WINDOW rows) plus the business summaries. */
export async function loadInbox(tab: InboxTab, opts: { refTypes?: readonly string[]; q?: string } = {}): Promise<InboxData> {
  const params = new URLSearchParams({ tab, limit: String(INBOX_WINDOW), offset: "0" });
  for (const r of opts.refTypes ?? []) params.append("refType", r);
  if (opts.q) params.set("q", opts.q);
  const res = await fetchJson<unknown, Omit<InboxData, "summaries" | "source" | "status">>(
    `/api/v1/workflow/inbox?${params.toString()}`,
    { tasks: [], total: 0, counts: null },
    {
      revalidateSeconds: 0,
      telemetryKey: "approvals.inbox",
      mapResponse: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
        const tasks = payload.data.map(mapTask).filter((t): t is InboxTask => t !== null);
        const total = isRecord(payload.pagination) && typeof payload.pagination.total === "number" ? payload.pagination.total : tasks.length;
        return { tasks, total, counts: mapCounts(payload.counts) };
      },
    },
  );
  if (res.source === "error") return { ...EMPTY, ...(res.status !== undefined ? { status: res.status } : {}) };
  const summaries = await loadSummaries(res.data.tasks);
  return { ...res.data, summaries, source: "api" };
}
