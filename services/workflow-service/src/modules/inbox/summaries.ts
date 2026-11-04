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
 * Who sees what (PR #2460 review, blocker 2):
 * - Workflow facts (instance title, maker, stage) need the #2445 participant gate
 *   (participantFilterSql), which includes the super_admin / workflow_admin bypass. A ref that fails
 *   it yields nothing at all, exactly like a ref that does not exist.
 * - Business facts from the owning modules (amount, reference, leave dates, file subject) are fetched
 *   ONLY for refs where the viewer is a STRICT participant: the initiator, an actual past decider, or
 *   the assignee / role-holder of an OPEN task. The admin bypass and the holders of a closed step
 *   role get workflow facts only.
 * - The owning service is called with the CALLER token (not the super_admin service identity), so
 *   its own scope applies on top (procurement reader roles, hrms leave scope, payroll reader roles,
 *   estab clearance). A call without a caller token gets no business facts.
 * Batched: one SQL statement for the gate, then one call per owning service per 50 refs, plus the
 * people lookup, all in parallel. Cached briefly per tenant + viewer + ref set.
 */
export const MAX_SUMMARY_REFS = 200;
export const SUMMARY_TTL_SECONDS = 30;
const ADAPTER_BATCH = 50;

const PROCUREMENT_URL = process.env.PROCUREMENT_SERVICE_URL ?? "http://127.0.0.1:3008";
const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";
const PAYROLL_URL = process.env.PAYROLL_SERVICE_URL ?? "http://127.0.0.1:3013";
const ESTAB_URL = process.env.ESTAB_SERVICE_URL ?? "http://127.0.0.1:3010";

export type RefKey = { refType: string; refId: string };

/** A labelled business fact. `key` is a stable message key the web translates (never shown raw). */
export type SummaryField = { key: string; value: string };

export type RefSummary = {
  refType: string;
  refId: string;
  /** "business" when the owning module answered; "generic" when only workflow facts are known. */
  kind: "business" | "generic";
  instanceId: string;
  instanceName: string;
  reference: string | null;
  amountMinor: string | null;
  fields: SummaryField[];
  maker: Person | null;
  stage: { level: number; of: number | null; step: string | null };
  /** When the item was raised (instance creation). */
  raisedAt: string;
  parentId?: string;
};

type AdapterFacts = { reference: string | null; amountMinor: string | null; fields: SummaryField[]; parentId?: string };
type Adapter = (tenantId: string, refs: RefKey[], fetchImpl: typeof fetch, callerAuth: string) => Promise<Map<string, AdapterFacts>>;

function callerHeaders(tenantId: string, callerAuth: string, json = false): Record<string, string> {
  return { authorization: callerAuth, "x-tenant-id": tenantId, ...(json ? { "content-type": "application/json" } : {}) };
}

const TIMEOUT = () => AbortSignal.timeout(Number(process.env.SUMMARY_LOOKUP_TIMEOUT_MS ?? 2500));

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const key = (r: RefKey) => `${r.refType}:${r.refId}`;

function rowsOf(body: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

const minorOf = (v: unknown): string | null => (typeof v === "string" && /^-?\d+$/.test(v) ? v : null);

/** procurement-service POST /v1/procurement/approvals/ref-summaries (indent, PO, PO amendment). */
const procurementAdapter: Adapter = async (tenantId, refs, fetchImpl, auth) => {
  const out = new Map<string, AdapterFacts>();
  await Promise.all(chunk(refs, ADAPTER_BATCH).map(async (batch) => {
    try {
      const res = await fetchImpl(`${PROCUREMENT_URL}/v1/procurement/approvals/ref-summaries`, {
        method: "POST", headers: callerHeaders(tenantId, auth, true), body: JSON.stringify({ refs: batch }), signal: TIMEOUT(),
      });
      if (!res.ok) return;
      for (const s of rowsOf(await res.json())) {
        if (typeof s.refType !== "string" || typeof s.refId !== "string") continue;
        out.set(`${s.refType}:${s.refId}`, {
          reference: typeof s.label === "string" && s.label ? s.label : null,
          amountMinor: minorOf(s.amountMinor),
          fields: [],
          ...(typeof s.poId === "string" ? { parentId: s.poId } : {}),
        });
      }
    } catch { /* generic fallback */ }
  }));
  return out;
};

/** hrms-service GET /v1/hrms/leave-requests?ids= (leave type, dates, days) under the caller scope. */
const leaveAdapter: Adapter = async (tenantId, refs, fetchImpl, auth) => {
  const out = new Map<string, AdapterFacts>();
  await Promise.all(chunk(refs, ADAPTER_BATCH).map(async (batch) => {
    try {
      const res = await fetchImpl(`${HRMS_URL}/v1/hrms/leave-requests?ids=${batch.map((r) => r.refId).join(",")}`, {
        headers: callerHeaders(tenantId, auth), signal: TIMEOUT(),
      });
      if (!res.ok) return;
      for (const l of rowsOf(await res.json())) {
        if (typeof l.id !== "string") continue;
        const fields: SummaryField[] = [];
        if (typeof l.leaveType === "string" && l.leaveType) fields.push({ key: "leaveType", value: l.leaveType });
        if (typeof l.fromDate === "string" && l.fromDate) fields.push({ key: "fromDate", value: l.fromDate });
        if (typeof l.toDate === "string" && l.toDate) fields.push({ key: "toDate", value: l.toDate });
        const days = typeof l.days === "number" ? l.days : typeof l.daysApplied === "number" ? l.daysApplied : null;
        if (days !== null) fields.push({ key: "days", value: String(days) });
        out.set(`leave_app:${l.id}`, { reference: null, amountMinor: null, fields });
      }
    } catch { /* generic fallback */ }
  }));
  return out;
};

/**
 * payroll-service GET /v1/payroll/runs?limit=100 (payroll has no id-batch read; runs are few, so the
 * most recent 100 cover every run awaiting approval). Pay period, employees and net amount.
 */
const payrollAdapter: Adapter = async (tenantId, refs, fetchImpl, auth) => {
  const out = new Map<string, AdapterFacts>();
  const wanted = new Set(refs.map((r) => r.refId));
  try {
    const res = await fetchImpl(`${PAYROLL_URL}/v1/payroll/runs?limit=100`, { headers: callerHeaders(tenantId, auth), signal: TIMEOUT() });
    if (!res.ok) return out;
    for (const r of rowsOf(await res.json())) {
      if (typeof r.id !== "string" || !wanted.has(r.id)) continue;
      const fields: SummaryField[] = [];
      if (typeof r.payPeriod === "string" && r.payPeriod) fields.push({ key: "payPeriod", value: r.payPeriod });
      if (typeof r.employeeCount === "number") fields.push({ key: "employees", value: String(r.employeeCount) });
      out.set(`payroll_run:${r.id}`, { reference: null, amountMinor: minorOf(r.netMinor), fields });
    }
  } catch { /* generic fallback */ }
  return out;
};

/**
 * estab-service GET /v1/estab/files?limit=500 (no id-batch read exists; the list is already filtered
 * by the caller clearance, so a classified file the caller may not open yields no facts). File number
 * and subject. A file outside the newest 500 degrades to the generic summary.
 */
const estabAdapter: Adapter = async (tenantId, refs, fetchImpl, auth) => {
  const out = new Map<string, AdapterFacts>();
  const wanted = new Set(refs.map((r) => r.refId));
  try {
    const res = await fetchImpl(`${ESTAB_URL}/v1/estab/files?limit=500`, { headers: callerHeaders(tenantId, auth), signal: TIMEOUT() });
    if (!res.ok) return out;
    for (const f of rowsOf(await res.json())) {
      if (typeof f.id !== "string" || !wanted.has(f.id)) continue;
      const fields: SummaryField[] = [];
      if (typeof f.subject === "string" && f.subject) fields.push({ key: "subject", value: f.subject });
      out.set(`estab_file:${f.id}`, { reference: typeof f.fileNo === "string" && f.fileNo ? f.fileNo : null, amountMinor: null, fields });
    }
  } catch { /* generic fallback */ }
  return out;
};

/** Owning service per refType. A refType that is not listed degrades to the generic summary. */
export const SUMMARY_ADAPTERS: Readonly<Record<string, { service: string; adapter: Adapter }>> = {
  procurement_indent: { service: "procurement", adapter: procurementAdapter },
  procurement_po: { service: "procurement", adapter: procurementAdapter },
  procurement_po_amendment: { service: "procurement", adapter: procurementAdapter },
  leave_app: { service: "hrms-leave", adapter: leaveAdapter },
  payroll_run: { service: "payroll", adapter: payrollAdapter },
  estab_file: { service: "estab", adapter: estabAdapter },
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
  callerAuth?: string,
): Promise<RefSummary[]> {
  const wanted = dedupe(refs).slice(0, MAX_SUMMARY_REFS);
  const instances = await deps.instancesForRefs(tenantId, wanted, viewer);
  if (instances.length === 0) return [];

  // Business facts: strict participants only, and only with the caller token to pass on.
  const byService = new Map<string, { adapter: Adapter; refs: RefKey[] }>();
  if (callerAuth) {
    for (const i of instances) {
      const a = SUMMARY_ADAPTERS[i.refType];
      if (!a || !i.strict) continue;
      const g = byService.get(a.service) ?? { adapter: a.adapter, refs: [] };
      g.refs.push({ refType: i.refType, refId: i.refId });
      byService.set(a.service, g);
    }
  }
  const [factsByService, people] = await Promise.all([
    Promise.all([...byService.values()].map((g) => g.adapter(tenantId, g.refs, deps.fetchImpl, callerAuth!).catch(() => new Map<string, AdapterFacts>()))),
    deps.people(tenantId, instances.map((i) => i.createdBy), deps.fetchImpl, callerAuth).catch(() => new Map<string, Person>()),
  ]);
  const facts = new Map<string, AdapterFacts>();
  for (const m of factsByService) for (const [k, v] of m) facts.set(k, v);

  return instances.map((i: RefInstance) => {
    const f = i.strict ? facts.get(`${i.refType}:${i.refId}`) : undefined;
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
      raisedAt: i.createdAt,
      ...(f?.parentId ? { parentId: f.parentId } : {}),
    } satisfies RefSummary;
  });
}

/** Cached entry point used by the routes. The viewer (sorted roles + actor) is part of the key. */
export async function getRefSummaries(tenantId: string, viewer: InstanceViewer, refs: RefKey[], callerAuth?: string): Promise<RefSummary[]> {
  const wanted = dedupe(refs).slice(0, MAX_SUMMARY_REFS);
  const hash = createHash("sha256").update(JSON.stringify({
    roles: [...new Set(viewer.roles)].sort(),
    actor: viewer.actorId ?? null,
    auth: Boolean(callerAuth),
    refs: wanted.map(key).sort(),
  })).digest("hex").slice(0, 40);
  const result = await cache.getOrLoad<RefSummary[]>(
    cache.makeKey(tenantId, "ref-summaries", hash),
    () => buildRefSummaries(tenantId, viewer, wanted, defaultDeps, callerAuth),
    SUMMARY_TTL_SECONDS,
  );
  return result ?? [];
}

/** All summaries for up to `refs.length` refs, in batches of MAX_SUMMARY_REFS (each cached). */
export async function getRefSummariesBatched(tenantId: string, viewer: InstanceViewer, refs: RefKey[], callerAuth?: string): Promise<RefSummary[]> {
  const parts = await Promise.all(chunk(dedupe(refs), MAX_SUMMARY_REFS).map((c) => getRefSummaries(tenantId, viewer, c, callerAuth)));
  return parts.flat();
}
