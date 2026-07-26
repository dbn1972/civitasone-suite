/**
 * stewardship (data ownership) — REAL round-trip tests (CAP-019, new module).
 * Domains, steward assignments and the data-asset catalogue are driven through
 * the real consumers and read back through the RLS-scoped repo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { dataDomains, dataStewards, dataAssets } from "../src/modules/stewardship/schema.js";
import { registerStewardshipConsumers } from "../src/modules/stewardship/consumer.js";
import * as repo from "../src/modules/stewardship/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "aaaaaaaa-1111-4000-8000-000000000191";
const T2 = "aaaaaaaa-1111-4000-8000-000000000192";
const ACTOR = "cccccccc-3333-4000-8000-000000000191";
const admin = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["tenant_admin", "platform_admin"], sid: "s1" }, SECRET);

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(dataAssets).where(eq(dataAssets.tenantId, tenantId));
    await tx.delete(dataStewards).where(eq(dataStewards.tenantId, tenantId));
    await tx.delete(dataDomains).where(eq(dataDomains.tenantId, tenantId));
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

async function seedDomain(q: MemoryQueue, tenantId: string, code: string): Promise<string> {
  const id = randomUUID();
  await publish(q, "tenant.data_domain.create", tenantId, { id, tenantId, code, name: `${code} domain`, ownerOffice: "Revenue Dept", ownerRole: "Director", classification: "confidential" });
  return id;
}

describe("stewardship — real persistence (CAP-019)", () => {
  beforeAll(async () => { await wipe(T1); await wipe(T2); });
  afterAll(async () => { await wipe(T1); await wipe(T2); await sqlClient.end(); });

  it("creates a data domain with owner office/role + classification", async () => {
    const q = new MemoryQueue(); registerStewardshipConsumers(q); await q.start();
    const id = await seedDomain(q, T1, "TAXPAYER");
    await q.stop();
    const d = await repo.findDomain(T1, id);
    expect(d).toBeDefined();
    expect(d?.ownerOffice).toBe("Revenue Dept");
    expect(d?.ownerRole).toBe("Director");
    expect(d?.classification).toBe("confidential");
  });

  it("assigns stewards and registers assets against a domain", async () => {
    const q = new MemoryQueue(); registerStewardshipConsumers(q); await q.start();
    const domainId = await seedDomain(q, T1, "CITIZEN");
    const stewardUser = randomUUID();
    await publish(q, "tenant.data_steward.assign", T1, { id: randomUUID(), tenantId: T1, domainId, stewardUserId: stewardUser, role: "owner" });
    await publish(q, "tenant.data_asset.register", T1, { id: randomUUID(), tenantId: T1, domainId, name: "Citizen Register", assetType: "table", classification: "restricted", systemOfRecord: "citizen-service" });
    await q.stop();

    const stewards = await repo.listStewards(T1, domainId);
    expect(stewards).toHaveLength(1);
    expect(stewards[0]?.stewardUserId).toBe(stewardUser);
    expect(stewards[0]?.role).toBe("owner");

    const assets = await repo.listAssets(T1, domainId);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.name).toBe("Citizen Register");
    expect(assets[0]?.classification).toBe("restricted");
  });

  it("steward/asset writes are dropped when the domain does not exist in-tenant", async () => {
    const q = new MemoryQueue(); registerStewardshipConsumers(q); await q.start();
    const ghost = randomUUID();
    await publish(q, "tenant.data_asset.register", T1, { id: randomUUID(), tenantId: T1, domainId: ghost, name: "X", assetType: "table", classification: "internal" });
    await q.stop();
    expect(await repo.listAssets(T1, ghost)).toHaveLength(0);
  });

  it("enforces tenant isolation (FORCED RLS)", async () => {
    const q = new MemoryQueue(); registerStewardshipConsumers(q); await q.start();
    const d1 = await seedDomain(q, T1, "ISO1");
    await seedDomain(q, T2, "ISO2");
    await q.stop();
    const t2Domains = await repo.listDomains(T2);
    expect(t2Domains.map((d) => d.code)).toContain("ISO2");
    expect(t2Domains.map((d) => d.id)).not.toContain(d1);
    expect(await repo.findDomain(T2, d1)).toBeUndefined();
  });

  it("HTTP: create/list/detail + 404 + 401 + 400", async () => {
    const created = await inject("POST", "/v1/data-governance/domains", T1, { code: "HTTPDOM", name: "Http Domain", ownerOffice: "IT", ownerRole: "CIO" });
    expect(created.status).toBe(202);

    const list = await inject("GET", "/v1/data-governance/domains", T1);
    expect(list.status).toBe(200);
    expect((list.body as { meta: { total: number } }).meta.total).toBeGreaterThanOrEqual(1);

    // Assign steward to a non-existent domain → 404.
    const bad = await inject("POST", `/v1/data-governance/domains/${randomUUID()}/stewards`, T1, { stewardUserId: randomUUID(), role: "steward" });
    expect(bad.status).toBe(404);

    expect((await inject("GET", "/v1/data-governance/domains")).status).toBe(401);
    expect((await inject("POST", "/v1/data-governance/domains", T1, { code: "" })).status).toBe(400);
  });
});
