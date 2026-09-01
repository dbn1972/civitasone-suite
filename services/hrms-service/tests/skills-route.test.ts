/**
 * Candidate professional-profile routes — skills/certifications/languages/
 * credentials PUTs (+ validation) and the draft-only lock.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-dddd-4000-8000-000000000add";
const USER = "aaaaaaaa-7777-4000-8000-000000000add";
const CID = "dddddddd-dddd-4000-8000-00000000dadd";

const H = vi.hoisted(() => ({
  findCandidate: vi.fn(), setSkills: vi.fn(), setCertifications: vi.fn(), setLanguages: vi.fn(), setCredentials: vi.fn(),
  listSkills: vi.fn(), listCertifications: vi.fn(), listLanguages: vi.fn(), listCredentials: vi.fn(),
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
}));
vi.mock("../src/modules/recruitment/skills-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  setSkills: (...a: unknown[]) => H.setSkills(...a),
  setCertifications: (...a: unknown[]) => H.setCertifications(...a),
  setLanguages: (...a: unknown[]) => H.setLanguages(...a),
  setCredentials: (...a: unknown[]) => H.setCredentials(...a),
  listSkills: (...a: unknown[]) => H.listSkills(...a),
  listCertifications: (...a: unknown[]) => H.listCertifications(...a),
  listLanguages: (...a: unknown[]) => H.listLanguages(...a),
  listCredentials: (...a: unknown[]) => H.listCredentials(...a),
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

const auth = { authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const candidate = (over = {}) => ({ id: CID, tenantId: TENANT, status: "draft", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findCandidate.mockResolvedValue(candidate());
  for (const k of ["setSkills", "setCertifications", "setLanguages", "setCredentials"] as const) H[k].mockResolvedValue(undefined);
  for (const k of ["listSkills", "listCertifications", "listLanguages", "listCredentials"] as const) H[k].mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("candidate professional-profile routes", () => {
  it("sets skills (200) and rejects bad proficiency (422)", async () => {
    const app = await buildApp();
    const ok = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/skills`, headers: auth, payload: { skills: [{ skill: "SQL", proficiency: "expert", yearsExperience: 6 }] } });
    expect(ok.statusCode).toBe(200);
    expect(H.setSkills).toHaveBeenCalledOnce();
    const bad = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/skills`, headers: auth, payload: { skills: [{ skill: "SQL", proficiency: "guru" }] } });
    expect(bad.statusCode).toBe(400); // zod enum rejects
    await app.close();
  });

  it("rejects a certification whose expiry precedes issue (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/certifications`, headers: auth, payload: { certifications: [{ name: "PMP", issuer: "PMI", issueDate: "2022-01-01", expiryDate: "2021-01-01" }] } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_CERTIFICATIONS");
    await app.close();
  });

  it("rejects a language with no read/write/speak (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/languages`, headers: auth, payload: { languages: [{ language: "Hindi" }] } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_LANGUAGES");
    await app.close();
  });

  it("sets credentials (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/credentials`, headers: auth, payload: { credentials: [{ kind: "patent", title: "A novel method", year: 2021 }] } });
    expect(r.statusCode).toBe(200);
    expect(H.setCredentials).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns the professional profile (200)", async () => {
    H.listSkills.mockResolvedValue([{ skill: "SQL" }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/candidates/${CID}/professional-profile`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().skills).toHaveLength(1);
    expect(r.json()).toHaveProperty("certifications");
    expect(r.json()).toHaveProperty("languages");
    expect(r.json()).toHaveProperty("credentials");
    await app.close();
  });

  it("locks edits after submission (409)", async () => {
    H.findCandidate.mockResolvedValue(candidate({ status: "submitted" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/skills`, headers: auth, payload: { skills: [{ skill: "SQL", proficiency: "expert" }] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("LOCKED");
    await app.close();
  });
});
