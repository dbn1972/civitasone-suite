/**
 * R1 (gap analysis) — Organisation hierarchy (CSMOP Ch. 2). Verified through
 * the real consumer against the dev DB: a Ministry→…→Section tree is built,
 * level rules and cycle prevention are enforced, and the ancestor chain (the
 * channel of submission) resolves correctly.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { estabOrgUnit } from "../src/modules/org/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerOrgConsumers } from "../src/modules/org/consumer.js";
import { COMMANDS } from "../src/modules/org/commands.js";
import { listAncestors } from "../src/modules/org/repo.js";
import { canParent } from "../src/modules/org/domain.js";

const TENANT = "11111111-aaaa-4000-8000-0000000000e1";
const ACTOR  = "00000000-aaaa-4000-8000-0000000000e1";

async function clean() {
  // children before parents (self-FK); simplest is to null parents then delete.
  await db.execute(sql`UPDATE files.estab_org_unit SET parent_id = NULL WHERE tenant_id = ${TENANT}`);
  await db.delete(estabOrgUnit).where(eq(estabOrgUnit.tenantId, TENANT));
}

const env = (type: string, payload: Record<string, unknown>) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};
async function waitProcessed(messageId: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await db.select().from(processed).where(eq(processed.messageId, messageId))).length === 1) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}
async function unit(id: string) {
  return (await db.select().from(estabOrgUnit).where(eq(estabOrgUnit.id, id)))[0];
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("org hierarchy domain", () => {
  it("only lets a higher level parent a lower one", () => {
    expect(canParent("department", "ministry")).toBe(true);
    expect(canParent("section", "division")).toBe(true);
    expect(canParent("division", "ministry")).toBe(true); // levels may be skipped
    expect(canParent("ministry", "department")).toBe(false);
    expect(canParent("division", "section")).toBe(false);
  });
});

describe("org hierarchy (R1)", () => {
  it("builds a Ministry → Department → Division → Section tree and resolves ancestors", async () => {
    const q = new MemoryQueue(); registerOrgConsumers(q); await q.start();
    const min = randomUUID(), dep = randomUUID(), div = randomUUID(), sec = randomUUID();
    const m1 = env(COMMANDS.orgUnitCreate, { id: min, tenantId: TENANT, code: "MIN", name: "Ministry", type: "ministry", parentId: null });
    const m2 = env(COMMANDS.orgUnitCreate, { id: dep, tenantId: TENANT, code: "DEP", name: "Department", type: "department", parentId: min });
    const m3 = env(COMMANDS.orgUnitCreate, { id: div, tenantId: TENANT, code: "DIV", name: "Division", type: "division", parentId: dep });
    const m4 = env(COMMANDS.orgUnitCreate, { id: sec, tenantId: TENANT, code: "SEC", name: "Section", type: "section", parentId: div });
    for (const m of [m1, m2, m3, m4]) { await q.publish(COMMANDS.orgUnitCreate, m); await waitProcessed(m.messageId); }
    await q.stop();

    expect((await unit(sec))?.parentId).toBe(div);
    const chain = await listAncestors(TENANT, sec);
    expect(chain.map((u) => u.code)).toEqual(["DIV", "DEP", "MIN"]);
  });

  it("rejects an invalid level (a division cannot sit under a section)", async () => {
    const q = new MemoryQueue({ maxAttempts: 1 }); registerOrgConsumers(q); await q.start();
    const sec = randomUUID(), div = randomUUID();
    const ms = env(COMMANDS.orgUnitCreate, { id: sec, tenantId: TENANT, code: "S1", name: "Section", type: "section", parentId: null });
    await q.publish(COMMANDS.orgUnitCreate, ms); await waitProcessed(ms.messageId);
    const md = env(COMMANDS.orgUnitCreate, { id: div, tenantId: TENANT, code: "D1", name: "Division", type: "division", parentId: sec });
    await q.publish(COMMANDS.orgUnitCreate, md);
    await waitFor(async () => q.dlq.length === 1);
    await q.stop();
    expect(await unit(div)).toBeUndefined();
    expect(q.dlq[0]?.error).toMatch(/ORG_INVALID_HIERARCHY/);
  });

  it("rejects a duplicate code for the same tenant", async () => {
    const q = new MemoryQueue({ maxAttempts: 1 }); registerOrgConsumers(q); await q.start();
    const a = randomUUID(), b = randomUUID();
    const ma = env(COMMANDS.orgUnitCreate, { id: a, tenantId: TENANT, code: "DUP", name: "First", type: "ministry", parentId: null });
    await q.publish(COMMANDS.orgUnitCreate, ma); await waitProcessed(ma.messageId);
    const mb = env(COMMANDS.orgUnitCreate, { id: b, tenantId: TENANT, code: "DUP", name: "Second", type: "ministry", parentId: null });
    await q.publish(COMMANDS.orgUnitCreate, mb);
    await waitFor(async () => q.dlq.length === 1);
    await q.stop();
    expect(await unit(b)).toBeUndefined();
    expect(q.dlq[0]?.error).toMatch(/ORG_CODE_TAKEN/);
  });

  it("rejects a re-parent that would create a cycle", async () => {
    const q = new MemoryQueue({ maxAttempts: 1 }); registerOrgConsumers(q); await q.start();
    const min = randomUUID(), dep = randomUUID();
    const m1 = env(COMMANDS.orgUnitCreate, { id: min, tenantId: TENANT, code: "M9", name: "Ministry", type: "ministry", parentId: null });
    const m2 = env(COMMANDS.orgUnitCreate, { id: dep, tenantId: TENANT, code: "D9", name: "Department", type: "department", parentId: min });
    await q.publish(COMMANDS.orgUnitCreate, m1); await waitProcessed(m1.messageId);
    await q.publish(COMMANDS.orgUnitCreate, m2); await waitProcessed(m2.messageId);
    // try to make the ministry a child of its own department → cycle
    const mu = env(COMMANDS.orgUnitUpdate, { id: min, tenantId: TENANT, patch: { parentId: dep } });
    await q.publish(COMMANDS.orgUnitUpdate, mu);
    await waitFor(async () => q.dlq.length === 1);
    await q.stop();
    expect((await unit(min))?.parentId).toBeNull();
    expect(q.dlq[0]?.error).toMatch(/ORG_(CYCLE|INVALID_HIERARCHY)/);
  });
});

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((r) => setTimeout(r, 40)); }
}
