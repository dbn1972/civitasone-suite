/**
 * Real-DB tests for the outsourced workforce register (GAP-HR-OUTSOURCED-01):
 * paged list with a real total + whole-tenant stats, async create/update through
 * the consumer (one transaction with its audit row), role gate, validation,
 * paise-as-string, terminated-is-final conditional update, tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerOutsourcedConsumers } from "../modules/outsourced/consumer.js";
import type { FastifyInstance } from "fastify";

registerOutsourcedConsumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const HR = randomUUID();
const hdr = (tenant: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: HR, tid: tenant, roles, sid: "sess-outsourced" }, SECRET, 3600)}` });

let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function create(tenant: string, over: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST", url: "/v1/hrms/outsourced", headers: hdr(tenant, ["hr_admin"]),
    payload: { vendorName: "SecureGuard Services", serviceCategory: "Security", headcount: 12, contractStart: "2026-01-01", contractEnd: "2099-12-31", contractValueMinor: "123456700", ...over },
  });
  await drain();
  return res;
}

async function audits(tenant: string, action: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, tenant, (tx: any) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenant)));
  return (rows as Array<{ actorId: string; payload: { action?: string; resourceType?: string } }>)
    .filter((r) => r.payload?.resourceType === "outsourced_contract" && r.payload?.action === action);
}

describe("outsourced register (GAP-HR-OUTSOURCED-01)", () => {
  it("creates a contract asynchronously, lists it with paise as a string, a total and stats, and audits it", async () => {
    const res = await create(TENANT);
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;

    const list = await app.inject({ method: "GET", url: "/v1/hrms/outsourced", headers: hdr(TENANT, ["hr_officer"]) });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.data[0]).toMatchObject({ id, vendorName: "SecureGuard Services", headcount: 12, contractValueMinor: "123456700", status: "active" });
    expect(body.stats).toMatchObject({ contracts: 1, vendors: 1, activeContracts: 1, totalHeadcount: 12 });
    const ev = await audits(TENANT, "create");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.actorId).toBe(HR);
  });

  it("pages with a stable order and an exact total beyond the page", async () => {
    for (let i = 0; i < 3; i++) await create(TENANT, { vendorName: `Vendor ${i}`, contractEnd: `2098-0${i + 1}-15` });
    const p1 = (await app.inject({ method: "GET", url: "/v1/hrms/outsourced?limit=2&offset=0", headers: hdr(TENANT, ["hr_admin"]) })).json();
    const p2 = (await app.inject({ method: "GET", url: "/v1/hrms/outsourced?limit=2&offset=2", headers: hdr(TENANT, ["hr_admin"]) })).json();
    expect(p1.total).toBe(4);
    expect(p1.hasMore).toBe(true);
    const ids = [...p1.data, ...p2.data].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(4); // no skip / repeat across pages
  });

  it("denies a non-HR role and validates input", async () => {
    const denied = await app.inject({ method: "GET", url: "/v1/hrms/outsourced", headers: hdr(TENANT, ["employee"]) });
    expect(denied.statusCode).toBe(403);
    const deniedWrite = await app.inject({ method: "POST", url: "/v1/hrms/outsourced", headers: hdr(TENANT, ["employee"]), payload: {} });
    expect(deniedWrite.statusCode).toBe(403);
    const bad = await create(TENANT, { contractStart: "2026-06-01", contractEnd: "2026-05-01" });
    expect(bad.statusCode).toBe(400);
    const badMoney = await create(TENANT, { contractValueMinor: "12.5" });
    expect(badMoney.statusCode).toBe(400);
  });

  it("terminating is audited and final: a later update is refused with 409 and changes nothing", async () => {
    const id = (await create(TENANT, { vendorName: "To Terminate" })).json().id as string;
    const term = await app.inject({ method: "PATCH", url: `/v1/hrms/outsourced/${id}`, headers: hdr(TENANT, ["hr_admin"]), payload: { status: "terminated" } });
    expect(term.statusCode).toBe(202);
    await drain();
    expect((await audits(TENANT, "terminate")).length).toBeGreaterThanOrEqual(1);

    // a stale/concurrent command tries to bump headcount after termination
    const stale = await app.inject({ method: "PATCH", url: `/v1/hrms/outsourced/${id}`, headers: hdr(TENANT, ["hr_admin"]), payload: { headcount: 999 } });
    expect(stale.statusCode).toBe(409); // route refuses, not 202 + silent consumer no-op
    await drain();
    const row = (await app.inject({ method: "GET", url: "/v1/hrms/outsourced?status=terminated", headers: hdr(TENANT, ["hr_admin"]) })).json().data.find((r: { id: string }) => r.id === id);
    expect(row.status).toBe("terminated");
    expect(row.headcount).toBe(12);
    expect(row.version).toBe(2);
  });

  it("404s an update of an unknown id and never leaks another tenant rows", async () => {
    const nf = await app.inject({ method: "PATCH", url: `/v1/hrms/outsourced/${randomUUID()}`, headers: hdr(TENANT, ["hr_admin"]), payload: { headcount: 1 } });
    expect(nf.statusCode).toBe(404);
    const other = (await app.inject({ method: "GET", url: "/v1/hrms/outsourced", headers: hdr(OTHER, ["hr_admin"]) })).json();
    expect(other.total).toBe(0);
    expect(other.data).toEqual([]);
  });

  it("terminate appends its reason to remarks instead of overwriting the earlier note", async () => {
    const id = (await create(TENANT, { vendorName: "Remarks Co", remarks: "initial note" })).json().id as string;
    await app.inject({ method: "PATCH", url: `/v1/hrms/outsourced/${id}`, headers: hdr(TENANT, ["hr_admin"]), payload: { status: "terminated", remarks: "vendor breach" } });
    await drain();
    const row = (await app.inject({ method: "GET", url: "/v1/hrms/outsourced?status=terminated&limit=200", headers: hdr(TENANT, ["hr_admin"]) })).json().data.find((r: { id: string }) => r.id === id);
    expect(row.remarks).toBe("initial note\nvendor breach");
  });
});
