/**
 * code-lists / controlled vocabulary — REAL round-trip tests (CAP-017).
 * Proves platform-global seed lookup, tenant-scoped list+value creation,
 * effective-dated supersede, tenant isolation, and the global-list read-only
 * guard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { codeLists, codeValues } from "../src/modules/code-lists/schema.js";
import { registerCodeListConsumers } from "../src/modules/code-lists/consumer.js";
import * as repo from "../src/modules/code-lists/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "aaaaaaaa-1111-4000-8000-000000000171";
const T2 = "aaaaaaaa-1111-4000-8000-000000000172";
const ACTOR = "cccccccc-3333-4000-8000-000000000171";
const admin = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["tenant_admin", "platform_admin"], sid: "s1" }, SECRET);

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(codeValues).where(eq(codeValues.tenantId, tenantId));
    await tx.delete(codeLists).where(eq(codeLists.tenantId, tenantId));
  }));
}

async function publish(q: MemoryQueue, topic: string, tenantId: string, payload: Record<string, unknown>): Promise<void> {
  await q.publish(topic, { messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR, correlationId: `c-${randomUUID()}`, schemaVersion: "1.0", payload });
  await q.drain();
}

async function inject(m: string, u: string, tid?: string, p?: unknown): Promise<{ status: number; body: unknown }> {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (tid) o.headers = { authorization: `Bearer ${admin(tid)}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close();
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

describe("code-lists — real persistence (CAP-017)", () => {
  beforeAll(async () => { await wipe(T1); await wipe(T2); });
  afterAll(async () => { await wipe(T1); await wipe(T2); await sqlClient.end(); });

  it("resolves platform-global seeded vocabularies (gender)", async () => {
    const values = await repo.lookupActiveValues(T1, "gender");
    expect(values).not.toBeNull();
    expect(values!.map((v) => v.code).sort()).toEqual(["F", "M", "O"]);
  });

  it("creates a tenant list + values and looks them up", async () => {
    const q = new MemoryQueue(); registerCodeListConsumers(q); await q.start();
    const listId = randomUUID();
    await publish(q, "tenant.code_list.create", T1, { id: listId, tenantId: T1, code: "ward_type", name: "Ward Type" });
    await publish(q, "tenant.code_value.add", T1, { id: randomUUID(), tenantId: T1, listId, code: "URBAN", label: "Urban", sortOrder: 1 });
    await publish(q, "tenant.code_value.add", T1, { id: randomUUID(), tenantId: T1, listId, code: "RURAL", label: "Rural", sortOrder: 2 });
    await q.stop();

    const values = await repo.lookupActiveValues(T1, "ward_type");
    expect(values).not.toBeNull();
    expect(values!.map((v) => v.label)).toEqual(["Urban", "Rural"]);
  });

  it("supersede closes the old version and opens a new effective one", async () => {
    const q = new MemoryQueue(); registerCodeListConsumers(q); await q.start();
    const listId = randomUUID();
    await publish(q, "tenant.code_list.create", T1, { id: listId, tenantId: T1, code: "status_v", name: "Status" });
    await publish(q, "tenant.code_value.add", T1, { id: randomUUID(), tenantId: T1, listId, code: "OPEN", label: "Open" });
    await publish(q, "tenant.code_value.supersede", T1, { tenantId: T1, listId, code: "OPEN", label: "Open (active)" });
    await q.stop();

    // Only one active value, with the new label.
    const active = await repo.lookupActiveValues(T1, "status_v");
    expect(active!).toHaveLength(1);
    expect(active![0]?.label).toBe("Open (active)");
    // History preserved: two rows total for that code (one closed, one open).
    const all = await runWithTenant(T1, () => db.transaction((tx) =>
      tx.select().from(codeValues).where(and(eq(codeValues.listId, listId), eq(codeValues.code, "OPEN")))));
    expect(all).toHaveLength(2);
    expect(all.filter((r) => r.effectiveTo === null)).toHaveLength(1);
  });

  it("enforces tenant isolation on tenant-scoped lists (globals still shared)", async () => {
    const q = new MemoryQueue(); registerCodeListConsumers(q); await q.start();
    const listId = randomUUID();
    await publish(q, "tenant.code_list.create", T1, { id: listId, tenantId: T1, code: "t1_only", name: "T1 Only" });
    await q.stop();
    const t2Lists = await repo.listLists(T2);
    expect(t2Lists.map((l) => l.code)).not.toContain("t1_only");
    // T2 still sees the global 'gender' list.
    expect(t2Lists.map((l) => l.code)).toContain("gender");
  });

  it("HTTP: lookup global, 404 unknown, global list is read-only, 401", async () => {
    const g = await inject("GET", "/v1/code-lists/salutation/values", T1);
    expect(g.status).toBe(200);
    expect((g.body as { meta: { total: number } }).meta.total).toBe(3);

    const miss = await inject("GET", "/v1/code-lists/does_not_exist/values", T1);
    expect(miss.status).toBe(404);

    // Adding a value to a global list is rejected (409).
    const ro = await inject("POST", "/v1/code-lists/gender/values", T1, { code: "X", label: "X" });
    expect(ro.status).toBe(409);

    expect((await inject("GET", "/v1/code-lists")).status).toBe(401);
  });
});
