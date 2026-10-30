/**
 * F72 (UAT W7) -- POST /v1/hrms/id-cards must reply within the gateway budget
 * even when the SQS-backed queue publish is slow.
 *
 * The card row is committed first; the audit-command and notification
 * publishes that follow are post-commit side effects. They used to be awaited
 * one after the other with no bound, so a slow broker (UAT LocalStack at
 * ~3.6 s per call) held the request open past the gateway's 15 s timeout and
 * the caller got a 504 for a card that had in fact been issued.
 */
import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const publish = vi.fn();

vi.mock("../../shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publish(...args) },
  cache: { get: async () => undefined, set: async () => undefined },
}));

vi.mock("../../shared/db.js", () => ({ sqlClient: {} }));

vi.mock("@civitasone/db", () => ({
  withRawTenantGuc: async (_sql: unknown, _tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      unsafe: async (text: string) => {
        if (text.includes("COUNT(*)")) return [{ seq: 1 }];
        if (text.includes("full_name")) return [{ full_name: "HR Admin" }];
        return Object.assign([], { count: 1 });
      },
    }),
}));

vi.mock("../../shared/context.js", () => {
  class HttpError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return {
    HttpError,
    resolveContext: () => ({
      tenantId: "11111111-0000-0000-0000-000000000001",
      actorId: "0a82f891-2b3c-43c3-af76-a5418f2c658f",
      correlationId: "f72-test",
      roles: ["hr_admin"],
    }),
    requireRole: () => undefined,
  };
});

vi.mock("../employee/actor-link.js", () => ({ resolveEmployeeForActor: async () => null }));

const ISSUE_BODY = {
  holderName: "F72 holder",
  cardType: "employee",
  validUntil: "2027-12-31",
  employeeId: "349dd3a6-4c0f-412c-a3f9-f5ee2cc044b8",
};

async function buildApp() {
  const { idCardRoutes } = await import("./routes.js");
  const app = Fastify();
  await app.register(idCardRoutes);
  await app.ready();
  return app;
}

/** Resolves to "timeout" if `p` has not settled within `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);
}

describe("F72 -- id-card writes do not hang on a slow queue publish", () => {
  beforeEach(() => {
    process.env.ID_CARD_PUBLISH_BUDGET_MS = "200";
    publish.mockReset();
  });
  afterEach(() => {
    delete process.env.ID_CARD_PUBLISH_BUDGET_MS;
  });

  it("POST /v1/hrms/id-cards replies 201 within the budget when the broker never answers", async () => {
    publish.mockImplementation(() => new Promise(() => undefined));
    const app = await buildApp();
    try {
      const res = await within(app.inject({ method: "POST", url: "/v1/hrms/id-cards", payload: ISSUE_BODY }), 2_000);
      expect(res).not.toBe("timeout");
      if (res === "timeout") return;
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: "active", cardNumber: expect.stringMatching(/^DIC\/\d{4}\/00001$/) });
      // Both side-effect publishes were still started (not dropped).
      expect(publish.mock.calls.map((c) => c[0])).toEqual(["hrms.id_card.issue", "notification.send"]);
    } finally {
      await app.close();
    }
  });

  it("starts the audit and notification publishes concurrently, not one after the other", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    publish.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return "id";
    });
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", payload: ISSUE_BODY });
      expect(res.statusCode).toBe(201);
      expect(maxInFlight).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("a publish that fails inside the budget still fails the request (no silent success)", async () => {
    publish.mockRejectedValue(new Error("broker down"));
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", payload: ISSUE_BODY });
      expect(res.statusCode).toBe(500);
    } finally {
      await app.close();
    }
  });

  it("PATCH /v1/hrms/id-cards/:id/reactivate replies 200 within the budget when the broker never answers", async () => {
    publish.mockImplementation(() => new Promise(() => undefined));
    const app = await buildApp();
    try {
      const res = await within(
        app.inject({ method: "PATCH", url: "/v1/hrms/id-cards/2f14d9d5-1f12-427a-aec8-83dc931752bf/reactivate", payload: {} }),
        2_000,
      );
      expect(res).not.toBe("timeout");
      if (res === "timeout") return;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: "2f14d9d5-1f12-427a-aec8-83dc931752bf", status: "active" });
    } finally {
      await app.close();
    }
  });
});
