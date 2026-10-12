/**
 * applyPosting — HTTP route authz / validation / flag tests
 * (SmartTransfer OS, ST-M01-09; house rule 9).
 *
 * POST /v1/hrms/workforce-core/postings/apply is the only new authz surface of
 * ST-M01-09. Proven here through the real buildApp() + app.inject() stack:
 *   1. 403 for citizen / employee / hr_officer (staff-only, HR admin only).
 *   2. 202 for hr_admin (and super_admin) with the ORDER-derived messageId on
 *      the published `hrms.posting.apply` command.
 *   3. 400 VALIDATION_FAILED for a bad body (and nothing published).
 *   4. Flag off: the route is not mounted (404); if reached while the flag has
 *      been switched off after mounting it answers 503 FEATURE_DISABLED.
 * queue.publish is spied (no consumer side effects) — the write path itself is
 * covered by apply-posting-real-db.test.ts.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { signToken, idempotentId } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

// Flag ON before app.ts evaluates isPostingLedgerEnabled() at buildApp().
process.env.WORKFORCE_CORE_LEDGER_ENABLED = "true";

const { buildApp } = await import("../../../app.js");
const { sqlClient } = await import("../../../shared/db.js");
const { queue } = await import("../../../shared/infra.js");
const { COMMANDS } = await import("../../../topics.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const URL = "/v1/hrms/workforce-core/postings/apply";

function auth(roles: string[]): { authorization: string } {
  return {
    authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "sess-apply-posting-route" }, SECRET, 3600)}`,
  };
}

function body() {
  return {
    orderId: randomUUID(),
    employeeId: randomUUID(),
    postId: randomUUID(),
    effectiveDate: "2027-01-10",
    orderNumber: "ORD/ROUTE/1",
  };
}

let app: FastifyInstance;
const publish = vi.spyOn(queue, "publish");

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

beforeEach(() => {
  publish.mockReset();
  publish.mockResolvedValue(undefined as never);
  process.env.WORKFORCE_CORE_LEDGER_ENABLED = "true";
});

describe("POST /v1/hrms/workforce-core/postings/apply — authz", () => {
  for (const role of ["citizen", "employee", "hr_officer"]) {
    it(`${role} is refused with 403 and nothing is published`, async () => {
      const r = await app.inject({
        method: "POST",
        url: URL,
        headers: auth([role]),
        payload: body(),
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().code).toBe("FORBIDDEN");
      expect(publish).not.toHaveBeenCalled();
    });
  }

  it("an unauthenticated caller is refused (401) and nothing is published", async () => {
    const r = await app.inject({ method: "POST", url: URL, payload: body() });
    expect(r.statusCode).toBe(401);
    expect(publish).not.toHaveBeenCalled();
  });

  for (const role of ["hr_admin", "super_admin"]) {
    it(`${role} gets 202 and the command carries the order-derived messageId`, async () => {
      const b = body();
      const r = await app.inject({
        method: "POST",
        url: URL,
        headers: auth([role]),
        payload: b,
      });
      expect(r.statusCode).toBe(202);
      expect(r.json().id).toBe(b.orderId);
      expect(r.json().status).toBe("accepted");
      expect(publish).toHaveBeenCalledTimes(1);
      const [topic, msg] = publish.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(topic).toBe(COMMANDS.postingApply);
      expect(msg.messageId).toBe(
        idempotentId({
          idempotencyKey: `posting.apply:${b.orderId}`,
          tenantId: TENANT,
        }),
      );
      expect(msg.tenantId).toBe(TENANT);
      const p = msg.payload as Record<string, unknown>;
      expect(p.orderId).toBe(b.orderId);
      expect(p.chargeType).toBe("substantive");
    });
  }

  it("a client x-idempotency-key does not change the messageId", async () => {
    const b = body();
    await app.inject({
      method: "POST",
      url: URL,
      headers: { ...auth(["hr_admin"]), "x-idempotency-key": "client-key-1" },
      payload: b,
    });
    await app.inject({
      method: "POST",
      url: URL,
      headers: { ...auth(["hr_admin"]), "x-idempotency-key": "client-key-2" },
      payload: b,
    });
    const ids = publish.mock.calls.map(
      (c) => (c[1] as { messageId: string }).messageId,
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe("POST /v1/hrms/workforce-core/postings/apply — validation", () => {
  it("a non-UUID orderId is 400 VALIDATION_FAILED", async () => {
    const r = await app.inject({
      method: "POST",
      url: URL,
      headers: auth(["hr_admin"]),
      payload: { ...body(), orderId: "not-a-uuid" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    expect(publish).not.toHaveBeenCalled();
  });

  it("an impossible calendar date is 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: URL,
      headers: auth(["hr_admin"]),
      payload: { ...body(), effectiveDate: "2027-09-31" },
    });
    expect(r.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("an unknown chargeType is 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: URL,
      headers: auth(["hr_admin"]),
      payload: { ...body(), chargeType: "bogus" },
    });
    expect(r.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("an empty body is 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: URL,
      headers: auth(["hr_admin"]),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("POST /v1/hrms/workforce-core/postings/apply — feature flag", () => {
  it("flag switched off after mount: 503 FEATURE_DISABLED, nothing published", async () => {
    process.env.WORKFORCE_CORE_LEDGER_ENABLED = "false";
    const r = await app.inject({
      method: "POST",
      url: URL,
      headers: auth(["hr_admin"]),
      payload: body(),
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe("FEATURE_DISABLED");
    expect(publish).not.toHaveBeenCalled();
  });

  it("flag off at boot: the route is not mounted (404)", async () => {
    process.env.WORKFORCE_CORE_LEDGER_ENABLED = "false";
    const off = await buildApp();
    try {
      const r = await off.inject({
        method: "POST",
        url: URL,
        headers: auth(["hr_admin"]),
        payload: body(),
      });
      expect(r.statusCode).toBe(404);
      expect(publish).not.toHaveBeenCalled();
    } finally {
      await off.close();
    }
  });
});
