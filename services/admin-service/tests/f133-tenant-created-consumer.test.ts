/**
 * UAT bundle 15 (F133): admin-service registers a new tenant from tenant.tenant.created. tenant-service sent only
 * `{ tenantId, plan }` while this consumer read `id/name/domain/edition/region/residency`, so the insert had no id and
 * the tenant never reached /admin/tenants (evidence: /admin/tenants/353c0e2c-... 404, tenant present in
 * tenant-service). The consumer now reads the v1.1 payload directly, and for a v1.0 event it fetches the missing
 * directory fields from tenant-service instead of inserting a broken row.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { MemoryQueue, createQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { adminTenants } from "../src/modules/tenants/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenants/consumer.js";
import { NonRetryableError } from "@civitasone/queue";
import {
  resolveTenantCreated, makeTenantServiceFetcher, TenantCreatedIncompleteError,
} from "../src/modules/tenants/tenant-created.js";
import { drainAllQueues } from "../../../vitest.drain";

const T_NEW = "f1330000-0000-4000-8000-000000000001";
const T_OLD = "f1330000-0000-4000-8000-000000000002";
const ACTOR = "f1330000-0000-4000-8000-0000000000aa";
const MSG_NEW = "f1330000-0000-4000-8000-0000000000b1";
const MSG_OLD = "f1330000-0000-4000-8000-0000000000b2";
const T_PLAIN = "f1330000-0000-4000-8000-000000000003";
const T_DUP = "f1330000-0000-4000-8000-000000000004";
const T_GHOST = "f1330000-0000-4000-8000-000000000005";
const PLATFORM = "f1330000-0000-4000-8000-0000000000ff";
const MSG_PLAIN = "f1330000-0000-4000-8000-0000000000b3";
const MSG_DUP = "f1330000-0000-4000-8000-0000000000b4";
const MSG_GHOST = "f1330000-0000-4000-8000-0000000000b5";
const MSG_CREATE = "f1330000-0000-4000-8000-0000000000b6";

const FULL = {
  tenantId: T_NEW, id: T_NEW, plan: "govt", edition: "govt", name: "F133 New Office", domain: "f133-new.example.in",
  status: "draft", region: "ap-south-1", residency: "IN",
};

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

  it("TenantCreatedIncompleteError is non-retryable; a contract violation or two different ids are refused", async () => {
    expect(new TenantCreatedIncompleteError("x")).toBeInstanceOf(NonRetryableError);
    await expect(resolveTenantCreated({ tenantId: "not-a-uuid", plan: "govt" }, vi.fn())).rejects.toBeInstanceOf(TenantCreatedIncompleteError);
    await expect(resolveTenantCreated({ ...FULL, id: T_OLD }, vi.fn())).rejects.toThrow(/different tenants/);
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
const ALL = [T_NEW, T_OLD, T_PLAIN, T_DUP, T_GHOST];
const MSGS = [MSG_NEW, MSG_OLD, MSG_PLAIN, MSG_DUP, MSG_GHOST, MSG_CREATE];
async function wipe() {
  for (const id of ALL) {
    await runWithTenant(id, () => db.transaction((tx) => tx.delete(adminTenants).where(eq(adminTenants.id, id))));
  }
  for (const m of MSGS) await db.delete(processed).where(eq(processed.messageId, m));
}
const envelope = (messageId: string, tenantId: string, payload: unknown, schemaVersion = "1.1") => ({
  messageId, type: "tenant.tenant.created", tenantId, actorId: ACTOR, correlationId: `c-${messageId.slice(-2)}`, schemaVersion, payload,
});
const settle = () => drainAllQueues();

/**
 * PR #2450 review (blocker): the first version of this suite wrapped the queue in withTenantConsumer itself, so it
 * proved nothing about the RLS path. These tests use the queues the worker can really run on -- the createQueue()
 * production factory (the one shared/infra.ts and worker.ts use) and a plain MemoryQueue with no tenant decoration --
 * and run as the service role admin_svc, which is not a superuser and has no BYPASSRLS, so FORCE RLS on
 * tenants.admin_tenants applies. On the pre-review code the plain-queue and foreign-envelope cases dead-letter with
 * "new row violates row-level security policy".
 */
describe("tenant.tenant.created consumer (integration, production wiring, non-superuser)", () => {
  beforeAll(wipe);
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("runs as a role that RLS applies to", async () => {
    const [r] = await sqlClient`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it("createQueue() (worker wiring): registers a v1.1 event, and a v1.0 event whose envelope names another tenant", async () => {
    const fetchTenant = vi.fn().mockResolvedValue({
      id: T_OLD, name: "F133 Old Office", domain: "f133-old.example.in", edition: "govt", status: "active",
      region: "ap-south-1", residency: "IN",
    });
    const q = createQueue();
    registerTenantConsumers(q, { fetchTenant });
    await q.start();
    await q.publish("tenant.tenant.created", envelope(MSG_NEW, T_NEW, FULL));
    // A v1.0 event relayed under the creator (platform) tenant: the row must still be written as T_OLD.
    await q.publish("tenant.tenant.created", envelope(MSG_OLD, PLATFORM, { tenantId: T_OLD, plan: "govt" }, "1.0"));
    await settle();
    await q.stop();
    expect((q as unknown as MemoryQueue).dlq ?? []).toEqual([]);
    const [fresh] = await rowOf(T_NEW);
    expect(fresh).toMatchObject({ id: T_NEW, tenantId: T_NEW, name: "F133 New Office", domain: "f133-new.example.in", edition: "govt_dept", status: "draft" });
    const [legacy] = await rowOf(T_OLD);
    expect(legacy).toMatchObject({ id: T_OLD, tenantId: T_OLD, name: "F133 Old Office", edition: "govt_dept", status: "active" });
    expect(fetchTenant).toHaveBeenCalledTimes(1);
  });

  it("plain MemoryQueue (no tenant decoration at all): the row is still written", async () => {
    const q = new MemoryQueue();
    registerTenantConsumers(q, { fetchTenant: vi.fn() });
    await q.publish("tenant.tenant.created", envelope(MSG_PLAIN, T_PLAIN, { ...FULL, tenantId: T_PLAIN, id: T_PLAIN, domain: "f133-plain.example.in" }));
    await settle();
    expect(q.dlq).toEqual([]);
    expect(await rowOf(T_PLAIN)).toHaveLength(1);
  });

  it("a redelivered, already-processed v1.0 event is acked without calling tenant-service", async () => {
    const fetchTenant = vi.fn().mockResolvedValue(null);
    const q = new MemoryQueue({ maxAttempts: 3 });
    registerTenantConsumers(q, { fetchTenant });
    await q.publish("tenant.tenant.created", envelope(MSG_OLD, T_OLD, { tenantId: T_OLD, plan: "govt" }, "1.0"));
    await settle();
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(q.dlq).toEqual([]);
  });

  it("a tenant unknown to tenant-service goes to the DLQ on the first attempt (non-retryable)", async () => {
    const fetchTenant = vi.fn().mockResolvedValue(null);
    const q = new MemoryQueue({ maxAttempts: 5 });
    registerTenantConsumers(q, { fetchTenant });
    await q.publish("tenant.tenant.created", envelope(MSG_GHOST, T_GHOST, { tenantId: T_GHOST, plan: "govt" }, "1.0"));
    await settle();
    expect(fetchTenant).toHaveBeenCalledTimes(1);
    expect(q.dlq).toHaveLength(1);
    expect(await rowOf(T_GHOST)).toHaveLength(0);
  });

  it("a domain already registered for another tenant goes to the DLQ on the first attempt", async () => {
    const q = new MemoryQueue({ maxAttempts: 5 });
    const fetchTenant = vi.fn();
    registerTenantConsumers(q, { fetchTenant });
    await q.publish("tenant.tenant.created", envelope(MSG_DUP, T_DUP, { ...FULL, tenantId: T_DUP, id: T_DUP }));
    await settle();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/already registered/);
    expect(await rowOf(T_DUP)).toHaveLength(0);
  });

  it("admin.tenant.create on a plain queue writes the row in the new tenant context", async () => {
    const q = new MemoryQueue();
    registerTenantConsumers(q, { fetchTenant: vi.fn() });
    await q.publish("admin.tenant.create", {
      messageId: MSG_CREATE, type: "admin.tenant.create", tenantId: PLATFORM, actorId: ACTOR, correlationId: "c-create",
      schemaVersion: "1.0",
      payload: { id: T_GHOST, tenantId: T_GHOST, name: "F133 Admin Create", domain: "f133-admin-create.example.in",
        edition: "psu", status: "draft", region: "ap-south-1", residency: "IN", settings: {}, version: 1 },
    });
    await settle();
    expect(await rowOf(T_GHOST)).toHaveLength(1);
  });
});
