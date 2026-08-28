/**
 * activation repo — durable storage for the activation funnel (north star: TTFRT).
 *
 * Reuses analytics' own `fact_events` projection table (no new schema). Each
 * golden-path milestone is one row with source="activation" and event_type=step.
 * Idempotent earliest-wins: dedupe_key = "activation:<step>" and an explicit
 * existence check runs INSIDE the same transaction as the insert, so the FIRST
 * occurrence wins even if a step is emitted more than once. Tenant-scoped (RLS
 * isolates per office).
 *
 * NOTE: fact_events is PARTITION BY RANGE (ingested_at) (migration 0007). On a
 * partitioned table every unique index must include the partition key, so the
 * old 2-column onConflictDoNothing({ target: [tenantId, dedupeKey] }) arbiter
 * cannot exist and throws 42P10 on every call (the same bug already found and
 * fixed in facts/repo.ts's ingest()). Unlike facts/repo.ts — which can safely
 * drop to a targetless onConflictDoNothing() because its idempotency is fully
 * guaranteed upstream by the inbox markProcessed() — this function has no such
 * upstream guarantee, and a targetless conflict target would not match on a
 * dedupe_key repeat (ingested_at differs per insert), silently allowing
 * duplicate rows per step. So we check-then-insert inside the transaction
 * instead, and keep a targetless onConflictDoNothing() only as a harmless
 * secondary net against a genuine PK collision.
 */
import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { factEvents } from "../facts/schema.js";

export async function recordActivation(tenantId: string, step: string): Promise<void> {
  const systemActor = "00000000-0000-0000-0000-000000000000";
  const dedupeKey = `activation:${step}`;
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: factEvents.id })
      .from(factEvents)
      .where(and(eq(factEvents.tenantId, tenantId), eq(factEvents.dedupeKey, dedupeKey)))
      .limit(1);
    if (existing.length > 0) return; // earliest occurrence already recorded — keep it

    await tx
      .insert(factEvents)
      .values({
        tenantId,
        source: "activation",
        eventType: step,
        category: "activation",
        status: "ok",
        dedupeKey,
        createdBy: systemActor,
        updatedBy: systemActor,
      })
      .onConflictDoNothing();
  });
}

export type ActivationRow = { step: string; at: string };

export async function listActivation(tenantId: string): Promise<ActivationRow[]> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select({ step: factEvents.eventType, at: factEvents.occurredAt })
      .from(factEvents)
      .where(and(eq(factEvents.tenantId, tenantId), eq(factEvents.source, "activation"))),
  );
  return rows.map((r) => ({
    step: r.step,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  }));
}

export type ActivationRowWithTenant = ActivationRow & { tenantId: string };

/**
 * Cross-tenant activation events for the platform-wide funnel. Route-gated to
 * platform admins. NOTE: in a production posture with RLS enforced and the
 * tenant GUC set, this must run via a BYPASSRLS analytics-reporting role; in
 * dev/UAT the service role bypasses RLS so it returns all offices' rows.
 */
export async function listActivationAllTenants(): Promise<ActivationRowWithTenant[]> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select({ tenantId: factEvents.tenantId, step: factEvents.eventType, at: factEvents.occurredAt })
      .from(factEvents)
      .where(eq(factEvents.source, "activation")),
  );
  return rows.map((r) => ({
    tenantId: r.tenantId,
    step: r.step,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  }));
}
