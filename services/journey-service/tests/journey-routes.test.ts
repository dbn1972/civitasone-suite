/**
 * Journey service route-level tests — journeys, steps, triggers, executions.
 * CQRS: mutations return 202 Accepted and publish a command to the queue;
 * the consumer (not exercised here) applies the write.
 * Happy paths + 400/401/403/404/409/422.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const JOURNEY_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const TRIGGER_ID = "cccccccc-1111-4000-8000-000000000001";
const EXECUTION_ID = "dddddddd-1111-4000-8000-000000000001";
const PROFILE_ID = "eeeeeeee-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  scopedReadMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  journeyFindByIdMock: vi.fn(),
  journeyListMock: vi.fn(),
  triggerFindByIdMock: vi.fn(),
  triggerListMock: vi.fn(),
  stepListByJourneyMock: vi.fn(),
  execFindByIdMock: vi.fn(),
  execListMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/journeys/repo.js", () => ({
  findById: (...a: unknown[]) => H.journeyFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.journeyListMock(...a),
  insert: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/triggers/repo.js", () => ({
  findById: (...a: unknown[]) => H.triggerFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.triggerListMock(...a),
  insert: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/steps/repo.js", () => ({
  findById: vi.fn(),
  listByJourney: (...a: unknown[]) => H.stepListByJourneyMock(...a),
  insert: vi.fn(),
  updateStatus: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/executions/repo.js", () => ({
  findById: (...a: unknown[]) => H.execFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.execListMock(...a),
  insert: vi.fn(),
  updateStatus: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["journey_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["journey_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function makeJourney(overrides: Record<string, unknown> = {}) {
  return {
    id: JOURNEY_ID, tenantId: TENANT, name: "Welcome Journey",
    status: "draft", triggerConfig: null,
    steps: [{ type: "send_notification", config: {} }],
    version: 1, createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

function makeTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIGGER_ID, tenantId: TENANT, journeyId: JOURNEY_ID,
    triggerType: "event_based", config: { eventName: "user.signup" },
    status: "active", version: 1,
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: EXECUTION_ID, tenantId: TENANT, journeyId: JOURNEY_ID,
    profileId: PROFILE_ID, status: "enrolled", currentStepIndex: 0,
    enrolledAt: new Date(), completedAt: null, version: 1,
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue(undefined);
});

// ── JOURNEYS ──────────────────────────────────────────────────────────────────

describe("POST /v1/journeys (create)", () => {
  it("202 — accepts journey creation", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys",
      headers: auth(), payload: { name: "Onboarding Flow", steps: [{ type: "wait" }] },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(r.json().id).toBeDefined();
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.journey.create");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys",
      payload: { name: "Test" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys",
      headers: auth(USER, ["viewer"]),
      payload: { name: "Test" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/journeys (list)", () => {
  it("200 — returns paginated list", async () => {
    H.journeyListMock.mockResolvedValue({ rows: [makeJourney()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/journeys?limit=10&offset=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/journeys" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/journeys/:id (get single)", () => {
  it("200 — returns the journey", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeJourney());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(JOURNEY_ID);
    await app.close();
  });

  it("404 — journey not found", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /v1/journeys/:id (update)", () => {
  it("202 — accepts a draft journey update", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(), payload: { name: "Updated Name", version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.journey.update");
    await app.close();
  });

  it("404 — journey not found", async () => {
    H.journeyFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(), payload: { name: "X", version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — cannot edit non-draft journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ status: "active" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(), payload: { name: "X", version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(), payload: { name: "X", version: 1 },
    });
    expect(r.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("POST /v1/journeys/:id/activate", () => {
  it("202 — accepts activation of a draft journey with steps", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/journeys/${JOURNEY_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.journey.activate");
    await app.close();
  });

  it("404 — journey not found", async () => {
    H.journeyFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/journeys/${JOURNEY_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — cannot activate an archived journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ status: "archived" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/journeys/${JOURNEY_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — cannot activate journey without steps", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ steps: [] }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/journeys/${JOURNEY_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});

describe("POST /v1/journeys/:id/pause", () => {
  it("202 — accepts pausing an active journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ status: "active" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/journeys/${JOURNEY_ID}/pause`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.journey.pause");
    await app.close();
  });

  it("422 — cannot pause a draft journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/journeys/${JOURNEY_ID}/pause`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});

describe("DELETE /v1/journeys/:id (archive)", () => {
  it("202 — accepts archiving a draft journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney());
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.journey.delete");
    await app.close();
  });

  it("404 — journey not found", async () => {
    H.journeyFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/journeys/${JOURNEY_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ── TRIGGERS ──────────────────────────────────────────────────────────────────

describe("POST /v1/journeys/triggers (create)", () => {
  it("202 — accepts trigger creation", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/triggers",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, triggerType: "event_based", config: { eventName: "user.signup" } },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.trigger.create");
    await app.close();
  });

  it("400 — invalid trigger config", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/triggers",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, triggerType: "event_based", config: {} },
    });
    expect(r.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/triggers",
      payload: { journeyId: JOURNEY_ID, triggerType: "event_based", config: { eventName: "x" } },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/journeys/triggers (list)", () => {
  it("200 — returns paginated list", async () => {
    H.triggerListMock.mockResolvedValue({ rows: [makeTrigger()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/journeys/triggers",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });
});

describe("GET /v1/journeys/triggers/:id (get)", () => {
  it("200 — returns trigger", async () => {
    H.triggerFindByIdMock.mockResolvedValue(makeTrigger());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/triggers/${TRIGGER_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("404 — trigger not found", async () => {
    H.triggerFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/triggers/${TRIGGER_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /v1/journeys/triggers/:id (update)", () => {
  it("202 — accepts trigger update", async () => {
    H.triggerFindByIdMock.mockResolvedValue(makeTrigger());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/journeys/triggers/${TRIGGER_ID}`,
      headers: auth(),
      payload: { status: "paused", version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.trigger.update");
    await app.close();
  });

  it("404 — trigger not found", async () => {
    H.triggerFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/journeys/triggers/${TRIGGER_ID}`,
      headers: auth(),
      payload: { status: "paused", version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.triggerFindByIdMock.mockResolvedValue(makeTrigger({ version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/journeys/triggers/${TRIGGER_ID}`,
      headers: auth(),
      payload: { status: "paused", version: 1 },
    });
    expect(r.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("DELETE /v1/journeys/triggers/:id (soft-delete)", () => {
  it("202 — accepts trigger soft-delete", async () => {
    H.triggerFindByIdMock.mockResolvedValue(makeTrigger());
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/journeys/triggers/${TRIGGER_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.trigger.delete");
    await app.close();
  });

  it("404 — trigger not found", async () => {
    H.triggerFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/journeys/triggers/${TRIGGER_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ── STEPS ─────────────────────────────────────────────────────────────────────

describe("GET /v1/journeys/:id/steps (list step executions)", () => {
  it("200 — returns step executions for a journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney());
    H.stepListByJourneyMock.mockResolvedValue({ rows: [], total: 0 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/${JOURNEY_ID}/steps`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta.total).toBe(0);
    await app.close();
  });

  it("404 — journey not found", async () => {
    H.journeyFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/${JOURNEY_ID}/steps`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /v1/journeys/steps/execute (execute step)", () => {
  it("202 — accepts step execution", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ steps: [{ type: "send_notification" }, { type: "wait" }] }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/steps/execute",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, profileId: PROFILE_ID, stepIndex: 0, stepType: "send_notification" },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.step.execute");
    await app.close();
  });

  it("400 — invalid step type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/steps/execute",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, profileId: PROFILE_ID, stepIndex: 0, stepType: "invalid_type" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — journey not found", async () => {
    H.journeyFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/steps/execute",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, profileId: PROFILE_ID, stepIndex: 0, stepType: "wait" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ── EXECUTIONS ────────────────────────────────────────────────────────────────

describe("GET /v1/journeys/executions (list)", () => {
  it("200 — returns paginated executions", async () => {
    H.execListMock.mockResolvedValue({ rows: [makeExecution()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/journeys/executions",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/journeys/executions" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/journeys/executions/:id (get single)", () => {
  it("200 — returns execution", async () => {
    H.execFindByIdMock.mockResolvedValue(makeExecution());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/executions/${EXECUTION_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("404 — not found", async () => {
    H.execFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/journeys/executions/${EXECUTION_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /v1/journeys/executions/enroll (enroll profile)", () => {
  it("202 — accepts enrollment of a profile in an active journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ status: "active" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/executions/enroll",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, profileId: PROFILE_ID },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("journey.execution.enroll");
    await app.close();
  });

  it("404 — journey not found", async () => {
    H.journeyFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/executions/enroll",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, profileId: PROFILE_ID },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — cannot enroll in non-active journey", async () => {
    H.journeyFindByIdMock.mockResolvedValue(makeJourney({ status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/journeys/executions/enroll",
      headers: auth(),
      payload: { journeyId: JOURNEY_ID, profileId: PROFILE_ID },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});
