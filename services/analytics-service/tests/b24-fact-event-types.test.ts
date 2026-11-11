/**
 * UAT b24: every inbound topic must normalise to an event_type that fact_events_event_type_check admits.
 * finance.payment.made -> payment.made and grant.disbursement.completed -> disbursement.completed were refused
 * (23514) on a migrated database. Real Postgres, FORCE RLS, non-superuser service role.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents } from "../src/modules/facts/schema.js";
import { normalizeFact } from "../src/modules/facts/normalize.js";
import { INBOUND } from "../src/topics.js";

const TENANT = randomUUID();
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(factEvents).where(eq(factEvents.tenantId, TENANT))));
  await sqlClient.end();
});

describe("fact_events event_type whitelist covers every INBOUND topic", () => {
  it.each(Object.values(INBOUND))("%s is stored", async (topic) => {
    const row = normalizeFact(topic, { messageId: randomUUID(), tenantId: TENANT, payload: { amount: 1250000, category: "salary", actorId: randomUUID() } });
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(factEvents).values(row)));
    const stored = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(factEvents).where(eq(factEvents.dedupeKey, row.dedupeKey))));
    expect(stored).toHaveLength(1);
  });
});
