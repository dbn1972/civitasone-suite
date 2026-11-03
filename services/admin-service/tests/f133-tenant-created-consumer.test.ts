/**
 * UAT bundle 15 (F133): admin-service registers a new tenant from tenant.tenant.created. tenant-service sent only
 * `{ tenantId, plan }` while this consumer read `id/name/domain/edition/region/residency`, so the insert had no id and
 * the tenant never reached /admin/tenants (evidence: /admin/tenants/353c0e2c-... 404, tenant present in
 * tenant-service). The consumer now reads the v1.1 payload directly, and for a v1.0 event it fetches the missing
 * directory fields from tenant-service instead of inserting a broken row.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { adminTenants } from "../src/modules/tenants/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenants/consumer.js";
import {
  resolveTenantCreated, makeTenantServiceFetcher, TenantCreatedIncompleteError,
} from "../src/modules/tenants/tenant-created.js";

const T_NEW = "f1330000-0000-4000-8000-000000000001";
const T_OLD = "f1330000-0000-4000-8000-000000000002";
const ACTOR = "f1330000-0000-4000-8000-0000000000aa";
const MSG_NEW = "f1330000-0000-4000-8000-0000000000b1";
const MSG_OLD = "f1330000-0000-4000-8000-0000000000b2";

const FULL = {
  tenantId: T_NEW, id: T_NEW, plan: "govt", edition: "govt", name: "F133 New Office", domain: "f133-new.example.in",
  status: "draft", region: "ap-south-1", residency: "IN",
};

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

describe("resolveTenantCreated (pure)", () => {
  it("a v1.1 event is registered from the payload alone; govt maps to govt_dept", async () => {
    const fetchTenant = vi.fn();
    const row = await resolveTenantCreated(FULL, fetchTenant);
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(row).toEqual({
      id: T_NEW, name: "F133 New Office", domain: "f133-new.example.in", edition: "govt_dept",
      status: "draft", region: "ap-south-1", residency: "IN",
    });
  });

  it("a v1.0 event ({ tenantId, plan }) fetches the missing fields from tenant-service", async () => {
    const fetchTenant = vi.fn().mockResolvedValue({
      id: T_OLD, name: "F133 Old Office", domain: "f133-old.example.in", edition: "psu", status: "active",
      region: "ap-south-1", residency: "IN",
    });
    const row = await resolveTenantCreated({ tenantId: T_OLD, plan: "psu" }, fetchTenant);
    expect(fetchTenant).toHaveBeenCalledWith(T_OLD);
    expect(row).toEqual({
      id: T_OLD, name: "F133 Old Office", domain: "f133-old.example.in", edition: "psu",
      status: "active", region: "ap-south-1", residency: "IN",
    });
  });

  it("the event wins over the fetched record for the fields it carries", async () => {
    const fetchTenant = vi.fn().mockResolvedValue({ name: "Fetched", domain: "fetched.example.in", region: "r2", residency: "IN", edition: "psu" });
    const row = await resolveTenantCreated({ tenantId: T_OLD, plan: "small_office", name: "From event" }, fetchTenant);
    expect(row).toMatchObject({ name: "From event", domain: "fetched.example.in", edition: "small_office", region: "r2" });
  });

  it("status defaults to draft when neither the event nor tenant-service gives one", async () => {
    const row = await resolveTenantCreated({ ...FULL, status: undefined }, vi.fn());
    expect(row.status).toBe("draft");
  });

  it("refuses (never fabricates a name or domain) when tenant-service does not know the tenant", async () => {
    await expect(resolveTenantCreated({ tenantId: T_OLD, plan: "govt" }, vi.fn().mockResolvedValue(null)))
      .rejects.toBeInstanceOf(TenantCreatedIncompleteError);
  });

  it("refuses an event with no tenant id", async () => {
    await expect(resolveTenantCreated({ plan: "govt" } as never, vi.fn())).rejects.toBeInstanceOf(TenantCreatedIncompleteError);
  });
});

describe("makeTenantServiceFetcher", () => {
  it("reads GET /v1/tenants/:id on the internal seam, scoped to that tenant", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: T_OLD, name: "N" }), { status: 200 }));
    const fetchTenant = makeTenantServiceFetcher({ baseUrl: "http://tenant.local/", secret: "s", fetchFn, correlationId: "c1" });
    await expect(fetchTenant(T_OLD)).resolves.toMatchObject({ id: T_OLD, name: "N" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`http://tenant.local/v1/tenants/${T_OLD}`);
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": T_OLD, "x-correlation-id": "c1" });
  });

  it("unwraps a { data } envelope; 404 is null; any other failure throws (so the event is redelivered)", async () => {
    const wrapped = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: T_OLD, name: "W" } }), { status: 200 }));
    await expect(makeTenantServiceFetcher({ baseUrl: "http://t", secret: "s", fetchFn: wrapped })(T_OLD)).resolves.toMatchObject({ name: "W" });
    const missing = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(makeTenantServiceFetcher({ baseUrl: "http://t", secret: "s", fetchFn: missing })(T_OLD)).resolves.toBeNull();
    const down = vi.fn().mockResolvedValue(new Response("boom", { status: 503 }));
    await expect(makeTenantServiceFetcher({ baseUrl: "http://t", secret: "s", fetchFn: down })(T_OLD)).rejects.toThrow(/503/);
  });
});

async function rowOf(id: string) {
  return runWithTenant(id, () => db.transaction((tx) => tx.select().from(adminTenants).where(eq(adminTenants.id, id))));
}
async function wipe() {
  for (const [id, msg] of [[T_NEW, MSG_NEW], [T_OLD, MSG_OLD]] as const) {
    await runWithTenant(id, () => db.transaction(async (tx) => {
      await tx.delete(adminTenants).where(eq(adminTenants.id, id));
      await tx.delete(processed).where(eq(processed.messageId, msg));
    }));
  }
}

describe("tenant.tenant.created consumer (integration)", () => {
  beforeAll(wipe);
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("registers a tenant from the v1.1 event and from a v1.0 event (fields fetched)", async () => {
    const fetchTenant = vi.fn().mockResolvedValue({
      id: T_OLD, name: "F133 Old Office", domain: "f133-old.example.in", edition: "govt", status: "active",
      region: "ap-south-1", residency: "IN",
    });
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenantConsumers(q, { fetchTenant });
    await q.start();
    await q.publish("tenant.tenant.created", {
      messageId: MSG_NEW, type: "tenant.tenant.created", tenantId: T_NEW, actorId: ACTOR, correlationId: "c-new",
      schemaVersion: "1.1", payload: FULL,
    });
    await q.publish("tenant.tenant.created", {
      messageId: MSG_OLD, type: "tenant.tenant.created", tenantId: T_OLD, actorId: ACTOR, correlationId: "c-old",
      schemaVersion: "1.0", payload: { tenantId: T_OLD, plan: "govt" },
    });
    await new Promise((r) => setTimeout(r, 800));
    await q.stop();

    const [fresh] = await rowOf(T_NEW);
    expect(fresh).toMatchObject({ id: T_NEW, tenantId: T_NEW, name: "F133 New Office", domain: "f133-new.example.in", edition: "govt_dept", status: "draft" });
    const [legacy] = await rowOf(T_OLD);
    expect(legacy).toMatchObject({ id: T_OLD, tenantId: T_OLD, name: "F133 Old Office", edition: "govt_dept", status: "active" });
    expect(fetchTenant).toHaveBeenCalledTimes(1);
  });
});
