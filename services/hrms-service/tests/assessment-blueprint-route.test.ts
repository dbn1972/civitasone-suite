/**
 * Assessment blueprint & question-bank route wiring — create, segregation-of-duties
 * activation/validation, invalid-scoring rejection, and audit trail.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-000000000a22";
const AUTHOR = "aaaaaaaa-8888-4000-8000-000000000a22";
const OTHER  = "aaaaaaaa-9999-4000-8000-000000000a22";
const BP  = "bbbbbbbb-2222-4000-8000-00000000b022";
const QN  = "cccccccc-2222-4000-8000-00000000c022";

const H = vi.hoisted(() => ({
  findBlueprint: vi.fn(),
  insertBlueprint: vi.fn(),
  updateBlueprint: vi.fn(),
  listBlueprints: vi.fn(),
  findQuestion: vi.fn(),
  insertQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  listQuestions: vi.fn(),
  insertEvent: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/blueprint-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findBlueprint: (...a: unknown[]) => H.findBlueprint(...a),
  insertBlueprint: (...a: unknown[]) => H.insertBlueprint(...a),
  updateBlueprint: (...a: unknown[]) => H.updateBlueprint(...a),
  listBlueprints: (...a: unknown[]) => H.listBlueprints(...a),
  findQuestion: (...a: unknown[]) => H.findQuestion(...a),
  insertQuestion: (...a: unknown[]) => H.insertQuestion(...a),
  updateQuestion: (...a: unknown[]) => H.updateQuestion(...a),
  listQuestions: (...a: unknown[]) => H.listQuestions(...a),
  insertEvent: (...a: unknown[]) => H.insertEvent(...a),
  listEvents: (...a: unknown[]) => H.listEvents(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (sub: string) => `Bearer ${signToken({ sub, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}`;
const authAuthor = { authorization: tok(AUTHOR) };
const authOther = { authorization: tok(OTHER) };

const goodConfig = {
  totalCutoffPct: 40,
  sections: [{ key: "apt", questionCount: 2, marksPerQuestion: 5 }],
  tieBreak: ["higher_total"],
};
const blueprint = (over = {}) => ({
  id: BP, tenantId: TENANT, code: "ASMT-1", title: "Officer Test", roleTitle: null, designationId: null,
  competencies: [{ key: "c1" }], allowedTypes: ["mcq"], durationMinutes: 60, scoringConfig: goodConfig,
  status: "draft", version: 1, createdBy: AUTHOR, ...over,
});
const question = (over = {}) => ({
  id: QN, tenantId: TENANT, topic: "math", qtype: "mcq", stem: "2+2?",
  options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], answerKey: { correct: ["b"] },
  difficulty: "easy", marks: 1, status: "draft", version: 1, createdBy: AUTHOR, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.insertBlueprint.mockResolvedValue(undefined);
  H.updateBlueprint.mockResolvedValue(undefined);
  H.insertQuestion.mockResolvedValue(undefined);
  H.updateQuestion.mockResolvedValue(undefined);
  H.insertEvent.mockResolvedValue(undefined);
  H.listEvents.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("assessment blueprint routes", () => {
  it("creates a draft blueprint (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/assessments/blueprints", headers: authAuthor,
      payload: { code: "ASMT-1", title: "Officer Test", competencies: [{ key: "c1" }], allowedTypes: ["mcq"], durationMinutes: 60, scoringConfig: goodConfig } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("draft");
    expect(H.insertBlueprint).toHaveBeenCalledOnce();
    expect(H.insertEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks the author from activating their own blueprint (403 SoD)", async () => {
    H.findBlueprint.mockResolvedValue(blueprint());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/blueprints/${BP}/activate`, headers: authAuthor, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateBlueprint).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects activation of an invalid scoring config (422)", async () => {
    H.findBlueprint.mockResolvedValue(blueprint({ scoringConfig: { sections: [] } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/blueprints/${BP}/activate`, headers: authOther, payload: {} });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_BLUEPRINT");
    expect(H.updateBlueprint).not.toHaveBeenCalled();
    await app.close();
  });

  it("activates a valid blueprint by a different authorised user (200)", async () => {
    H.findBlueprint.mockResolvedValue(blueprint());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/blueprints/${BP}/activate`, headers: authOther, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("active");
    expect(H.updateBlueprint).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks the LAST EDITOR (not just the creator) from activating (403 SoD)", async () => {
    // Author=AUTHOR created it, but OTHER edited it last (updatedBy=OTHER).
    // OTHER must not be able to activate their own edit.
    H.findBlueprint.mockResolvedValue(blueprint({ updatedBy: OTHER }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/blueprints/${BP}/activate`, headers: authOther, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateBlueprint).not.toHaveBeenCalled();
    await app.close();
  });

  it("records the changed field set in the update audit event", async () => {
    H.findBlueprint.mockResolvedValue(blueprint());
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/assessments/blueprints/${BP}`, headers: authOther, payload: { title: "New", durationMinutes: 45 } });
    expect(r.statusCode).toBe(200);
    // insertEvent(tx, ev) — the event object is the SECOND argument.
    const ev = H.insertEvent.mock.calls.find((c) => (c[1] as { action: string })?.action === "update")?.[1] as { detail: { changedFields: string[] } };
    expect(ev.detail.changedFields).toEqual(expect.arrayContaining(["title", "durationMinutes"]));
    expect(ev.detail.changedFields).not.toContain("updatedBy");
    await app.close();
  });

  it("refuses to edit an active blueprint (409)", async () => {
    H.findBlueprint.mockResolvedValue(blueprint({ status: "active" }));
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/assessments/blueprints/${BP}`, headers: authOther, payload: { title: "New" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("BLUEPRINT_ACTIVE");
    await app.close();
  });

  it("creates a draft question (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/assessments/questions", headers: authAuthor,
      payload: { topic: "math", qtype: "mcq", stem: "2+2?", options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], answerKey: { correct: ["b"] }, difficulty: "easy", marks: 1 } });
    expect(r.statusCode).toBe(201);
    expect(H.insertQuestion).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks the author from validating their own question (403 SoD)", async () => {
    H.findQuestion.mockResolvedValue(question());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/questions/${QN}/validate`, headers: authAuthor, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateQuestion).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks the LAST EDITOR from validating a question (403 SoD)", async () => {
    H.findQuestion.mockResolvedValue(question({ updatedBy: OTHER }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/questions/${QN}/validate`, headers: authOther, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateQuestion).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects validation of an incomplete question (422)", async () => {
    H.findQuestion.mockResolvedValue(question({ answerKey: { correct: [] } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/questions/${QN}/validate`, headers: authOther, payload: {} });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INCOMPLETE_QUESTION");
    await app.close();
  });

  it("validates a complete question by a different authorised user (200)", async () => {
    H.findQuestion.mockResolvedValue(question());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/questions/${QN}/validate`, headers: authOther, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("validated");
    expect(H.updateQuestion).toHaveBeenCalledOnce();
    await app.close();
  });

  it("refuses to edit a validated question (409)", async () => {
    H.findQuestion.mockResolvedValue(question({ status: "validated" }));
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/assessments/questions/${QN}`, headers: authOther, payload: { stem: "changed" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("QUESTION_LOCKED");
    await app.close();
  });
});
