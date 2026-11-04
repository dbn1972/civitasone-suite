import { createHash } from "node:crypto";
import { cache } from "../../shared/infra.js";
import { resolvePeople, type Person } from "../../shared/people-client.js";
import type { InstanceViewer } from "../instances/repo.js";
import { participantInstancesForRefs, type RefInstance } from "./repo.js";

/**
 * UX R1: POST /v1/workflow/ref-summaries. The business context of a batch of workflow refs
 * (refType + refId) across modules, so an approvals row reads "Approve purchase order PO/2026/0033,
 * Rs 1,23,456.00, from A. Verma, Section Officer, Level 2 of 3" instead of "Review".
 *
 * - Scoped: one SQL statement keeps only refs whose instance the caller participates in (#2445
 *   participantFilterSql) in the caller tenant. A non-participant never gets a summary.
 * - Batched: after that statement, one call per owning service per 50 refs (procurement, hrms
 *   leave) and one people lookup (shared/people-client), all in parallel; never per row.
 * - Graceful: a refType with no adapter, or an owning service that fails, still yields the
 *   workflow-level summary (title, maker, stage) with kind "generic".
 * - Cached briefly (SUMMARY_TTL_SECONDS) per tenant + viewer + ref set.
 */
export const MAX_SUMMARY_REFS = 200;
export const SUMMARY_TTL_SECONDS = 30;
const ADAPTER_BATCH = 50;

const PROCUREMENT_URL = process.env.PROCUREMENT_SERVICE_URL ?? "http://127.0.0.1:3008";
const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";

export type RefKey = { refType: string; refId: string };

/** A labelled business fact. `key` is a stable message key the web translates (never shown raw). */
export type SummaryField = { key: string; value: string };

export type RefSummary = {
  refType: string;
  refId: string;
  /** "business" when the owning module answered; "generic" when only workflow facts are known. */
  kind: "business" | "generic";
  instanceId: string;
  /** The workflow instance title (already human text, e.g. "PO Amendment #5 Approval"). */
  instanceName: string;
  /** Business reference number (PO/2026/0033, IND/2026/0001), null when the module has none. */
  reference: string | null;
  /** Amount in minor units (paise) as a decimal string; null when the record carries no amount. */
  amountMinor: string | null;
  fields: SummaryField[];
  maker: Person | null;
  stage: { level: number; of: number | null; step: string | null };
  /** For an amendment: the parent purchase order, so the web can link to it. */
  parentId?: string;
};

type AdapterFacts = { reference: string | null; amountMinor: string | null; fields: SummaryField[]; parentId?: string };
type Adapter = (tenantId: string, refs: RefKey[], fetchImpl: typeof fetch) => Promise<Map<string, AdapterFacts>>;

function internalHeaders(tenantId: string): Record<string, string> {
  return { "content-type": "application/json", "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId };
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const key = (r: RefKey) => `${r.refType}:${r.refId}`;

/** procurement-service POST /v1/procurement/approvals/ref-summaries (indent, PO, PO amendment). */
const procurementAdapter: Adapter = async (tenantId, refs, fetchImpl) => {
  const out = new Map<string, AdapterFacts>();
  await Promise.all(chunk(refs, ADAPTER_BATCH).map(async (batch) => {
    try {
      const res = await fetchImpl(`${PROCUREMENT_URL}/v1/procurement/approvals/ref-summaries`, {
        method: "POST",
        headers: internalHeaders(tenantId),
        body: JSON.stringify({ refs: batch }),
        signal: AbortSignal.timeout(Number(process.env.SUMMARY_LOOKUP_TIMEOUT_MS ?? 2500)),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: Array<{ refType?: unknown; refId?: unknown; label?: unknown; amountMinor?: unknown; poId?: unknown }> };
      for (const s of body.data ?? []) {
        if (typeof s?.refType !== "string" || typeof s.refId !== "string") continue;
        out.set(`${s.refType}:${s.refId}`, {
          reference: typeof s.label === "string" && s.label ? s.label : null,
          amountMinor: typeof s.amountMinor === "string" && /^-?\d+$/.test(s.amountMinor) ? s.amountMinor : null,
          fields: [],
          ...(typeof s.poId === "string" ? { parentId: s.poId } : {}),
        });
      }
    } catch {
      /* generic fallback */
    }
  }));
  return out;
};

/** hrms-service GET /v1/hrms/leave-requests?ids= (leave type, dates, days). */
const leaveAdapter: Adapter = async (tenantId, refs, fetchImpl) => {
  const out = new Map<string, AdapterFacts>();
  await Promise.all(chunk(refs, ADAPTER_BATCH).map(async (batch) => {
    try {
      const res = await fetchImpl(`${HRMS_URL}/v1/hrms/leave-requests?ids=${batch.map((r) => r.refId).join(",")}`, {
        headers: internalHeaders(tenantId),
        signal: AbortSignal.timeout(Number(process.env.SUMMARY_LOOKUP_TIMEOUT_MS ?? 2500)),
      });
      if (!res.ok) return;
      const body = (await res.json()) as unknown;
      const rows = Array.isArray(body) ? body : ((body as { data?: unknown })?.data ?? []);
      if (!Array.isArray(rows)) return;
      for (const l of rows as Array<Record<string, unknown>>) {
        if (typeof l?.id !== "string") continue;
        const fields: SummaryField[] = [];
        if (typeof l.leaveType === "string" && l.leaveType) fields.push({ key: "leaveType", value: l.leaveType });
        if (typeof l.fromDate === "string" && l.fromDate) fields.push({ key: "fromDate", value: l.fromDate });
        if (typeof l.toDate === "string" && l.toDate) fields.push({ key: "toDate", value: l.toDate });
        const days = typeof l.days === "number" ? l.days : typeof l.daysApplied === "number" ? l.daysApplied : null;
        if (days !== null) fields.push({ key: "days", value: String(days) });
        out.set(`leave_app:${l.id}`, { reference: null, amountMinor: null, fields });
      }
    } catch {
      /* generic fallback */
    }
  }));
  return out;
};

/** Owning service per refType. A refType that is not listed degrades to the generic summary. */
export const SUMMARY_ADAPTERS: Readonly<Record<string, { service: string; adapter: Adapter }>> = {
  procurement_indent: { service: "procurement", adapter: procurementAdapter },
  procurement_po: { service: "procurement", adapter: procurementAdapter },
  procurement_po_amendment: { service: "procurement", adapter: procurementAdapter },
  leave_app: { service: "hrms-leave", adapter: leaveAdapter },
};

export type SummaryDeps = {
  instancesForRefs: typeof participantInstancesForRefs;
  people: typeof resolvePeople;
  fetchImpl: typeof fetch;
};

const defaultDeps: SummaryDeps = { instancesForRefs: participantInstancesForRefs, people: resolvePeople, fetchImpl: (...a) => fetch(...a) };

function dedupe(refs: RefKey[]): RefKey[] {
  const seen = new Set<string>();
  const out: RefKey[] = [];
  for (const r of refs) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Uncached build; exported for tests (inject deps to count calls). */
export async function buildRefSummaries(
  tenantId: string,
  viewer: InstanceViewer,
  refs: RefKey[],
  deps: SummaryDeps = defaultDeps,
): Promise<RefSummary[]> {
  const wanted = dedupe(refs).slice(0, MAX_SUMMARY_REFS);
  const instances = await deps.instancesForRefs(tenantId, wanted, viewer);
  if (instances.length === 0) return [];

  // Group the permitted refs by owning service: one adapter run per service.
  const byService = new Map<string, { adapter: Adapter; refs: RefKey[] }>();
  for (const i of instances) {
    const a = SUMMARY_ADAPTERS[i.refType];
    if (!a) continue;
    const g = byService.get(a.service) ?? { adapter: a.adapter, refs: [] };
    g.refs.push({ refType: i.refType, refId: i.refId });
    byService.set(a.service, g);
  }
  const [factsByService, people] = await Promise.all([
    Promise.all([...byService.values()].map((g) => g.adapter(tenantId, g.refs, deps.fetchImpl).catch(() => new Map<string, AdapterFacts>()))),
    deps.people(tenantId, instances.map((i) => i.createdBy), deps.fetchImpl).catch(() => new Map<string, Person>()),
  ]);
  const facts = new Map<string, AdapterFacts>();
  for (const m of factsByService) for (const [k, v] of m) facts.set(k, v);

  return instances.map((i: RefInstance) => {
    const f = facts.get(`${i.refType}:${i.refId}`);
    const of = i.levels > 0 ? i.levels : null;
    const level = Math.max(1, of ? Math.min(i.doneSteps + 1, of) : i.doneSteps + 1);
    return {
      refType: i.refType,
      refId: i.refId,
      kind: f ? "business" : "generic",
      instanceId: i.instanceId,
      instanceName: i.name,
      reference: f?.reference ?? null,
      amountMinor: f?.amountMinor ?? null,
      fields: f?.fields ?? [],
      maker: people.get(i.createdBy) ?? null,
      stage: { level, of, step: i.currentStep },
      ...(f?.parentId ? { parentId: f.parentId } : {}),
    } satisfies RefSummary;
  });
}

/** Cached entry point used by the route. The viewer (roles + actor) is part of the key. */
export async function getRefSummaries(tenantId: string, viewer: InstanceViewer, refs: RefKey[]): Promise<RefSummary[]> {
  const wanted = dedupe(refs).slice(0, MAX_SUMMARY_REFS);
  const viewerKey = `${[...new Set(viewer.roles)].sort().join("+")}@${viewer.actorId ?? "-"}`;
  const refKey = wanted.map(key).sort().join(",");
  const hash = createHash("sha256").update(`${viewerKey}|${refKey}`).digest("hex").slice(0, 32);
  const result = await cache.getOrLoad<RefSummary[]>(
    cache.makeKey(tenantId, "ref-summaries", hash),
    () => buildRefSummaries(tenantId, viewer, wanted),
    SUMMARY_TTL_SECONDS,
  );
  return result ?? [];
}
