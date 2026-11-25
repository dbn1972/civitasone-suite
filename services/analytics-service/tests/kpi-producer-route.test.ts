/** Real-DB proof: GET /v1/analytics/kpis returns real, role-gated KPIs (D9/D10). */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents } from "../src/modules/facts/schema.js";
import { savedMetrics } from "../src/modules/metrics/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const tok = (roles: string[]) => signToken({ sub: "u-kpi", tid: TENANT, roles, sid: "s-kpi" }, SECRET);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

afterAll(async () => { await sqlClient.end(); });

async function seed() {
  const f = (source: string, eventType: string, status: string, amount: bigint, at: Date) => ({
    tenantId: TENANT, source, eventType, status, amount, occurredAt: at,
    dedupeKey: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
  });
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(factEvents).values([
      f("finance", "payment.made", "recorded", 250_000n, daysAgo(2)),
      f("finance", "payment.made", "recorded", 750_000n, daysAgo(5)),
      f("finance", "payment.made", "recorded", 500_000n, daysAgo(40)),
      f("visitor", "checked_in", "checked_in", 0n, daysAgo(1)),
      f("visitor", "checked_in", "checked_in", 0n, daysAgo(3)),
      f("visitor", "overstay.alerted", "overstay", 0n, daysAgo(1)),
      f("finance", "payment.made", "recorded", 999n, new Date(Date.now() + 5 * 86_400_000)), // future: excluded
    ]);
    await tx.insert(savedMetrics).values({
      tenantId: TENANT, name: "Overstay", metricKey: "visitor.overstay_rate_pct",
      spec: { target: 10, owner: "Chief Security Officer" }, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

describe("GET /v1/analytics/kpis (producer)", () => {
  it("returns real values from fact_events, role-gated per module", async () => {
    await seed();
    const app = await buildApp();
    const get = (roles: string[]) => app.inject({ method: "GET", url: "/v1/analytics/kpis", headers: { authorization: `Bearer ${tok(roles)}` } });

    const admin = (await get(["analytics_admin"])).json().data as Array<Record<string, unknown>>;
    const by = Object.fromEntries(admin.map((k) => [k.key as string, k]));
    expect(by["finance.payments_made_paise"]).toMatchObject({ value: 1_000_000, unit: "paise", direction: "up_good", trendPct: 100 });
    expect(by["finance.payments_made_count"]).toMatchObject({ value: 2, unit: "count" });
    expect(by["visitor.overstay_rate_pct"]).toMatchObject({ value: 50, unit: "percent", direction: "down_good", target: 10, status: "off_target", owner: "Chief Security Officer" });
    expect(by["grants.disbursed_paise"]).toBeUndefined(); // no signal => omitted
    for (const k of admin) expect(k.currentValue).not.toBe("—");

    const fin = (await get(["analytics_viewer", "finance_officer"])).json().data as Array<{ module: string }>;
    expect(fin.length).toBeGreaterThan(0);
    expect(fin.every((k) => k.module === "finance")).toBe(true);

    const none = (await get(["analytics_viewer"])).json().data;
    expect(none).toEqual([]);
    await app.close();
  });
});
