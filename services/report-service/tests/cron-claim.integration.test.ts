/**
 * CLOS3-S6-06 (integration) — scheduled-report tick() must claim a due report atomically.
 * Real Postgres: cross-tenant discovery through the BYPASSRLS scanner role, claim/advance writes as
 * report_svc under RLS. Only the queue is stubbed.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { scannerSqlClient } from "../src/shared/scanner-db.js";
import { queue } from "../src/shared/infra.js";
import { scheduledReports } from "../src/modules/scheduled/schema.js";
import { tick } from "../src/modules/scheduled/cron.js";

const ACTOR = "00000000-eeee-4000-8000-0000000000a1";
const tenants: string[] = [];

async function seedDue(): Promise<{ tenantId: string; id: string }> {
  const tenantId = randomUUID();
  tenants.push(tenantId);
  const id = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(scheduledReports).values({
      id, tenantId, templateId: randomUUID(), cadence: "daily", recipients: [], format: "pdf",
      enabled: true, nextRunAt: new Date(Date.now() - 60_000), createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return { tenantId, id };
}
const rowOf = (tenantId: string, id: string) => runWithTenant(tenantId, () => db.transaction(async (tx) =>
  (await tx.select().from(scheduledReports).where(eq(scheduledReports.id, id)))[0]!));

function renderPublishesFor(spy: ReturnType<typeof vi.spyOn>, scheduledReportId: string) {
  return spy.mock.calls.filter((c) => {
    const [topic, env] = c as unknown as [string, { payload?: { scheduledReportId?: string } }];
    return topic === "reports.job.render" && env.payload?.scheduledReportId === scheduledReportId;
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of tenants.splice(0)) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(scheduledReports).where(eq(scheduledReports.tenantId, t))));
  }
});
afterAll(async () => { await sqlClient.end(); await scannerSqlClient.end(); });

describe("scheduled cron — atomic claim (CLOS3-S6-06)", () => {
  it("two concurrent ticks publish exactly one render job and advance next_run_at", async () => {
    const { tenantId, id } = await seedDue();
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("ok" as never);

    await Promise.all([tick(), tick()]);

    expect(renderPublishesFor(spy, id)).toHaveLength(1);
    const row = await rowOf(tenantId, id);
    expect(row.lastRunAt).not.toBeNull();
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000); // real daily schedule, not the 15-min lease
  }, 30_000);

  it("a failed dispatch keeps the lease: not re-dispatched immediately, retryable once the lease expires", async () => {
    const { tenantId, id } = await seedDue();
    const spy = vi.spyOn(queue, "publish").mockRejectedValue(new Error("broker down"));

    await tick();
    expect(renderPublishesFor(spy, id)).toHaveLength(1); // attempted once
    const leased = await rowOf(tenantId, id);
    expect(leased.lastRunAt).toBeNull();
    expect(leased.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000); // lease in the future

    await tick();
    expect(renderPublishesFor(spy, id)).toHaveLength(1); // the next tick does not re-dispatch it

    // lease expires -> due again -> retried
    await runWithTenant(tenantId, () => db.transaction((tx) =>
      tx.update(scheduledReports).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(scheduledReports.id, id))));
    spy.mockResolvedValue("ok" as never);
    await tick();
    expect(renderPublishesFor(spy, id)).toHaveLength(2);
    expect((await rowOf(tenantId, id)).lastRunAt).not.toBeNull();
  }, 30_000);
});
