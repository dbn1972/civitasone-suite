/**
 * GET /v1/admin/security/overview (replaces the 501 stub).
 * The peers (identity summary, audit count + events) are stubbed at the HTTP boundary; the route's own
 * behaviour is real: role gate, token + tenant forwarding, filters sent to audit, mapping, contract check,
 * and honest error relay (never a fabricated 200).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { AdminSecurityOverviewSchema } from "@civitasone/schemas/web";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { toSecurityEvent, SECURITY_OVERVIEW_ROLES } from "../src/modules/gap/security-overview-routes.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "bbbbbbbb-5ec0-4000-8000-0000000000a1";
const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: "sec-user", tid: TENANT, roles, sid: "sess-sec" }, SECRET, 3600)}` });
const URL_ = "/v1/admin/security/overview";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SUMMARY = { activeSessions: 7, trustedDevices: 3, activeUsers: 10, mfaEnabledUsers: 4, mfaAdoptionRate: 40, asOf: "2026-10-24T00:00:00.000Z" };
const EVENTS = [
  {
    id: "11111111-1111-4111-8111-111111111111", type: "audit.event.record", occurredAt: "2026-10-24T08:00:00.000Z",
    ipAddress: "10.1.2.3", actor: { actorId: "u1", email: "a@nic.in" }, payload: { service: "identity", action: "mfa_verify_failed", outcome: "failure" },
  },
  {
    id: "22222222-2222-4222-8222-222222222222", type: "audit.event.record", occurredAt: "2026-10-24T07:00:00.000Z",
    ipAddress: null, actor: { actorId: "u2" }, payload: { service: "identity", action: "mfa_enable" },
  },
];

function stubPeers(opts: { summary?: Response; count?: Response; events?: Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/identity/security/summary")) return opts.summary ?? json(200, SUMMARY);
    if (url.includes("/audit/events/count")) return opts.count ?? json(200, { total: 5 });
    if (url.includes("/audit/events")) return opts.events ?? json(200, EVENTS);
    throw new Error(`unexpected upstream ${url}`);
  });
}

describe("authorization", () => {
  it("401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: URL_ })).statusCode).toBe(401);
  });
  it.each([["employee"], ["hr_admin"], ["tenant_admin"], ["audit_officer"]])("403 for %s (outside identity-session-admin ∩ audit-reader)", async (role) => {
    const spy = stubPeers();
    expect((await app.inject({ method: "GET", url: URL_, headers: hdr([role]) })).statusCode).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("the gate is exactly platform_admin + super_admin", () => {
    expect([...SECURITY_OVERVIEW_ROLES].sort()).toEqual(["platform_admin", "super_admin"]);
  });
});

describe("aggregate", () => {
  it("200 in the exact shape the Security Center loader validates", async () => {
    stubPeers();
    const res = await app.inject({ method: "GET", url: URL_, headers: hdr(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(AdminSecurityOverviewSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      activeSessions: 7, failedLogins24h: 5, mfaAdoptionRate: 40, trustedDevices: 3,
      events: [
        { id: EVENTS[0]!.id, timestamp: "2026-10-24T08:00:00.000Z", type: "mfa_verify_failed", actor: "a@nic.in", ipAddress: "10.1.2.3", outcome: "failure" },
        { id: EVENTS[1]!.id, timestamp: "2026-10-24T07:00:00.000Z", type: "mfa_enable", actor: "u2", ipAddress: "—", outcome: "success" },
      ],
    });
  });

  it("forwards the caller's bearer token and tenant, and asks audit for identity failures in the last 24h only", async () => {
    const spy = stubPeers();
    const h = hdr(["platform_admin"]);
    const before = Date.now();
    await app.inject({ method: "GET", url: URL_, headers: h });
    const calls = spy.mock.calls.map((c) => ({ url: String(c[0]), init: c[1] as RequestInit }));
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      const headers = c.init.headers as Record<string, string>;
      expect(headers.authorization).toBe(h.authorization);
      expect(headers["x-tenant-id"]).toBe(TENANT);
    }
    const count = calls.find((c) => c.url.includes("/audit/events/count"))!;
    const u = new URL(count.url);
    expect(u.searchParams.get("service")).toBe("identity");
    expect(u.searchParams.get("outcome")).toBe("failure");
    const from = Date.parse(u.searchParams.get("from")!);
    expect(Math.abs(before - 24 * 3600 * 1000 - from)).toBeLessThan(5000);
  });

  it("an empty tenant yields zeros and an empty event list, still contract-valid", async () => {
    stubPeers({ summary: json(200, { activeSessions: 0, trustedDevices: 0, mfaAdoptionRate: 0 }), count: json(200, { total: 0 }), events: json(200, []) });
    const res = await app.inject({ method: "GET", url: URL_, headers: hdr(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ activeSessions: 0, failedLogins24h: 0, mfaAdoptionRate: 0, trustedDevices: 0, events: [] });
    expect(AdminSecurityOverviewSchema.safeParse(res.json()).success).toBe(true);
  });
});

describe("honest failure (never a fabricated 200)", () => {
  it("relays an upstream 403 from audit", async () => {
    stubPeers({ count: json(403, { code: "FORBIDDEN", message: "no" }) });
    const res = await app.inject({ method: "GET", url: URL_, headers: hdr(["super_admin"]) });
    expect(res.statusCode).toBe(403);
  });
  it("relays an upstream 500 from identity", async () => {
    stubPeers({ summary: json(500, { code: "INTERNAL", message: "boom" }) });
    expect((await app.inject({ method: "GET", url: URL_, headers: hdr(["super_admin"]) })).statusCode).toBe(500);
  });
  it("502 when a peer is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await app.inject({ method: "GET", url: URL_, headers: hdr(["super_admin"]) })).statusCode).toBe(502);
  });
  it("502 when identity answers with a non-object", async () => {
    stubPeers({ summary: json(200, "nope") });
    expect((await app.inject({ method: "GET", url: URL_, headers: hdr(["super_admin"]) })).statusCode).toBe(502);
  });
});

describe("toSecurityEvent", () => {
  it("falls back through actor email -> name -> actorId -> system and action -> type", () => {
    expect(toSecurityEvent({ id: "i", type: "t", occurredAt: "x", actor: { name: "N" }, payload: {} }))
      .toMatchObject({ actor: "N", type: "t", outcome: "success", ipAddress: "—" });
    expect(toSecurityEvent({ id: "i", actor: null, payload: null })).toMatchObject({ actor: "system", type: "event", timestamp: "" });
  });
});
