/**
 * OWNER DECISION #20 (TENANT-ADMIN-AUDIT-03): the tenant audit list carries
 * masked actor / IP; the clear values are available only through an audited
 * reveal (audit_officer + reason). Every reveal emits audit.viewed; list reads
 * are not logged individually; tenant_admin stays excluded.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditEvents } from "../src/modules/events/schema.js";
import * as queries from "../src/modules/events/queries.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const OFFICER = randomUUID();
const hdr = (roles: string[], tid = TENANT, sub = OFFICER) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s" }, SECRET, 3600)}` });
const REASON = "Investigating suspicious export on 2026-10-20";

let app: FastifyInstance;
let eventId: string;
let otherEventId: string;

const viewed = (tenant: string) => runWithTenant(tenant, () => db.transaction((tx) =>
  tx.select().from(auditEvents).where(and(eq(auditEvents.tenantId, tenant), eq(auditEvents.type, "audit.viewed")))));

beforeAll(async () => {
  app = await buildApp();
  eventId = await runWithTenant(TENANT, () => queries.writeEvent(TENANT, randomUUID(), "user.login", "user", "u1", "info", { actor: { email: "asha.verma@gov.in" } }, randomUUID(), "10.1.2.3", "ua"));
  otherEventId = await runWithTenant(OTHER, () => queries.writeEvent(OTHER, randomUUID(), "user.login", "user", "u9", "info", { actor: { email: "other@gov.in" } }, randomUUID(), "172.16.0.9", "ua"));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("audit list masks, reveal is audited (owner decision #20)", () => {
  it("the tenant list returns a masked actor email and a masked source IP", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/audit/events?tenantScoped=true&from=2020-01-01T00:00:00.000Z", headers: hdr(["audit_officer"]) });
    expect(r.statusCode).toBe(200);
    const row = (r.json() as Array<{ id: string; actor: string; ipAddress?: string }>).find((e) => e.id === eventId)!;
    expect(row.actor).toBe("a***@gov.in");
    expect(row.ipAddress).toBe("10.1.*.*");
    expect(JSON.stringify(r.json())).not.toContain("asha.verma");
    expect(JSON.stringify(r.json())).not.toContain("10.1.2.3");
  });

  it("listing does not write an audit.viewed event per read", async () => {
    const before = (await viewed(TENANT)).length;
    await app.inject({ method: "GET", url: "/v1/audit/events?tenantScoped=true&from=2020-01-01T00:00:00.000Z", headers: hdr(["audit_officer"]) });
    expect((await viewed(TENANT)).length).toBe(before);
  });

  it("audit_officer + reason reveals the clear actor and IP and emits audit.viewed with the reason", async () => {
    const before = (await viewed(TENANT)).length;
    const r = await app.inject({ method: "POST", url: `/v1/audit/events/${eventId}/reveal`, headers: hdr(["audit_officer"]), payload: { reason: REASON } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: eventId, actor: "asha.verma@gov.in", ipAddress: "10.1.2.3" });
    expect(r.headers["cache-control"]).toBe("no-store");
    const after = await viewed(TENANT);
    expect(after.length).toBe(before + 1);
    const ev = after.find((e) => e.target === eventId)!;
    expect((ev.payload as { reason: string }).reason).toBe(REASON);
    expect(ev.actor).toMatchObject({ actorId: OFFICER });
  });

  it("every role other than audit_officer is refused, and nothing is logged", async () => {
    const before = (await viewed(TENANT)).length;
    for (const roles of [["tenant_admin"], ["platform_admin"], ["super_admin"], ["audit_admin"], ["employee"]]) {
      const r = await app.inject({ method: "POST", url: `/v1/audit/events/${eventId}/reveal`, headers: hdr(roles), payload: { reason: REASON } });
      expect(r.statusCode).toBe(403);
    }
    expect((await viewed(TENANT)).length).toBe(before);
  });

  it("a missing or too-short reason is a 400 and nothing is revealed or logged", async () => {
    const before = (await viewed(TENANT)).length;
    for (const payload of [{}, { reason: "short" }, { reason: "   " }]) {
      const r = await app.inject({ method: "POST", url: `/v1/audit/events/${eventId}/reveal`, headers: hdr(["audit_officer"]), payload });
      expect(r.statusCode).toBe(400);
      expect(r.body).not.toContain("asha.verma");
    }
    expect((await viewed(TENANT)).length).toBe(before);
  });

  it("another tenant's event is a 404 (never revealed across tenants)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/audit/events/${otherEventId}/reveal`, headers: hdr(["audit_officer"]), payload: { reason: REASON } });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain("other@gov.in");
    expect((await viewed(TENANT)).filter((e) => e.target === otherEventId)).toHaveLength(0);
  });
});
