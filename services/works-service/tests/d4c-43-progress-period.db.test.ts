/**
 * Owner decision D4c #43 (GAP-WORKS-EXECUTION-RECORD-PROGRESS-06): one progress entry per scope per month; a
 * correction is a negative entry with a reason (stored, and not counted as the month's entry). Unique key in the DB.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { workScopes, scopeProgress } from "../src/modules/execution/schema.js";
import { registerExecutionConsumers } from "../src/modules/execution/consumer.js";

const TENANT = `d4c43000-0000-4000-8000-${randomUUID().slice(24)}`;
const ACTOR = randomUUID();
type Handler = (msg: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};
registerExecutionConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);
const record = (workScopeId: string, month: number, year: number, delta: number, correctionReason?: string) =>
  runWithTenant(TENANT, () => handlers[COMMANDS.progressRecord]!({
    messageId: randomUUID(), tenantId: TENANT, actorId: ACTOR, correlationId: "d4c43", schemaVersion: "1.0",
    payload: { id: randomUUID(), workScopeId, month, year, currentAchievement: delta, ...(correctionReason ? { correctionReason } : {}) },
  }));
const inTx = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));
const rowsOf = (workScopeId: string) => inTx((tx) => tx.select().from(scopeProgress).where(eq(scopeProgress.workScopeId, workScopeId)));

async function seedScope(target = 1000) {
  const id = randomUUID();
  await inTx((tx) => tx.insert(workScopes).values({ id, tenantId: TENANT, workId: randomUUID(), scopeId: randomUUID(), targetValue: String(target) }));
  return id;
}

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of ["works.scope_progress", "works.work_scopes"]) await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`);
  });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  await sqlClient.end();
});

describe("one progress entry per scope per month (real DB)", () => {
  it("a second ordinary entry for the same scope and month is refused and writes nothing", async () => {
    const s = await seedScope();
    await record(s, 5, 2026, 10);
    await expect(record(s, 5, 2026, 5)).rejects.toThrow(/DUPLICATE_PROGRESS_PERIOD/);
    expect(await rowsOf(s)).toHaveLength(1);
  });

  it("another month, another year, or another scope in the same month is fine", async () => {
    const a = await seedScope(); const b = await seedScope();
    await record(a, 5, 2026, 10);
    await record(a, 6, 2026, 10);
    await record(a, 5, 2027, 10);
    await record(b, 5, 2026, 10);
    expect(await rowsOf(a)).toHaveLength(3);
    expect(await rowsOf(b)).toHaveLength(1);
  });

  it("a correction is a negative entry with a reason: allowed in the same month, stored as a correction with its reason", async () => {
    const s = await seedScope();
    await record(s, 5, 2026, 10);
    await record(s, 5, 2026, -4, "Over-reported: measured again on site");
    const rows = await rowsOf(s);
    expect(rows).toHaveLength(2);
    const corr = rows.find((r) => r.entryKind === "correction")!;
    expect(Number(corr.currentAchievement)).toBe(-4);
    expect(corr.correctionReason).toBe("Over-reported: measured again on site");
    expect(rows.find((r) => r.entryKind === "progress")).toBeTruthy();
    // after a correction the month still has its one ordinary entry, so a further ordinary entry is still refused
    await expect(record(s, 5, 2026, 1)).rejects.toThrow(/DUPLICATE_PROGRESS_PERIOD/);
  });

  it("a negative entry without a reason is still refused (unchanged)", async () => {
    const s = await seedScope();
    await record(s, 5, 2026, 10);
    await expect(record(s, 5, 2026, -4)).rejects.toThrow(/NEGATIVE_PROGRESS_REQUIRES_REASON/);
  });

  it("the unique key holds in the database itself: a raw duplicate ordinary row violates it, a correction row does not", async () => {
    const s = await seedScope();
    await record(s, 5, 2026, 10);
    const dup = (kind: string) => inTx((tx) => tx.insert(scopeProgress).values({
      id: randomUUID(), tenantId: TENANT, workScopeId: s, month: 5, year: 2026, currentAchievement: "1", entryKind: kind,
    }));
    await expect(dup("progress")).rejects.toThrow(/uq_scope_progress_period|duplicate key|Failed query/i);
    await dup("correction");
  });

  it("migration 0030 keeps old duplicate rows (reclassified) before it creates the unique index", () => {
    const sql = readFileSync(join(__dirname, "../migrations/0030_scope_progress_period_unique.sql"), "utf8");
    const reclass = sql.indexOf("legacy_duplicate");
    const idx = sql.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS uq_scope_progress_period");
    expect(reclass).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(reclass);
    expect(sql).toMatch(/WHERE entry_kind = 'progress'/);
    expect(sql).not.toMatch(/DELETE FROM works\.scope_progress/i);
  });
});
