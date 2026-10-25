/**
 * CLOS3-S4-04: approval-level creation must hold the 5-level cap and unique ordinals even when
 * several create commands are published before any is consumed (the route's count read is stale).
 *
 * Real Postgres as the non-superuser contract_svc role (FORCE RLS enforced). Skips when
 * Postgres is unreachable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";

const DSN = process.env["DATABASE_URL"] ?? "";
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try { await client`SELECT 1 FROM approvals.contract_approval_levels LIMIT 1`; return true; } catch { return false; }
  finally { await client.end({ timeout: 1 }).catch(() => undefined); }
}
const reachable = DSN !== "" && (await probe());

const { db, sqlClient } = await import("../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const { registerApprovalConsumers } = await import("../src/modules/approvals/consumer.js");
const { approvalLevels } = await import("../src/modules/approvals/schema.js");
const { COMMANDS } = await import("../src/topics.js");

type Handler = (msg: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
registerApprovalConsumers({
  subscribe: (topic: string, h: Handler) => {
    // mirror src/worker.ts: every handler runs inside the message's tenant context
    handlers.set(topic, (msg) => Promise.resolve(runWithTenant((msg as { tenantId: string }).tenantId, () => h(msg))));
  },
  publish: async () => undefined,
} as unknown as Queue);

const ACTOR = randomUUID();
const tenants: string[] = [];
const newTenant = (): string => { const t = randomUUID(); tenants.push(t); return t; };

function createMsg(tenantId: string, ordinal: number) {
  const id = randomUUID();
  return {
    messageId: id, correlationId: "c", tenantId, actorId: ACTOR,
    payload: { id, tenantId, ordinal, minValuePaise: String(BigInt(ordinal) * 1000n), requiredRole: "contract_admin", label: `L${ordinal}` },
  };
}
const create = (m: unknown) => handlers.get(COMMANDS.approvalLevelCreate)!(m);
const levels = (tenantId: string) =>
  Promise.resolve(runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(approvalLevels).where(eq(approvalLevels.tenantId, tenantId)))));
const seed = (tenantId: string, ordinal: number) => create(createMsg(tenantId, ordinal));

describe.skipIf(!reachable)("CLOS3-S4-04 approval level cap + ordinals (real Postgres)", () => {
  afterAll(async () => {
    for (const t of tenants) {
      await Promise.resolve(runWithTenant(t, () => db.transaction(async (tx) => { await tx.delete(approvalLevels).where(eq(approvalLevels.tenantId, t)); }))).catch(() => undefined);
    }
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  it("two creates published against count=4 (both carry ordinal 5) yield 5 levels with unique ordinals", async () => {
    const t = newTenant();
    for (let i = 1; i <= 4; i++) await seed(t, i);
    await Promise.all([create(createMsg(t, 5)), create(createMsg(t, 5))]);
    const rows = await levels(t);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(new Set(rows.map((r) => r.ordinal)).size).toBe(rows.length);
  });

  it("a create arriving when the tenant already has 5 levels is dropped, not inserted", async () => {
    const t = newTenant();
    for (let i = 1; i <= 5; i++) await seed(t, i);
    await create(createMsg(t, 6));
    expect((await levels(t)).length).toBe(5);
  });

  it("ordinal is allocated by the consumer as max+1 (supplied ordinal ignored), also after a delete gap", async () => {
    const t = newTenant();
    for (let i = 1; i <= 3; i++) await seed(t, i);
    const rows = await levels(t);
    const two = rows.find((r) => r.ordinal === 2)!;
    await Promise.resolve(runWithTenant(t, () => db.transaction(async (tx) => { await tx.delete(approvalLevels).where(eq(approvalLevels.id, two.id)); })));
    await create(createMsg(t, 3)); // stale count+1 from the route = 3, but 3 is taken
    const after = (await levels(t)).map((r) => r.ordinal).sort((a, b) => a - b);
    expect(after).toEqual([1, 3, 4]);
  });

  it("the database itself rejects a duplicate (tenant_id, ordinal)", async () => {
    const t = newTenant();
    await seed(t, 1);
    const dup = Promise.resolve(runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.insert(approvalLevels).values({
        tenantId: t, minValuePaise: 1n, requiredRole: "contract_admin", label: "dup", ordinal: 1, createdBy: ACTOR, updatedBy: ACTOR,
      });
    })));
    await expect(dup).rejects.toThrow();
  });
});
