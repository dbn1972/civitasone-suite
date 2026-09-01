/**
 * Candidate reservation-attributes + references + relationship-declaration routes,
 * incl. the draft-only lock.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000acc";
const USER = "aaaaaaaa-7777-4000-8000-000000000acc";
const CID = "dddddddd-cccc-4000-8000-00000000dacc";

const H = vi.hoisted(() => ({ findCandidate: vi.fn(), updateCandidateFields: vi.fn(), setReferences: vi.fn(), listReferences: vi.fn() }));

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
vi.mock("../src/modules/recruitment/reference-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  updateCandidateFields: (...a: unknown[]) => H.updateCandidateFields(...a),
  setReferences: (...a: unknown[]) => H.setReferences(...a),
  listReferences: (...a: unknown[]) => H.listReferences(...a),
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
const candidate = (over = {}) => ({ id: CID, tenantId: TENANT, email: "cand@x.in", mobile: "9990001111", status: "draft", ...over });
const twoRefs = [
  { name: "Ref One", relationship: "former manager", email: "r1@x.in" },
  { name: "Ref Two", relationship: "professor", phone: "9876543210" },
];

beforeEach(() => {
  vi.clearAllMocks();
  H.findCandidate.mockResolvedValue(candidate());
  H.updateCandidateFields.mockResolvedValue(undefined);
  H.setReferences.mockResolvedValue(undefined);
  H.listReferences.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("candidate reference/reservation routes", () => {
  it("sets reservation attributes with a certificate (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/reservation-attributes`, headers: auth, payload: { category: "OBC", reservationDocs: ["cert-1"] } });
    expect(r.statusCode).toBe(200);
    expect(H.updateCandidateFields).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a reserved-category claim without a certificate (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/reservation-attributes`, headers: auth, payload: { category: "SC" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_RESERVATION");
    await app.close();
  });

  it("rejects a disability claim missing type/percentage (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/reservation-attributes`, headers: auth, payload: { disability: true, reservationDocs: ["d"] } });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("sets two references (200) and rejects a single reference (422)", async () => {
    const app = await buildApp();
    const ok = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/references`, headers: auth, payload: { references: twoRefs } });
    expect(ok.statusCode).toBe(200);
    expect(H.setReferences).toHaveBeenCalledOnce();
    const bad = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/references`, headers: auth, payload: { references: [twoRefs[0]] } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("INVALID_REFERENCES");
    await app.close();
  });

  it("rejects a reference that is the candidate (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/references`, headers: auth, payload: { references: [
      { name: "Self", relationship: "self", email: "cand@x.in" },
      { name: "Ref Two", relationship: "professor", phone: "9876543210" },
    ] } });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("rejects an unknown reservation category (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/reservation-attributes`, headers: auth, payload: { category: "XX", reservationDocs: ["d"] } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_RESERVATION");
    await app.close();
  });

  it("normalises the persisted category to uppercase", async () => {
    const app = await buildApp();
    await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/reservation-attributes`, headers: auth, payload: { category: "obc", reservationDocs: ["c"] } });
    expect((H.updateCandidateFields.mock.calls[0][3] as { category: string }).category).toBe("OBC");
    await app.close();
  });

  it("records a prior-relationship declaration (200) and requires named relations (422)", async () => {
    const app = await buildApp();
    const ok = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/relationship-declaration`, headers: auth, payload: { hasPriorRelationship: true, relations: [{ personName: "Panelist X", nature: "former colleague" }] } });
    expect(ok.statusCode).toBe(200);
    const bad = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/relationship-declaration`, headers: auth, payload: { hasPriorRelationship: true } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("INVALID_DECLARATION");
    await app.close();
  });

  it("clears relations when hasPriorRelationship is false", async () => {
    const app = await buildApp();
    await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/relationship-declaration`, headers: auth, payload: { hasPriorRelationship: false, relations: [{ personName: "X", nature: "friend" }] } });
    const patch = H.updateCandidateFields.mock.calls[0][3] as { relationshipDeclaration: { relations: unknown[] } };
    expect(patch.relationshipDeclaration.relations).toEqual([]);
    await app.close();
  });

  it("locks edits after submission (409)", async () => {
    H.findCandidate.mockResolvedValue(candidate({ status: "submitted" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/candidates/${CID}/references`, headers: auth, payload: { references: twoRefs } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("LOCKED");
    await app.close();
  });
});
