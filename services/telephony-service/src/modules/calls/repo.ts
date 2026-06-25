/**
 * calls repo — Drizzle queries against the `telephony` domain schema ONLY.
 *
 * Tenant scoping is enforced on every read/write. Phone numbers are decrypted
 * transparently by the `encryptedText` customType; list/summary projections
 * MASK them so PII never leaks into collection responses. Updates use
 * optimistic locking (version guard) so a stale writer cannot clobber a newer
 * state.
 */
import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { calls, type CallRow, type CallInsert, type CallView, type CallSummary, type IvrHit } from "./schema.js";
import { queues } from "../queues/schema.js";
import { blindIndex, maskPhone } from "../../shared/pii-crypto.js";
import type { CallStatus, CallDirection, Disposition } from "./transitions.js";

const DEFAULT_SLA_ANSWER_SECONDS = 20;

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Internal projection with cleartext numbers (write path + admin detail). */
export function toView(r: CallRow): CallView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    direction: r.direction as CallDirection,
    callerNumber: r.callerNumber ?? null,
    calleeNumber: r.calleeNumber ?? null,
    status: r.status as CallStatus,
    disposition: (r.disposition as Disposition | null) ?? null,
    queueId: r.queueId ?? null,
    agentId: r.agentId ?? null,
    ivrPath: (r.ivrPath as IvrHit[]) ?? [],
    linkedRefType: r.linkedRefType ?? null,
    linkedRefId: r.linkedRefId ?? null,
    recordingId: r.recordingId ?? null,
    recordingUrl: r.recordingUrl ?? null,
    recordingDurationSec: r.recordingDurationSec ?? null,
    recordingFormat: r.recordingFormat ?? null,
    queuedAt: iso(r.queuedAt),
    ringingAt: iso(r.ringingAt),
    answeredAt: iso(r.answeredAt),
    endedAt: iso(r.endedAt),
    waitSeconds: r.waitSeconds ?? null,
    talkSeconds: r.talkSeconds ?? null,
    version: r.version,
  };
}

/**
 * API projection. Numbers are masked by default (PII minimisation); pass
 * `{ unmask: true }` only for an authorised admin detail read.
 */
export function toSummary(r: CallRow, slaAnswerSeconds: number | null, opts: { unmask?: boolean } = {}): CallSummary {
  const answered = r.answeredAt != null;
  const threshold = slaAnswerSeconds ?? DEFAULT_SLA_ANSWER_SECONDS;
  const slaAnswered = answered && r.waitSeconds != null ? r.waitSeconds <= threshold : null;
  const num = (v: string | null | undefined): string | null =>
    v == null ? null : opts.unmask ? v : maskPhone(v);
  return {
    id: r.id,
    direction: r.direction as CallDirection,
    callerNumber: num(r.callerNumber),
    calleeNumber: num(r.calleeNumber),
    status: r.status as CallStatus,
    disposition: (r.disposition as Disposition | null) ?? null,
    queueId: r.queueId ?? null,
    agentId: r.agentId ?? null,
    linkedRefType: r.linkedRefType ?? null,
    linkedRefId: r.linkedRefId ?? null,
    hasRecording: r.recordingId != null,
    waitSeconds: r.waitSeconds ?? null,
    talkSeconds: r.talkSeconds ?? null,
    slaAnswered,
    abandoned: r.status === "abandoned",
    startedAt: iso(r.queuedAt ?? r.ringingAt ?? r.createdAt),
    endedAt: iso(r.endedAt),
    version: r.version,
  };
}

/** Tenant-scoped raw row — used by the consumer to make transition decisions. */
export async function findRow(id: string, tenantId: string): Promise<CallRow | null> {
  const rows = await db.select().from(calls).where(and(eq(calls.id, id), eq(calls.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findView(id: string, tenantId: string): Promise<CallView | null> {
  const row = await findRow(id, tenantId);
  return row ? toView(row) : null;
}

export type ListFilters = {
  status?: CallStatus;
  direction?: CallDirection;
  queueId?: string;
  agentId?: string;
  callerNumber?: string;
};

/** List always returns MASKED numbers — PII never leaks into collection reads. */
export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<CallSummary[]> {
  const conditions: SQL[] = [eq(calls.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(calls.status, filters.status));
  if (filters.direction) conditions.push(eq(calls.direction, filters.direction));
  if (filters.queueId) conditions.push(eq(calls.queueId, filters.queueId));
  if (filters.agentId) conditions.push(eq(calls.agentId, filters.agentId));
  // Exact caller lookup via blind index — the ciphertext column is never matched.
  if (filters.callerNumber) conditions.push(eq(calls.callerNumberIdx, blindIndex(filters.callerNumber)));

  const rows = await db
    .select({ call: calls, slaAnswerSeconds: queues.slaAnswerSeconds })
    .from(calls)
    .leftJoin(queues, eq(calls.queueId, queues.id))
    .where(and(...conditions))
    .orderBy(desc(calls.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => toSummary(r.call, r.slaAnswerSeconds ?? null));
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Derive the blind index for the (optional) caller number on a write payload. */
function withCallerIdx<T extends { callerNumber?: string | null; callerNumberIdx?: string | null }>(row: T): T {
  if (row.callerNumber) return { ...row, callerNumberIdx: blindIndex(row.callerNumber) };
  if (row.callerNumber === null) return { ...row, callerNumberIdx: null };
  return row;
}

export async function insert(tx: Writer, row: CallInsert): Promise<void> {
  await tx.insert(calls).values(withCallerIdx(row));
}

/**
 * Optimistic-locked partial update. When `expectedVersion` is supplied the
 * WHERE clause requires it to match, so a concurrent/stale writer affects 0
 * rows. Returns the number of rows updated (0 = not found OR version conflict).
 */
export async function applyUpdate(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number | undefined,
  patch: Partial<CallInsert>,
  actorId: string,
): Promise<number> {
  const where: SQL[] = [eq(calls.id, id), eq(calls.tenantId, tenantId)];
  if (expectedVersion !== undefined) where.push(eq(calls.version, expectedVersion));
  const updated = await (tx as typeof db)
    .update(calls)
    .set({ ...patch, updatedAt: new Date(), updatedBy: actorId, version: sql`${calls.version} + 1` })
    .where(and(...where))
    .returning({ id: calls.id });
  return updated.length;
}

/** Append an IVR menu hit to the call's ordered ivr_path (jsonb). */
export async function appendIvrHit(
  tx: Writer,
  id: string,
  tenantId: string,
  hit: IvrHit,
  actorId: string,
): Promise<number> {
  const updated = await (tx as typeof db)
    .update(calls)
    .set({
      ivrPath: sql`${calls.ivrPath} || ${JSON.stringify([hit])}::jsonb`,
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${calls.version} + 1`,
    })
    .where(and(eq(calls.id, id), eq(calls.tenantId, tenantId)))
    .returning({ id: calls.id });
  return updated.length;
}

export type CallMetrics = {
  total: number;
  byStatus: Record<CallStatus, number>;
  answered: number;
  abandoned: number;
  abandonmentRatePct: number;
  slaAnsweredPct: number;
  avgWaitSeconds: number | null;
  avgTalkSeconds: number | null;
};

/** Aggregate SLA / abandonment metrics for a tenant (optionally one queue). */
export async function metricsByTenant(tenantId: string, queueId?: string): Promise<CallMetrics> {
  const conditions: SQL[] = [eq(calls.tenantId, tenantId)];
  if (queueId) conditions.push(eq(calls.queueId, queueId));

  const rows = await db
    .select({
      status: calls.status,
      count: sql<number>`count(*)::int`,
      answered: sql<number>`count(*) filter (where ${calls.answeredAt} is not null)::int`,
      withinSla: sql<number>`count(*) filter (where ${calls.answeredAt} is not null and ${calls.waitSeconds} <= coalesce(${queues.slaAnswerSeconds}, ${DEFAULT_SLA_ANSWER_SECONDS}))::int`,
      avgWait: sql<number | null>`avg(${calls.waitSeconds})`,
      avgTalk: sql<number | null>`avg(${calls.talkSeconds})`,
    })
    .from(calls)
    .leftJoin(queues, eq(calls.queueId, queues.id))
    .where(and(...conditions))
    .groupBy(calls.status);

  const byStatus = { queued: 0, ringing: 0, answered: 0, completed: 0, missed: 0, abandoned: 0 } as Record<
    CallStatus,
    number
  >;
  let total = 0;
  let answered = 0;
  let withinSla = 0;
  let waitWeighted = 0;
  let talkWeighted = 0;
  let waitN = 0;
  let talkN = 0;
  for (const r of rows) {
    const c = Number(r.count);
    byStatus[r.status as CallStatus] = c;
    total += c;
    answered += Number(r.answered);
    withinSla += Number(r.withinSla);
    if (r.avgWait != null) {
      waitWeighted += Number(r.avgWait) * Number(r.answered || c);
      waitN += Number(r.answered || c);
    }
    if (r.avgTalk != null) {
      talkWeighted += Number(r.avgTalk) * c;
      talkN += c;
    }
  }
  const abandoned = byStatus.abandoned;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    total,
    byStatus,
    answered,
    abandoned,
    abandonmentRatePct: total > 0 ? round1((abandoned / total) * 100) : 0,
    slaAnsweredPct: answered > 0 ? round1((withinSla / answered) * 100) : 100,
    avgWaitSeconds: waitN > 0 ? Math.round(waitWeighted / waitN) : null,
    avgTalkSeconds: talkN > 0 ? Math.round(talkWeighted / talkN) : null,
  };
}

export { withCallerIdx };
