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
  await db
    .insert(factEvents)
    .values({
      tenantId,
      source: "activation",
      eventType: step,
      category: "activation",
      status: "ok",
      dedupeKey: `activation:${step}`,
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
