/**
 * Public case-status lookup — e2e against the REAL stack (route → queue → worker →
 * DB) as the non-superuser court_svc role. Proves the PER-COURT CONFIGURABLE access
 * method (otp | captcha | open), the OTP security properties (required, wrong→lock,
 * single-use), that the response carries NO party PII, cross-tenant isolation via the
 * server-resolved tenant, and the shareable public page link. Opt-in via COURT_E2E=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { subscribeConsumers } from "../src/worker.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// three tenants, one per access mode
const T_OTP = randomUUID(), T_CAP = randomUUID(), T_OPEN = randomUUID();
const ADMIN = "9999aaaa-9999-4999-8999-999999999999";
// Per-run random prefixes/slugs so a crashed run never leaves colliding rows in the
// (non-RLS, cross-tenant) public_establishments directory that would break the next run.
const RC = () => ("T" + randomUUID().replace(/-/g, "").slice(0, 5)).toUpperCase();
const B_OTP = RC(), B_CAP = RC(), B_OPEN = RC();
const EST = {
  otp: { code: B_OTP, slug: B_OTP.toLowerCase() + "-court", cnr: B_OTP + "0001112026", tenant: T_OTP, mode: "otp" },
  cap: { code: B_CAP, slug: B_CAP.toLowerCase() + "-court", cnr: B_CAP + "0002222026", tenant: T_CAP, mode: "captcha" },
  open: { code: B_OPEN, slug: B_OPEN.toLowerCase() + "-court", cnr: B_OPEN + "0003332026", tenant: T_OPEN, mode: "open" },
};

// Unique source IP per run: the per-IP OTP rate-limit is a real prod control, but
// app.inject collapses every request to one IP — a fresh IP per run avoids
// cross-run accumulation tripping the limit.
const _h = randomUUID().replace(/-/g, "");
const CLIENT_IP = `10.${parseInt(_h.slice(0,2),16)}.${parseInt(_h.slice(2,4),16)}.${parseInt(_h.slice(4,6),16)}`;
// Random 10-digit mobile per call: the per-MOBILE OTP rate-limit (5/15min) is keyed
// on the number's hash, so fixed test numbers accumulate across runs and trip it.
function mob(): string { return "9" + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join(""); }

function admTok(tenant: string) { return signToken({ sub: ADMIN, tid: tenant, roles: ["super_admin"], sid: "s" }, SECRET, 3600); }
let app: FastifyInstance;

async function jpost(url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.inject({ method: "POST", url, headers, payload: body as object, remoteAddress: CLIENT_IP });
  return { code: res.statusCode, body: res.statusCode < 500 ? res.json() : undefined };
}
async function jget(url: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.inject({ method: "GET", url, headers, remoteAddress: CLIENT_IP });
  return { code: res.statusCode, body: res.statusCode < 500 ? res.json() : undefined };
}
async function waitFor(pred: () => Promise<boolean>, tries = 60, gap = 25) {
  for (let i = 0; i < tries; i++) { if (await pred()) return true; await new Promise((r) => setTimeout(r, gap)); }
  return false;
}
async function seedCase(tenant: string, cnr: string, title: string) {
  const courtId = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    await sql`insert into court.courts (id, tenant_id, name, court_type) values (${courtId}, ${tenant}, ${title + " Court"}, ${"revenue"})`;
    await sql`insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, stage, court_id)
              values (${randomUUID()}, ${tenant}, ${cnr}, ${"civil"}, ${"2026-01-01"}, ${title}, ${"registered"}, ${"registered"}, ${courtId})`;
  });
}

describe.skipIf(!RUN)("public case-status lookup (e2e — configurable OTP/captcha/open)", () => {
  beforeAll(async () => {
    subscribeConsumers();
    await queue.start();
    app = await buildApp();
    // publish each establishment with its access mode (fans out a config.set), then seed a case
    for (const e of Object.values(EST)) {
      await jpost("/v1/court/public-directory", { establishmentCode: e.code, courtName: e.slug, publicSlug: e.slug, accessMode: e.mode }, admTok(e.tenant));
    }
    // wait for directory rows + each tenant's access_mode config to land via the worker
    await waitFor(async () => ((await jget("/v1/public/establishments")).body.items as any[]).filter((x) => [EST.otp.slug, EST.cap.slug, EST.open.slug].includes(x.publicSlug)).length === 3);
    for (const e of [EST.cap, EST.open]) {
      await waitFor(async () => ((await jget(`/v1/court/config/public_lookup`, admTok(e.tenant))).body.items as any[])?.some((c) => c.configKey === "access_mode"));
    }
    await Promise.all([seedCase(T_OTP, EST.otp.cnr, "OTP Case"), seedCase(T_CAP, EST.cap.cnr, "Captcha Case"), seedCase(T_OPEN, EST.open.cnr, "Open Case")]);
  });

  afterAll(async () => {
    await queue.stop();
    for (const t of [T_OTP, T_CAP, T_OPEN]) {
      await sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${t}, true)`;
        await sql`delete from court.cases where tenant_id = ${t}`;
        await sql`delete from court.courts where tenant_id = ${t}`;
        await sql`delete from court.config_entries where tenant_id = ${t}`;
      });
      await sqlClient`delete from court.public_establishments where tenant_id = ${t}`;
    }
    await app.close();
    await sqlClient.end();
  });

  it("public directory lists courts with a shareable publicUrl and NO tenant_id", async () => {
    const r = await jget("/v1/public/establishments");
    expect(r.code).toBe(200);
    const item = (r.body.items as any[]).find((x) => x.publicSlug === EST.otp.slug);
    expect(item.publicUrl).toContain(`/case-status/${EST.otp.slug}`);
    expect(item.tenantId).toBeUndefined();
  });

  it("OTP mode: request OTP → verify → returns docket with NO PII", async () => {
    const otpRes = await jpost("/v1/public/case-status/otp", { mobile: mob() });
    expect(otpRes.code).toBe(200);
    const { challengeId, devOtp } = otpRes.body;
    const look = await jpost("/v1/public/case-status", { cnr: EST.otp.cnr, challengeId, otp: devOtp });
    expect(look.code).toBe(200);
    expect(look.body.accessMode).toBe("otp");
    expect(look.body.case.cnrNumber).toBe(EST.otp.cnr);
    // no party PII keys leaked
    for (const k of ["name", "phone", "email", "address", "tenantId", "parties"]) expect(look.body.case[k]).toBeUndefined();
  });

  it("OTP mode: missing OTP → 400, wrong OTP locks out after 5 tries, single-use", async () => {
    const miss = await jpost("/v1/public/case-status", { cnr: EST.otp.cnr });
    expect(miss.code).toBe(400); // OTP_REQUIRED

    const { challengeId, devOtp } = (await jpost("/v1/public/case-status/otp", { mobile: mob() })).body;
    for (let i = 0; i < 5; i++) {
      const wrong = await jpost("/v1/public/case-status", { cnr: EST.otp.cnr, challengeId, otp: "000000" });
      expect(wrong.code).toBe(401);
    }
    const locked = await jpost("/v1/public/case-status", { cnr: EST.otp.cnr, challengeId, otp: devOtp });
    expect(locked.code).toBe(429); // OTP_LOCKED even with the right OTP now

    // single-use: a fresh challenge, use it once, then reuse → invalid
    const c2 = (await jpost("/v1/public/case-status/otp", { mobile: mob() })).body;
    expect((await jpost("/v1/public/case-status", { cnr: EST.otp.cnr, challengeId: c2.challengeId, otp: c2.devOtp })).code).toBe(200);
    expect((await jpost("/v1/public/case-status", { cnr: EST.otp.cnr, challengeId: c2.challengeId, otp: c2.devOtp })).code).toBe(401);
  });

  it("captcha mode: needs a captcha token, no OTP", async () => {
    const noCaptcha = await jpost("/v1/public/case-status", { cnr: EST.cap.cnr });
    expect(noCaptcha.code).toBe(401); // CAPTCHA_INVALID
    const ok = await jpost("/v1/public/case-status", { cnr: EST.cap.cnr, captchaToken: "test-captcha-ok" });
    expect(ok.code).toBe(200);
    expect(ok.body.accessMode).toBe("captcha");
    expect(ok.body.case.cnrNumber).toBe(EST.cap.cnr);
  });

  it("open mode: no gate at all", async () => {
    const r = await jpost("/v1/public/case-status", { cnr: EST.open.cnr });
    expect(r.code).toBe(200);
    expect(r.body.accessMode).toBe("open");
    expect(r.body.case.cnrNumber).toBe(EST.open.cnr);
  });

  it("cross-tenant: an unknown CNR prefix resolves to no court (404)", async () => {
    const r = await jpost("/v1/public/case-status", { cnr: "ZZZZ990000002026", captchaToken: "test-captcha-ok" });
    expect(r.code).toBe(404); // COURT_NOT_FOUND — no directory entry
  });
});
