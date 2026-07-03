/**
 * activation repo — durable storage for the activation funnel (north star: TTFRT).
 *
 * Reuses analytics' own `fact_events` projection table (no new schema). Each
 * golden-path milestone is one row with source="activation" and event_type=step.
 * Idempotent earliest-wins: dedupe_key = "activation:<step>" + ON CONFLICT DO
 * NOTHING keeps the FIRST occurrence, so TTFRT uses the earliest timestamp even
 * if a step is emitted more than once. Tenant-scoped (RLS isolates per office).
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { factEvents } from "../facts/schema.js";

export async function recordActivation(tenantId: string, step: string): Promise<void> {
  const systemActor = "00000000-0000-0000-0000-000000000000";
  await db
    .insert(factEvents)
    .values({
      tenantId,
      source: "activation",
      eventType: step,
      category: "activation",
      status: "ok",
      dedupeKey: `activation:${step}`,
      createdBy: systemActor,
      updatedBy: systemActor,
    })
    .onConflictDoNothing({ target: [factEvents.tenantId, factEvents.dedupeKey] });
}

export type ActivationRow = { step: string; at: string };

export async function listActivation(tenantId: string): Promise<ActivationRow[]> {
  const rows = await db
    .select({ step: factEvents.eventType, at: factEvents.occurredAt })
    .from(factEvents)
    .where(and(eq(factEvents.tenantId, tenantId), eq(factEvents.source, "activation")));
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
  const rows = await db
    .select({ tenantId: factEvents.tenantId, step: factEvents.eventType, at: factEvents.occurredAt })
    .from(factEvents)
    .where(eq(factEvents.source, "activation"));
  return rows.map((r) => ({
    tenantId: r.tenantId,
    step: r.step,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  }));
}
