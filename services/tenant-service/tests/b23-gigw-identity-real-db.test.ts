/**
 * UAT b23 onboarding gap: the GIGW footer owner was fixed at build time, so every tenant showed
 * the same department. A tenant admin now sets `gigw.identity` (PUT /v1/settings) and every signed-in
 * user of THAT tenant reads it from GET /v1/tenant/gigw-identity. Real Postgres, FORCE RLS as the
 * NOBYPASSRLS tenant_svc role, real settings consumer:
 *   - write: tenant_admin only (403 otherwise), shape validated (unknown keys / bad date -> 400);
 *   - read: any signed-in tenant user, not an admin-only route; 401 anonymous;
 *   - tenant isolation: tenant B never sees tenant A's identity, even right after A wrote it;
 *   - never cached: private, no-store; an update is visible on the very next read;
 *   - a malformed stored value degrades to null (web falls back to build-time env), never leaks junk.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerSettingConsumers } from "../src/modules/settings/consumer.js";
import { tenantSettings } from "../src/modules/settings/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const KEY = "gigw.identity";
const SUNDARPUR = randomUUID();
const DIGITAL_INDIA = randomUUID();
const USER = randomUUID();

const hdr = (tenantId: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: tenantId, roles, sid: "gigw" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 30)); v = await fn(); }
  return v;
}
const read = async (tenantId: string, roles = ["employee"]) => {
  const res = await app.inject({ method: "GET", url: "/v1/tenant/gigw-identity", headers: hdr(tenantId, roles) });
  return { status: res.statusCode, body: res.json() as { identity: Record<string, string> | null }, headers: res.headers };
};
const put = (tenantId: string, roles: string[], value: unknown) =>
  app.inject({ method: "PUT", url: "/v1/settings", headers: hdr(tenantId, roles), payload: { key: KEY, value } });

let app: FastifyInstance;

beforeAll(async () => {
  const q = queue as unknown as { subscribe: (t: string, h: (m: { tenantId: string }) => Promise<void>) => void };
  const raw = q.subscribe.bind(q);
  q.subscribe = (topic, handler) => raw(topic, (msg) => runWithTenant(msg.tenantId, () => handler(msg)));
  registerSettingConsumers(queue);
  await queue.start();
  app = await buildApp();
});
afterAll(async () => {
  for (const t of [SUNDARPUR, DIGITAL_INDIA]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(tenantSettings).where(eq(tenantSettings.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/tenant/gigw-identity (real DB, NOBYPASSRLS)", () => {
  it("401 anonymous; a tenant with nothing configured gets identity null (web falls back to build-time env)", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/tenant/gigw-identity" })).statusCode).toBe(401);
    const r = await read(SUNDARPUR);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ identity: null });
  });

  it("only a tenant admin can set it; others are refused (403) and nothing is stored", async () => {
    for (const roles of [["employee"], ["hr_admin"], ["manager"]]) {
      expect((await put(SUNDARPUR, roles, { department: "Sundarpur Municipal Corporation" })).statusCode, roles.join()).toBe(403);
    }
    expect((await read(SUNDARPUR)).body.identity).toBeNull();
  });

  it("rejects an unknown field, an over-long value and a bad review date (400)", async () => {
    for (const bad of [
      { department: "Sundarpur Municipal Corporation", isAdmin: true },
      { department: "x".repeat(201) },
      { reviewedAt: "11/11/2026" },
      "just a string",
    ]) expect((await put(SUNDARPUR, ["tenant_admin"], bad)).statusCode, JSON.stringify(bad)).toBe(400);
    expect((await read(SUNDARPUR)).body.identity).toBeNull();
  });

  it("a tenant admin sets the identity; any signed-in user of that tenant reads it back, never cached", async () => {
    const value = {
      department: "Sundarpur Municipal Corporation",
      address: "Civic Centre, Station Road, Sundarpur - 440012, Maharashtra",
      wimDesignation: "Deputy Commissioner (IT)",
      helpdeskEmail: "helpdesk@sundarpurmc.gov.in",
      helpdeskHours: "Mon-Fri, 10:00-17:30 IST",
      reviewedAt: "2026-11-01",
    };
    expect((await put(SUNDARPUR, ["tenant_admin"], { ...value, wimEmail: "  " })).statusCode).toBe(202);
    const r = await until(() => read(SUNDARPUR), (x) => x.body.identity !== null);
    expect(r.body.identity).toEqual(value); // blank wimEmail dropped
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.headers["vary"]).toMatch(/Authorization/i);
    expect((await read(SUNDARPUR, ["citizen"])).body.identity?.department).toBe("Sundarpur Municipal Corporation");

    // an update is visible on the very next read (no stale cache)
    expect((await put(SUNDARPUR, ["tenant_admin"], { ...value, department: "Sundarpur Nagar Nigam" })).statusCode).toBe(202);
    const r2 = await until(() => read(SUNDARPUR), (x) => x.body.identity?.department === "Sundarpur Nagar Nigam");
    expect(r2.body.identity?.department).toBe("Sundarpur Nagar Nigam");
  });

  it("tenant isolation: another tenant never sees it, and has its own", async () => {
    expect((await read(DIGITAL_INDIA)).body.identity).toBeNull();
    expect((await put(DIGITAL_INDIA, ["tenant_admin"], { department: "Digital India Corporation" })).statusCode).toBe(202);
    const di = await until(() => read(DIGITAL_INDIA), (x) => x.body.identity !== null);
    expect(di.body.identity).toEqual({ department: "Digital India Corporation" });
    expect((await read(SUNDARPUR)).body.identity?.department).toBe("Sundarpur Nagar Nigam");
  });

  it("a malformed stored value degrades to null instead of leaking arbitrary data", async () => {
    await runWithTenant(DIGITAL_INDIA, () => db.transaction((tx) => tx.update(tenantSettings)
      .set({ value: { department: "Digital India Corporation", smtp_password: "do-not-leak" } })
      .where(eq(tenantSettings.tenantId, DIGITAL_INDIA))));
    const r = await read(DIGITAL_INDIA);
    expect(r.body).toEqual({ identity: null });
    expect(JSON.stringify(r.body)).not.toContain("do-not-leak");
  });
});
