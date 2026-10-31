/**
 * B10 (UAT): tenant A had zero payroll.dearness_allowance_rates rows, so every
 * payroll run failed with DA_RATE_NOT_CONFIGURED and no API writes the table.
 * seedUatDaRates (`pnpm payroll:seed-uat-da-rates`) seeds the standard 7th CPC
 * series only into a tenant with no DA rows; dry-run writes nothing; a re-run
 * is a no-op; a tenant with its own rates is never touched.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient, scopedRead } from "../src/shared/db.js";
import { resolveDaRateBps } from "../src/modules/payroll/consumer.js";
import { seedUatDaRates, STANDARD_DA_SERIES, UAT_DA_ORDER_REF } from "../src/modules/payroll/da-rate-seed.js";

const EMPTY = randomUUID();
const CONFIGURED = randomUUID();
const ACTOR = randomUUID();
const asT = <T>(t: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(t, () => db.transaction(fn));
const daRows = (t: string) => asT(t, (tx) => tx.execute(sql`
  SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from, rate_bps, order_ref
    FROM payroll.dearness_allowance_rates WHERE tenant_id = ${t}::uuid ORDER BY effective_from`)) as unknown as Promise<Array<{ effective_from: string; rate_bps: number; order_ref: string | null }>>;
const rateFor = (t: string, month: string) => runWithTenant(t, () => scopedRead((tx) => resolveDaRateBps(tx as never, t, month)));

afterAll(async () => {
  for (const t of [EMPTY, CONFIGURED]) {
    await asT(t, (tx) => tx.execute(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${t}::uuid`));
  }
  await sqlClient.end();
});

describe("B10 seedUatDaRates (payroll:seed-uat-da-rates)", () => {
  it("a tenant with no DA rows fails payroll with DA_RATE_NOT_CONFIGURED (the UAT defect)", async () => {
    await expect(rateFor(EMPTY, "2026-10")).rejects.toThrow(/DA_RATE_NOT_CONFIGURED/);
  });

  it("dry-run reports the series and writes nothing", async () => {
    const r = await seedUatDaRates(EMPTY, { actorId: ACTOR, dryRun: true });
    expect(r).toMatchObject({ outcome: "would_seed", existingRows: 0, inserted: STANDARD_DA_SERIES.map((s) => s.effectiveFrom) });
    expect(await daRows(EMPTY)).toEqual([]);
  });

  it("seeds the effective-dated series labelled as UAT seed data; payroll then resolves a rate; re-run is a no-op", async () => {
    const r = await seedUatDaRates(EMPTY, { actorId: ACTOR });
    expect(r.outcome).toBe("seeded");
    expect(r.inserted).toHaveLength(STANDARD_DA_SERIES.length);
    const rows = await daRows(EMPTY);
    expect(rows.map((x) => [x.effective_from, x.rate_bps])).toEqual(STANDARD_DA_SERIES.map((s) => [s.effectiveFrom, s.rateBps]));
    expect(rows.every((x) => x.order_ref === UAT_DA_ORDER_REF && /UAT SEED/.test(x.order_ref))).toBe(true);
    expect(await rateFor(EMPTY, "2026-10")).toBe(5800n);
    expect(await rateFor(EMPTY, "2024-03")).toBe(5000n);

    const again = await seedUatDaRates(EMPTY, { actorId: ACTOR });
    expect(again).toMatchObject({ outcome: "skipped_has_rates", existingRows: STANDARD_DA_SERIES.length, inserted: [] });
    expect(await daRows(EMPTY)).toHaveLength(STANDARD_DA_SERIES.length);
  });

  it("never touches a tenant that already has its own DA configuration", async () => {
    await asT(CONFIGURED, (tx) => tx.execute(sql`
      INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps, order_ref)
      VALUES (${CONFIGURED}::uuid, '2026-01-01', 4000, 'tenant order')`));
    const r = await seedUatDaRates(CONFIGURED, { actorId: ACTOR });
    expect(r).toMatchObject({ outcome: "skipped_has_rates", existingRows: 1, inserted: [] });
    expect(await daRows(CONFIGURED)).toEqual([{ effective_from: "2026-01-01", rate_bps: 4000, order_ref: "tenant order" }]);
  });
});
