/**
 * Owner decision D4c #41 (GAP-WORKS-EXECUTION-WORKID-07): a work may NOT be closed while issues are open or physical
 * progress is below 100%, unless it is closed as dropped/closed (foreclosed) with a DAO reason. Pure rule + the real
 * consumer against Postgres (works_svc, FORCE RLS).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { closureBlockers } from "../src/modules/execution/domain.js";
import { workIssues, workScopes, scopeProgress, workClosures, physicalCompletions } from "../src/modules/execution/schema.js";
import { awards } from "../src/modules/tender/schema.js";
import { registerExecutionConsumers } from "../src/modules/execution/consumer.js";

const TENANT = `d4c41000-0000-4000-8000-${randomUUID().slice(24)}`;
const ACTOR = randomUUID();

describe("closureBlockers (pure)", () => {
  it("no issues and every scope at or above its target: nothing blocks", () => {
    expect(closureBlockers({ openIssues: 0, scopes: [{ target: 100, achieved: 100 }, { target: 50, achieved: 60 }] })).toEqual([]);
  });
  it("an open issue blocks", () => {
    expect(closureBlockers({ openIssues: 2, scopes: [] })).toEqual(["OPEN_ISSUES"]);
  });
  it("a scope below its target blocks; a scope with no target does not", () => {
    expect(closureBlockers({ openIssues: 0, scopes: [{ target: 100, achieved: 99.99 }] })).toEqual(["PROGRESS_BELOW_100"]);
    expect(closureBlockers({ openIssues: 0, scopes: [{ target: null, achieved: 0 }, { target: 0, achieved: 0 }] })).toEqual([]);
  });
  it("reports both, issues first", () => {
    expect(closureBlockers({ openIssues: 1, scopes: [{ target: 10, achieved: 1 }] })).toEqual(["OPEN_ISSUES", "PROGRESS_BELOW_100"]);
  });
});

type Handler = (msg: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};
registerExecutionConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);
const close = (workId: string, closureType: string, remarks?: string) =>
  runWithTenant(TENANT, () => handlers[COMMANDS.workClose]!({
    messageId: randomUUID(), tenantId: TENANT, actorId: ACTOR, correlationId: "d4c41", schemaVersion: "1.0",
    payload: { id: randomUUID(), workId, closureType, ...(remarks !== undefined ? { remarks } : {}) },
  }));
const inTx = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));
const closuresOf = (workId: string) => inTx((tx) => tx.select().from(workClosures).where(eq(workClosures.workId, workId)));

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of ["works.work_closures", "works.physical_completions", "works.scope_progress", "works.work_scopes", "works.work_issues", "works.awards"]) {
      await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`);
    }
  });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  await sqlClient.end();
});

async function seedWork(opts: { agreement?: boolean; completion?: boolean; openIssue?: boolean; target?: number; achieved?: number } = {}) {
  const workId = randomUUID();
  await inTx(async (tx) => {
    if (opts.agreement) {
      await tx.insert(awards).values({ id: randomUUID(), tenantId: TENANT, workId, contractorName: "Acme", acceptedAmountMinor: 1000n, status: "do_finalized", createdBy: ACTOR });
    }
    if (opts.completion) {
      await tx.insert(physicalCompletions).values({ id: randomUUID(), tenantId: TENANT, workId, completionDate: new Date(), completedBy: ACTOR });
    }
    if (opts.openIssue) {
      await tx.insert(workIssues).values({ id: randomUUID(), tenantId: TENANT, workId, raisedDate: new Date(), description: "crack in slab", status: "open" });
    }
    if (opts.target !== undefined) {
      const scopeId = randomUUID();
      await tx.insert(workScopes).values({ id: scopeId, tenantId: TENANT, workId, scopeId: randomUUID(), targetValue: String(opts.target) });
      await tx.insert(scopeProgress).values({ id: randomUUID(), tenantId: TENANT, workScopeId: scopeId, month: 5, year: 2026, currentAchievement: String(opts.achieved ?? 0) });
    }
  });
  return workId;
}

describe("workClose consumer (real DB)", () => {
  it("refuses a completion closure while an issue is open, and writes no closure", async () => {
    const w = await seedWork({ agreement: true, completion: true, openIssue: true });
    await expect(close(w, "completion")).rejects.toThrow(/CLOSURE_BLOCKED/);
    expect(await closuresOf(w)).toHaveLength(0);
  });

  it("refuses a completion closure while progress is below 100%", async () => {
    const w = await seedWork({ agreement: true, completion: true, target: 100, achieved: 80 });
    await expect(close(w, "completion")).rejects.toThrow(/CLOSURE_BLOCKED/);
    expect(await closuresOf(w)).toHaveLength(0);
  });

  it("allows a completion closure once issues are closed and progress reached the target", async () => {
    const w = await seedWork({ agreement: true, completion: true, target: 100, achieved: 100 });
    await close(w, "completion");
    expect(await closuresOf(w)).toHaveLength(1);
  });

  it("a drop with open issues needs a reason; without one it is refused", async () => {
    const w = await seedWork({ agreement: true, openIssue: true });
    await expect(close(w, "dropped")).rejects.toThrow(/CLOSURE_REASON_REQUIRED/);
    await expect(close(w, "dropped", "   ")).rejects.toThrow(/CLOSURE_REASON_REQUIRED/);
    expect(await closuresOf(w)).toHaveLength(0);
  });

  it("a drop with open issues and a reason is recorded with that reason", async () => {
    const w = await seedWork({ agreement: true, openIssue: true, target: 100, achieved: 10 });
    await close(w, "dropped", "Foreclosed: contractor insolvent");
    const rows = await closuresOf(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.closureType).toBe("dropped");
    expect(rows[0]!.remarks).toBe("Foreclosed: contractor insolvent");
  });

  it("a clean work (nothing open, no progress gap) closes as before without a reason", async () => {
    const w = await seedWork({});
    await close(w, "closed");
    expect(await closuresOf(w)).toHaveLength(1);
  });

  it("closing twice stays refused (idempotent): the second command dead-letters and no second row appears", async () => {
    const w = await seedWork({});
    await close(w, "closed");
    await expect(close(w, "closed")).rejects.toThrow(/ALREADY_CLOSED/);
    expect(await closuresOf(w)).toHaveLength(1);
  });
});
