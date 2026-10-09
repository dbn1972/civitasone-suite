/**
 * GAP-ADMIN-SETTINGS-01 / -05 / -06: GET/PATCH /v1/admin/settings/*, the logo
 * upload and the email test. Real Postgres (non-superuser app role, FORCE RLS),
 * real Fastify via app.inject(), the in-memory queue with the real consumers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { settingsSections, tenantLogos } from "../src/modules/tenant-settings/schema.js";
import { registerAllF3Consumers } from "./helpers/register-all-f3-consumers.js";
import { drainOrFail } from "../../../vitest.drain";

process.env.CONFIG_ENC_KEY = process.env.CONFIG_ENC_KEY ?? "test_config_enc_key_for_civitasone_32c"; // gitleaks:allow
const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = "5e770000-0000-4000-8000-0000000000a1";
const TB = "5e770000-0000-4000-8000-0000000000b1";
const ACTOR = "5e77acc0-0000-4000-8000-0000000000a1";

function auth(roles: string[], tenant = TA) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "sess-ts" }, SECRET, 3600)}` };
}
const admin = (tenant = TA) => auth(["tenant_admin"], tenant);

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let app: FastifyInstance;

async function outboxFor(tenant: string) {
  return runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenant))));
}
async function wipe() {
  for (const t of [TA, TB]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(settingsSections).where(eq(settingsSections.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(tenantLogos).where(eq(tenantLogos.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  registerAllF3Consumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

async function get(tenant = TA) {
  const res = await app.inject({ method: "GET", url: "/v1/admin/settings", headers: admin(tenant) });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}
async function until<T>(fn: () => Promise<T | undefined | false>, tries = 300): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not reached: the command was never applied");
}
/** PATCH, then wait for the (async) consumer to apply it: the section version moves forward. */
async function patch(section: string, payload: unknown, tenant = TA) {
  const prev = ((await get(tenant))[section]?.version as number | undefined) ?? 0;
  const res = await app.inject({ method: "PATCH", url: `/v1/admin/settings/${section}`, headers: admin(tenant), payload: payload as object });
  if (res.statusCode === 202) {
    await drainOrFail(queue); // consumer (incl. retries) has fully settled
    await until(async () => (await get(tenant))[section].version > prev);
  }
  return res;
}

describe("access + validation", () => {
  it("rejects a plain employee on every route and an anonymous caller", async () => {
    for (const [method, url] of [["GET", "/v1/admin/settings"], ["PATCH", "/v1/admin/settings/general"], ["GET", "/v1/admin/settings/logo"], ["POST", "/v1/admin/settings/email/test"]] as const) {
      const res = await app.inject({ method, url, headers: auth(["employee"]), payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/v1/admin/settings" })).statusCode).toBe(401);
  });

  it("rejects out-of-bounds, unknown and non-https values with 400 and stores nothing", async () => {
    expect((await patch("security", { sessionTimeoutMin: 1 })).statusCode).toBe(400);
    expect((await patch("security", { ipWhitelist: "not-a-cidr" })).statusCode).toBe(400);
    expect((await patch("general", { logoUrl: "x.png" })).statusCode).toBe(400);
    expect((await patch("integrations", { pfmsUrl: "http://insecure.example" })).statusCode).toBe(400);
    expect((await patch("general", {})).statusCode).toBe(400);
    expect((await patch("nope", { a: 1 })).statusCode).toBe(400);
    expect((await get()).security.configured).toBe(false);
  });
});

describe("GET / PATCH round trip (SETTINGS-01)", () => {
  it("starts unconfigured, then returns exactly what was saved", async () => {
    const before = await get();
    expect(before.general).toMatchObject({ configured: false, values: {} });
    const res = await patch("general", { orgName: "Dept of Posts", timezone: "Asia/Kolkata", fiscalYearStart: "04" });
    expect(res.statusCode).toBe(202);
    const after = await get();
    expect(after.general.configured).toBe(true);
    expect(after.general.values).toEqual({ orgName: "Dept of Posts", timezone: "Asia/Kolkata", fiscalYearStart: "04" });
  });

  it("editing one field leaves every other stored field untouched (merge, not overwrite)", async () => {
    await patch("general", { currency: "INR", dateFormat: "dd/MM/yyyy" });
    await patch("general", { orgName: "Dept of Posts (HQ)" });
    expect((await get()).general.values).toEqual({
      orgName: "Dept of Posts (HQ)", timezone: "Asia/Kolkata", fiscalYearStart: "04", currency: "INR", dateFormat: "dd/MM/yyyy",
    });
  });

  it("two concurrent saves of different fields both survive (row-locked read-merge-write)", async () => {
    const send = (payload: object) => app.inject({ method: "PATCH", url: "/v1/admin/settings/security", headers: admin(), payload });
    const [a, b, c] = await Promise.all([
      send({ sessionTimeoutMin: 30 }),
      send({ maxLoginAttempts: 5 }),
      send({ passwordMinLen: 12, mfaRequired: true, ipWhitelist: "10.0.0.0/8\n192.168.1.0/24" }),
    ]);
    expect([a.statusCode, b.statusCode, c.statusCode]).toEqual([202, 202, 202]);
    await drainOrFail(queue);
    await until(async () => (await get()).security.version >= 4);
    const s = (await get()).security;
    expect(s.values).toEqual({ sessionTimeoutMin: 30, maxLoginAttempts: 5, passwordMinLen: 12, mfaRequired: true, ipWhitelist: ["10.0.0.0/8", "192.168.1.0/24"] });
    expect(s.version).toBe(4); // 1 placeholder insert + three conditional increments, none lost
  });

  it("is tenant-scoped: another tenant never sees these values", async () => {
    const other = await get(TB);
    expect(other.general.configured).toBe(false);
    expect(other.security.configured).toBe(false);
    expect(other.email.values).toEqual({ hasPassword: false });
  });
});

describe("SMTP password is write-only (SETTINGS-06)", () => {
  it("is sealed at rest, never returned, and survives a later save of another field", async () => {
    const plain = "Sup3r-Secret-Pw!";
    expect((await patch("email", { smtpHost: "smtp.nic.in", smtpPort: "587", fromEmail: "noreply@dept.gov.in", smtpPass: plain })).statusCode).toBe(202);
    const body = (await app.inject({ method: "GET", url: "/v1/admin/settings", headers: admin() })).body;
    expect(body).not.toContain(plain);
    expect(body).not.toContain("v1:");
    expect(JSON.parse(body).data.email.values).toMatchObject({ smtpHost: "smtp.nic.in", smtpPort: 587, hasPassword: true });
    const rows = await runWithTenant(TA, () => db.transaction((tx) => tx.select().from(settingsSections).where(eq(settingsSections.tenantId, TA))));
    const email = rows.find((r) => r.section === "email")!;
    expect(email.secretCiphertext).toMatch(/^v1:/);
    expect(email.secretCiphertext).not.toContain(plain);
    expect(JSON.stringify(email.values)).not.toContain(plain);
    await patch("email", { fromName: "Dept of Posts" });
    const after = await runWithTenant(TA, () => db.transaction((tx) => tx.select().from(settingsSections).where(eq(settingsSections.tenantId, TA))));
    expect(after.find((r) => r.section === "email")!.secretCiphertext).toBe(email.secretCiphertext);
  });

  it("audits the change with the field NAME only, never the secret value", async () => {
    const audits = (await outboxFor(TA)).filter((r) => (r.payload as { action?: string }).action === "settings.email.update");
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const first = audits.map((r) => JSON.stringify(r.payload)).join("\n");
    expect(first).toContain("smtpPass");
    expect(first).not.toContain("Sup3r-Secret-Pw!");
    expect(audits[0]!.actorId).toBe(ACTOR);
  });

  it("email test: 409 until SMTP is configured, then queues a notification.send", async () => {
    const none = await app.inject({ method: "POST", url: "/v1/admin/settings/email/test", headers: admin(TB), payload: { recipient: "me@dept.gov.in" } });
    expect(none.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/v1/admin/settings/email/test", headers: admin(), payload: { recipient: "nope" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/v1/admin/settings/email/test", headers: admin(), payload: { recipient: "me@dept.gov.in" } });
    expect(ok.statusCode).toBe(202);
    const sends = await until(async () => {
      const rows = (await outboxFor(TA)).filter((r) => r.topic === "notification.send");
      return rows.length > 0 ? rows : undefined;
    });
    expect(sends).toHaveLength(1);
    expect(sends[0]!.payload).toMatchObject({ channel: "email", recipient: "me@dept.gov.in" });
  });
});

describe("test email throttling", () => {
  const T3 = "5e770000-0000-4000-8000-0000000000c1";
  const actorToken = (actor: string, tenant: string) => ({ authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles: ["tenant_admin"], sid: "sess-rl" }, SECRET, 3600)}` });
  const send = (actor: string, tenant: string) => app.inject({ method: "POST", url: "/v1/admin/settings/email/test", headers: actorToken(actor, tenant), payload: { recipient: "me@dept.gov.in" } });
  const configure = async (tenant: string, actor: string) => {
    await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(settingsSections).values({ tenantId: tenant, section: "email", values: { smtpHost: "smtp.x.gov.in", fromEmail: "a@x.gov.in" }, updatedBy: actor }).onConflictDoNothing()));
  };
  const cleanup = (tenants: string[]) => Promise.all(tenants.map((t) => runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(settingsSections).where(eq(settingsSections.tenantId, t));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
  }))));

  it("a second test email for the same tenant inside the cooldown is a 429 and queues nothing", async () => {
    const actor = "5e77acc0-0000-4000-8000-0000000000c1";
    await configure(T3, actor);
    expect((await send(actor, T3)).statusCode).toBe(202);
    const again = await send(actor, T3);
    expect(again.statusCode).toBe(429);
    expect(again.json().code).toBe("RATE_LIMITED");
    await drainOrFail(queue);
    expect((await outboxFor(T3)).filter((r) => r.topic === "notification.send")).toHaveLength(1);
    await cleanup([T3]);
  });

  it("one actor is capped at 5 per hour across tenants; parallel requests cannot all pass", async () => {
    const actor = "5e77acc0-0000-4000-8000-0000000000c2";
    const tenants = Array.from({ length: 7 }, (_, i) => `5e770000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
    for (const t of tenants) await configure(t, actor);
    const codes = (await Promise.all(tenants.map((t) => send(actor, t)))).map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 202)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
    await cleanup(tenants);
  });

  it("the queued message says what the test proves, and what it does not", async () => {
    const t = "5e770000-0000-4000-8000-0000000002aa";
    const actor = "5e77acc0-0000-4000-8000-0000000000c3";
    await configure(t, actor);
    expect((await send(actor, t)).statusCode).toBe(202);
    const mail = await until(async () => (await outboxFor(t)).find((r) => r.topic === "notification.send"));
    const body = String((mail.payload as { body: string }).body);
    expect(body).toMatch(/platform sender works/);
    expect(body).toMatch(/not sent through your office's own SMTP/);
    expect(body).not.toMatch(/outgoing email is working/);
    await cleanup([t]);
  });
});

describe("logo upload (SETTINGS-05)", () => {
  const b64 = PNG.toString("base64");
  it("stores a PNG, returns it, and rejects a spoofed type or an oversize file", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/settings/logo", headers: admin() })).statusCode).toBe(404);
    expect((await get()).logo.present).toBe(false);
    const up = await app.inject({ method: "POST", url: "/v1/admin/settings/logo", headers: admin(), payload: { contentType: "image/png", dataBase64: b64 } });
    expect(up.statusCode).toBe(202);
    const got = await until(async () => {
      const r = await app.inject({ method: "GET", url: "/v1/admin/settings/logo", headers: admin() });
      return r.statusCode === 200 ? r.json().data : undefined;
    });
    expect(got.dataBase64).toBe(b64);
    expect(got.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));
    const snap = (await get()).logo;
    expect(snap).toMatchObject({ present: true, contentType: "image/png", sizeBytes: PNG.length });
    // A JPEG label on PNG bytes (and an SVG) is refused: magic bytes decide, not the declared type.
    const spoof = await app.inject({ method: "POST", url: "/v1/admin/settings/logo", headers: admin(), payload: { contentType: "image/jpeg", dataBase64: b64 } });
    expect(spoof.statusCode).toBe(422);
    const svg = await app.inject({ method: "POST", url: "/v1/admin/settings/logo", headers: admin(), payload: { contentType: "image/svg+xml", dataBase64: Buffer.from("<svg/>").toString("base64") } });
    expect(svg.statusCode).toBe(400);
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(160_000)]).toString("base64");
    const over = await app.inject({ method: "POST", url: "/v1/admin/settings/logo", headers: admin(), payload: { contentType: "image/png", dataBase64: big } });
    expect([400, 413, 422]).toContain(over.statusCode);
    // the stored logo is unchanged by the rejected attempts
    expect((await get()).logo.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));
  });

  it("is tenant-scoped, audited, and removable", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/settings/logo", headers: admin(TB) })).statusCode).toBe(404);
    expect((await outboxFor(TA)).some((r) => (r.payload as { action?: string }).action === "settings.logo.set")).toBe(true);
    expect((await app.inject({ method: "DELETE", url: "/v1/admin/settings/logo", headers: admin() })).statusCode).toBe(202);
    await until(async () => (await app.inject({ method: "GET", url: "/v1/admin/settings/logo", headers: admin() })).statusCode === 404);
    expect((await get()).logo.present).toBe(false);
  });
});
