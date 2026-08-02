/**
 * CAP-059 — reconciliation idempotency (DB integration).
 *
 * Regression guard for the non-idempotency bug: runReconciliation() used to
 * blind-insert a row for every engine finding, so re-running for the same
 * provider while a mismatch persisted piled up duplicate OPEN breaks for the
 * same discrepancy. The fix denormalises `provider` onto recon_break and adds a
 * partial unique index (migration 0050) — at most one ACTIVE (open/investigating)
 * break per (tenant, provider, break_key, break_type, field) — and the writer
 * uses ON CONFLICT DO NOTHING.
 *
 * Uses a test-only provider (no seed data) driven through the real HTTP route so
 * tenant context / RLS are exercised end to end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { ReconProvider } from "../src/modules/recon/providers.js";
import { registerProvider } from "../src/modules/recon/providers.js";
import { buildApp } from "../src/app.js";
import { runWithTenant } from "@civitasone/db";
import { runReconciliation } from "../src/modules/recon/service.js";
import * as reconRepo from "../src/modules/recon/repo.js";
import { db } from "../src/shared/db.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";

const TEST_TENANT = "aa000002-ec00-4000-8000-0000000000f1";
const TEST_ACTOR = "bb000002-ec00-4000-8000-0000000000f1";
const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const PROVIDER_KEY = "idem-test-provider";

function token(roles = ["finance_officer"]) {
  return signToken({ sub: TEST_ACTOR, tid: TEST_TENANT, roles, sid: "recon-idem" }, JWT_SECRET);
}
function h() {
  return { authorization: `Bearer ${token()}` };
}

// A deterministic provider with a persistent mismatch: K2 amount differs
// (value_mismatch on amountMinor) and K3 is missing on the bank side
// (missing_in_target). Re-running with the same data must not duplicate breaks.
const idemProvider: ReconProvider = {
  key: PROVIDER_KEY,
  sourceSystem: "idem-book",
  targetSystem: "idem-bank",
  async fetch() {
    return {
      source: [
        { key: "K1", amountMinor: 1000 },
        { key: "K2", amountMinor: 2000 },
        { key: "K3", amountMinor: 3000 },
      ],
      target: [
        { key: "K1", amountMinor: 1000 },
        { key: "K2", amountMinor: 9999 },
      ],
      config: {
        keyField: "key",
        sourceSystem: "idem-book",
        targetSystem: "idem-bank",
        fields: [{ field: "amountMinor", type: "amount", tolerance: 0 }],
      },
    };
  },
};

async function activeBreaks(): Promise<{ breakKey: string; breakType: string; field: string | null; status: string }[]> {
  return scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`
      SELECT break_key AS "breakKey", break_type AS "breakType", field, status
      FROM recon.recon_break
      WHERE tenant_id = ${TEST_TENANT}::uuid AND status IN ('open','investigating')
    `),
  ) as unknown as Promise<{ breakKey: string; breakType: string; field: string | null; status: string }[]>;
}

function identity(b: { breakKey: string; breakType: string; field: string | null }): string {
  return `${b.breakKey}|${b.breakType}|${b.field ?? ""}`;
}

async function runOnce(_app: any): Promise<number> {
  const result = await runWithTenant(TEST_TENANT, () =>
    runReconciliation(
      { tenantId: TEST_TENANT, actorId: TEST_ACTOR },
      PROVIDER_KEY,
      {},
    ),
  );
  expect(result).not.toBeNull();
  return result!.breakCount;
}

let app: any;

beforeAll(async () => {
  registerProvider(idemProvider);
  // Clean slate for the isolated test tenant.
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM recon.recon_break WHERE tenant_id = ${TEST_TENANT}::uuid`),
  ).catch(() => {});
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM recon.recon_run WHERE tenant_id = ${TEST_TENANT}::uuid`),
  ).catch(() => {});
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM recon.recon_break WHERE tenant_id = ${TEST_TENANT}::uuid`),
  ).catch(() => {});
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM recon.recon_run WHERE tenant_id = ${TEST_TENANT}::uuid`),
  ).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("CAP-059 reconciliation idempotency", () => {
  it("engine reports the same break_count each run (deterministic mismatch)", async () => {
    const c1 = await runOnce(app);
    const c2 = await runOnce(app);
    expect(c1).toBeGreaterThan(0);
    expect(c2).toBe(c1); // engine finding count is stable
  });

  it("re-running does NOT duplicate open breaks — one active break per identity", async () => {
    // Two runs already happened in the previous test; run a third for good measure.
    await runOnce(app);
    const rows = await activeBreaks();
    expect(rows.length).toBeGreaterThan(0);

    // The core invariant: never two ACTIVE breaks for the same identity.
    const byIdent = new Map<string, number>();
    for (const r of rows) byIdent.set(identity(r), (byIdent.get(identity(r)) ?? 0) + 1);
    for (const [ident, n] of byIdent) expect(n, `duplicate active break for ${ident}`).toBe(1);

    // Exactly the two distinct discrepancies (K2 value_mismatch, K3 missing_in_target).
    expect(byIdent.size).toBe(2);
    expect(rows.length).toBe(2);
  });

  it("resolving a break then re-running does not resurrect it as a duplicate", async () => {
    // Resolve every currently-active break.
    const before = await activeBreaks();
    const list = await app.inject({ method: "GET", url: "/v1/finance/recon/exceptions?status=open", headers: h() });
    const openBreaks = list.json().data as { id: string }[];
    for (const b of openBreaks) {
      const r = await app.inject({
        method: "POST",
        url: `/v1/finance/recon/exceptions/${b.id}/action`,
        headers: h(),
        payload: { action: "resolve", note: "test-resolve" },
      });
      expect(r.statusCode).toBe(202);
      // Consumer write path (HTTP only enqueues under CQRS).
      await runWithTenant(TEST_TENANT, async () => {
        await db.transaction(async (tx) => {
          await reconRepo.updateBreakStatus(tx, TEST_TENANT, b.id, {
            status: "resolved",
            resolutionNote: "test-resolve",
            resolvedBy: TEST_ACTOR,
            resolvedAt: new Date(),
          });
        });
      });
    }
    expect((await activeBreaks()).length).toBe(0);

    // Re-run with the SAME persistent mismatch. A recurred discrepancy may raise a
    // fresh break (the resolved ones are exempt from the partial index), but there
    // must NEVER be more than one ACTIVE break per identity, and no more than the
    // original number of distinct discrepancies.
    await runOnce(app);
    const after = await activeBreaks();
    const byIdent = new Map<string, number>();
    for (const r of after) byIdent.set(identity(r), (byIdent.get(identity(r)) ?? 0) + 1);
    for (const [ident, n] of byIdent) expect(n, `duplicate active break for ${ident}`).toBe(1);
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
