/**
 * three-way-match — variance_pct / auto_matched persistence (regression).
 *
 * Migration 0006_world_class.sql created procurement.three_way_match WITHOUT
 * the variance_pct / auto_matched columns that src/modules/three-way-match/
 * schema.ts (the Drizzle model every read path uses) has always declared.
 * Every GET /v1/procurement/three-way-match* request 500'd with
 * `column "variance_pct" does not exist` (see tests/routes-coverage-full.test.ts).
 * The consumer separately computed variancePct per match but had nowhere to
 * store it, so it was silently dropped on every write.
 *
 * Migration 0031_three_way_match_variance_columns.sql adds the columns; this
 * test proves repo.upsertDerivedMatch now persists variancePct/autoMatched
 * and repo.listByTenant (a bare Drizzle select — the exact query shape that
 * used to 500) reads them back correctly. Fails before the migration + the
 * repo.ts/consumer.ts write-path change; passes after.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import * as repo from "../src/modules/three-way-match/repo.js";
import { randomUUID } from "node:crypto";

const TENANT = "6a6a6a6a-1111-4000-8000-0000000000f1";
const PO_ID  = randomUUID();
const GRN_ID = randomUUID();
const ROW_ID = randomUUID();

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.delete(threeWayMatch).where(eq(threeWayMatch.tenantId, TENANT))));
  await sqlClient.end();
});

describe("three-way-match repo — variance_pct / auto_matched round-trip", () => {
  it("upsertDerivedMatch persists variancePct + autoMatched; listByTenant reads them back", async () => {
    await runWithTenant(TENANT, () => db.transaction((tx) =>
      repo.upsertDerivedMatch(tx, {
        id: ROW_ID,
        tenantId: TENANT,
        poId: PO_ID,
        grnId: GRN_ID,
        poAmountMinor: 100_000n,
        grnAmountMinor: 94_000n,
        matchStatus: "mismatch",
        variancePct: 6,
        autoMatched: true,
      })));

    // listByTenant is a bare tx.select().from(threeWayMatch) — the exact
    // query that 500'd with "column variance_pct does not exist" pre-fix.
    // Wrapped in runWithTenant so wrapWithTenantGuc has an ambient tenant
    // context to inject as app.tenant_id (RLS is FORCE'd on this table).
    const rows = await runWithTenant(TENANT, () => repo.listByTenant(TENANT, PO_ID, 50, 0));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.matchStatus).toBe("mismatch");
    expect(Number(rows[0]?.variancePct)).toBeCloseTo(6, 2);
    expect(rows[0]?.autoMatched).toBe(true);
  });
});
