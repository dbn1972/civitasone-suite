/**
 * DEF-RC-003 — OTP trigger/verify routes + submission gate.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0003-4000-8000-000000000003";
const USER = "aaaaaaaa-7777-4000-8000-000000000003";
const CID = "dddddddd-0003-4000-8000-00000000d003";

const H = vi.hoisted(() => ({
  findCandidate: vi.fn(), insertChallenge: vi.fn(), findLatestChallenge: vi.fn(),
  incrementAttempts: vi.fn(), markVerified: vi.fn(), updateCandidate: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => {
  // markProcessed() in the F3 consumer runs
  // insert(...).values(...).onConflictDoNothing().returning() on the tx, which a
  // bare {} cannot answer — the consumer threw before reaching any case.
  const stubTx = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ messageId: "stub" }] }) }) }) };
  return {
    ...(await io<Record<string, unknown>>()),
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(stubTx), insert: () => ({ values: async () => undefined }) },
  };
});
vi.mock("../src/modules/recruitment/candidate-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findCandidate: (...a: unknown[]) => H.findCandidate(...a),
  updateCandidate: (...a: unknown[]) => H.updateCandidate(...a),
}));
vi.mock("../src/modules/recruitment/otp-verify-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertChallenge: (...a: unknown[]) => H.insertChallenge(...a),
  findLatestChallenge: (...a: unknown[]) => H.findLatestChallenge(...a),
  incrementAttempts: (...a: unknown[]) => H.incrementAttempts(...a),
  markVerified: (...a: unknown[]) => H.markVerified(...a),
}));

import { buildApp } from "../src/app.js";

import { queue } from "../src/shared/infra.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";

// These routes only PUBLISH; the row is written by the recruitment F3 consumer
// that f3-leftover-register.ts wires into the worker. Register it here so the
// suite exercises the whole write path instead of the HTTP layer alone.
registerF3_recruitment_Consumers(queue);
/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
type TestApp = { inject: (opts: never) => Promise<never> };
/** inject() + drain, so an assertion never races the async F3 write. */
async function injectF3(app: TestApp, opts: unknown): Promise<never> {
  const res = await app.inject(opts as never);
  await drainF3();
  return res;
}

import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_OTP_VERIFICATION_ENABLED = "true";
  process.env.NODE_ENV = "test";
  H.findCandidate.mockResolvedValue({ id: CID, tenantId: TENANT, email: "c@x.in", status: "draft", emailVerified: false, version: 1 });
  H.insertChallenge.mockResolvedValue(undefined);
  H.findLatestChallenge.mockResolvedValue({ id: "ch-1", code: "123456", expiresAt: new Date(Date.now() + 60_000), attempts: 0, verified: false });
  H.incrementAttempts.mockResolvedValue(undefined);
  H.markVerified.mockResolvedValue(undefined);
  H.updateCandidate.mockResolvedValue(undefined);
});
afterAll(async () => { delete process.env.FEATURE_OTP_VERIFICATION_ENABLED; await sqlClient.end(); });

describe("OTP verification (DEF-RC-003)", () => {
  it("triggers an OTP (201, dev mode echoes code)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/otp/trigger`, headers: auth(), payload: { channel: "email" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().devCode).toHaveLength(6);
    expect(H.insertChallenge).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 501 when the feature is off", async () => {
    delete process.env.FEATURE_OTP_VERIFICATION_ENABLED;
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/otp/trigger`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(501);
    await app.close();
  });

  it("verifies a correct OTP (200 verified=true)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/otp/verify`, headers: auth(), payload: { code: "123456" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().verified).toBe(true);
    expect(H.markVerified).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a wrong OTP (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/otp/verify`, headers: auth(), payload: { code: "000000" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("OTP_INVALID");
    expect(H.incrementAttempts).toHaveBeenCalledOnce();
    await app.close();
  });

  it("candidate submit is blocked when email not verified (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/submit`, headers: auth(), payload: { consentVersion: "v1", consentAccepted: true } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("EMAIL_NOT_VERIFIED");
    await app.close();
  });

  it("candidate submit is allowed when email IS verified", async () => {
    H.findCandidate.mockResolvedValue({ id: CID, tenantId: TENANT, email: "c@x.in", status: "draft", emailVerified: true, version: 1 });
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/submit`, headers: auth(), payload: { consentVersion: "v1", consentAccepted: true } });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("candidate submit is allowed when feature is off (regardless of emailVerified)", async () => {
    delete process.env.FEATURE_OTP_VERIFICATION_ENABLED;
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/submit`, headers: auth(), payload: { consentVersion: "v1", consentAccepted: true } });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/candidates/${CID}/otp/trigger`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
