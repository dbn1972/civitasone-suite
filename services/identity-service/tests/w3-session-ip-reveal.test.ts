/**
 * OWNER DECISION #21 (TENANT-ADMIN-SESSIONS-DETAIL-05): admin views of a session
 * carry a masked IP and a "browser on OS" user agent; only a security_admin can
 * reveal the clear IP, with a reason, and every reveal is audited. Real app +
 * real consumer + real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-0000000021a1";
const OTHER = "bbbbbbbb-0000-4000-8000-0000000021b2";
const USER = "a0000000-0000-4000-8000-0000000021c1";
const ADMIN = "a0000000-0000-4000-8000-0000000021c2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const REASON = "Suspected credential sharing, ticket SEC-114";
const hdr = (roles: string[], tid = TENANT, sub = ADMIN) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "5e551014-0000-4000-8000-00000000005e" } as never, SECRET)}` });

let app: FastifyInstance;
let db: any; let sessions: any; let outboxMessages: any; let infraQueue: Queue;
let sid: string; let otherSid: string;

async function seed(tenantId: string, userId: string, ip: string, ua: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () => db.transaction((tx: any) => tx.insert(sessions).values({
    id, tenantId, userId, ip, device: "d", mfaMethod: "totp", trusted: false, status: "active", userAgent: ua,
    userEmail: "u@gov.in", expiresAt: new Date(Date.now() + 3600_000), createdBy: userId, updatedBy: userId, version: 1,
  })));
  return id;
}
const audits = (tenantId: string) => runWithTenant(tenantId, () => db.transaction((tx: any) =>
  tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId)))) as Promise<Array<{ topic: string; payload: any }>>;
const revealAudits = async (tenantId: string) => (await audits(tenantId)).filter((m) => m.topic === "audit.event.record" && m.payload?.action === "reveal_ip");

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  ({ db } = await import("../src/shared/db.js"));
  ({ sessions } = await import("../src/modules/sessions/schema.js"));
  ({ outboxMessages } = await import("../src/shared/outbox.js"));
  ({ queue: infraQueue } = await import("../src/shared/infra.js"));
  const { registerSessionConsumers } = await import("../src/modules/sessions/consumer.js");
  const raw = infraQueue.subscribe.bind(infraQueue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (infraQueue as any).subscribe = (topic: string, h: (m: any) => Promise<void>) => raw(topic, (m: any) => runWithTenant(m.tenantId, () => h(m)));
  registerSessionConsumers(infraQueue);
  await infraQueue.start();
  sid = await seed(TENANT, USER, "10.1.2.3", UA);
  otherSid = await seed(OTHER, USER, "172.16.9.9", UA);
});
afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx: any) => {
      await tx.delete(sessions).where(eq(sessions.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
  await app.close();
});

describe("session IP reveal + user-agent shortening (owner decision #21)", () => {
  it("admin detail view masks the IP and shortens the user agent to browser + OS", async () => {
    const r = await app.inject({ method: "GET", url: `/identity/sessions/${sid}`, headers: hdr(["tenant_admin"]) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ip: string; userAgent: string };
    expect(body.ip).toBe("10.1.*.*");
    expect(body.userAgent).toBe("Chrome on Windows");
    expect(r.body).not.toContain("10.1.2.3");
    expect(r.body).not.toContain("AppleWebKit");
  });

  it("the admin list masks IPs and shortens user agents too", async () => {
    const r = await app.inject({ method: "GET", url: "/identity/sessions", headers: hdr(["tenant_admin"]) });
    const row = (r.json() as Array<{ id: string; ipAddress: string; userAgent?: string }>).find((s) => s.id === sid)!;
    expect(row.ipAddress).toBe("10.1.*.*");
    expect(row.userAgent).toBe("Chrome on Windows");
  });

  it("security_admin + reason gets the clear IP and an audit event is recorded with the reason", async () => {
    const before = (await revealAudits(TENANT)).length;
    const r = await app.inject({ method: "POST", url: `/identity/sessions/${sid}/reveal-ip`, headers: hdr(["security_admin"]), payload: { reason: REASON } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: sid, ipAddress: "10.1.2.3" });
    expect(r.headers["cache-control"]).toBe("no-store");
    await infraQueue.drain?.();
    await new Promise((res) => setTimeout(res, 300));
    const after = await revealAudits(TENANT);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.payload).toMatchObject({ service: "identity", resourceType: "session", resourceId: sid, reason: REASON });
  });

  it("tenant_admin / platform_admin / super_admin cannot reveal (403) and nothing is audited", async () => {
    const before = (await revealAudits(TENANT)).length;
    for (const roles of [["tenant_admin"], ["platform_admin"], ["super_admin"], ["employee"]]) {
      const r = await app.inject({ method: "POST", url: `/identity/sessions/${sid}/reveal-ip`, headers: hdr(roles), payload: { reason: REASON } });
      expect(r.statusCode).toBe(403);
      expect(r.body).not.toContain("10.1.2.3");
    }
    await new Promise((res) => setTimeout(res, 200));
    expect((await revealAudits(TENANT)).length).toBe(before);
  });

  it("a missing or short reason is a 400", async () => {
    for (const payload of [{}, { reason: "no" }, { reason: "          " }]) {
      const r = await app.inject({ method: "POST", url: `/identity/sessions/${sid}/reveal-ip`, headers: hdr(["security_admin"]), payload });
      expect(r.statusCode).toBe(400);
      expect(r.body).not.toContain("10.1.2.3");
    }
  });

  it("another tenant's session is a 404", async () => {
    const r = await app.inject({ method: "POST", url: `/identity/sessions/${otherSid}/reveal-ip`, headers: hdr(["security_admin"]), payload: { reason: REASON } });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain("172.16.9.9");
  });

  it("security_admin can open the masked list and detail (to reach the reveal action) but not revoke", async () => {
    const list = await app.inject({ method: "GET", url: "/identity/sessions", headers: hdr(["security_admin"]) });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain("10.1.2.3");
    const detail = await app.inject({ method: "GET", url: `/identity/sessions/${sid}`, headers: hdr(["security_admin"]) });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { ip: string }).ip).toBe("10.1.*.*");
    expect(detail.body).not.toContain("10.1.2.3");
    const revoke = await app.inject({ method: "DELETE", url: `/identity/sessions/${sid}`, headers: hdr(["security_admin"]) });
    expect(revoke.statusCode).toBe(403);
  });

  it("an unrelated role still cannot read the session list or someone else's detail", async () => {
    expect((await app.inject({ method: "GET", url: "/identity/sessions", headers: hdr(["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/identity/sessions/${sid}`, headers: hdr(["employee"]) })).statusCode).toBe(403);
  });
});
