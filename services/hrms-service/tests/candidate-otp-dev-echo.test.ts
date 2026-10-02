/**
 * GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-03: the OTP is echoed back (devCode) only behind an explicit flag,
 * never merely because NODE_ENV is not "production" (staging / UAT).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  }),
}));
vi.mock("../src/shared/infra.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  queue: { publish: async () => undefined, send: async () => undefined },
}));
vi.mock("@civitasone/db", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  runWithTenant: async (_t: string, fn: () => unknown) => fn(),
}));

import { candidatePublicAuthRoutes, devOtpEchoEnabled } from "../src/modules/recruitment/candidate-public-auth-routes.js";

let seq = 0;
async function requestOtp(): Promise<Record<string, unknown>> {
  const app = Fastify();
  await app.register(candidatePublicAuthRoutes);
  const res = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { email: `a${++seq}@example.com`, tenantId: "aaaaaaaa-0003-4000-8000-00000000a003" } });
  await app.close();
  expect(res.statusCode).toBe(202);
  return res.json();
}

describe("devOtpEchoEnabled", () => {
  it("requires the explicit flag AND a non-production NODE_ENV", () => {
    expect(devOtpEchoEnabled({ NODE_ENV: "staging" })).toBe(false);
    expect(devOtpEchoEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devOtpEchoEnabled({ ALLOW_DEV_OTP_ECHO: "true", NODE_ENV: "staging" })).toBe(true);
    expect(devOtpEchoEnabled({ ALLOW_DEV_OTP_ECHO: "1", NODE_ENV: "staging" })).toBe(false);
    expect(devOtpEchoEnabled({ ALLOW_DEV_OTP_ECHO: "true", NODE_ENV: "production" })).toBe(false);
  });
});

describe("POST /v1/careers/auth/otp-request devCode", () => {
  const saved = { node: process.env.NODE_ENV, flag: process.env.ALLOW_DEV_OTP_ECHO };
  afterEach(() => {
    process.env.NODE_ENV = saved.node;
    if (saved.flag === undefined) delete process.env.ALLOW_DEV_OTP_ECHO; else process.env.ALLOW_DEV_OTP_ECHO = saved.flag;
  });

  it("omits devCode on a non-production deploy when the flag is unset", async () => {
    process.env.NODE_ENV = "staging";
    delete process.env.ALLOW_DEV_OTP_ECHO;
    expect(await requestOtp()).not.toHaveProperty("devCode");
  });

  it("includes devCode only when the flag is set in a non-production env", async () => {
    process.env.NODE_ENV = "staging";
    process.env.ALLOW_DEV_OTP_ECHO = "true";
    expect(await requestOtp()).toHaveProperty("devCode");
  });

  it("never includes devCode in production, even with the flag", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEV_OTP_ECHO = "true";
    expect(await requestOtp()).not.toHaveProperty("devCode");
  });
});

describe("per-email OTP request cooldown (L6)", () => {
  it("returns the same 429 for an unknown email on a rapid second request (no account enumeration)", async () => {
    const app = Fastify();
    await app.register(candidatePublicAuthRoutes);
    const payload = { email: "bomb-target@example.com", tenantId: "aaaaaaaa-0003-4000-8000-00000000a003" };
    const first = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload });
    const second = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe("OTP_COOLDOWN");
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    // a different email is unaffected
    const other = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { ...payload, email: "other@example.com" } });
    expect(other.statusCode).toBe(202);
    await app.close();
  });
});
