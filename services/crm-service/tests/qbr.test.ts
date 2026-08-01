/**
 * Quarterly business review tests (KA-005).
 * Covers scheduling, completion with outcomes, cancellation with a mandatory
 * reason, the upcoming window, and invalid-state guards.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000062";
const ACTOR = "cccccccc-3333-4000-8000-000000000062";
const ACCOUNT = "dddddddd-4444-4000-8000-000000000062";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000062";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-qbr" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.qbr_schedules WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function schedule(payload: Record<string, unknown>, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/crm/qbr", headers: headers(roles), payload });
  await app.close();
  return res;
}

describe("POST /v1/crm/qbr", () => {
  it("schedules a review → 201", async () => {
    const res = await schedule({
      accountId: ACCOUNT,
      quarter: "2026-Q1",
      scheduledAt: inDays(10),
      attendees: ["CFO", "Programme director"],
      agenda: ["Adoption review", "Renewal"],
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("scheduled");
    expect(res.json().data.quarter).toBe("2026-Q1");
  });

  it("rejects a duplicate account/quarter → 409", async () => {
    const res = await schedule({ accountId: ACCOUNT, quarter: "2026-Q1", scheduledAt: inDays(11) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("QBR_EXISTS");
  });

  it("rejects a malformed quarter → 400", async () => {
    const res = await schedule({ accountId: ACCOUNT, quarter: "Q1-2026", scheduledAt: inDays(10) });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-ISO scheduledAt → 400", async () => {
    const res = await schedule({ accountId: ACCOUNT, quarter: "2026-Q3", scheduledAt: "tomorrow" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/qbr",
      payload: { accountId: ACCOUNT, quarter: "2026-Q4", scheduledAt: inDays(5) },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const res = await schedule(
      { accountId: ACCOUNT, quarter: "2026-Q4", scheduledAt: inDays(5) },
      ["citizen"],
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/qbr", () => {
  it("returns the list envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/qbr", headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBeGreaterThanOrEqual(1);
  });

  it("filters by account, quarter and status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/qbr?accountId=${ACCOUNT}&quarter=2026-Q1&status=scheduled`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("rejects an unknown status filter → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/qbr?status=maybe", headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/qbr" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/crm/qbr/upcoming", () => {
  it("includes reviews inside the window and excludes later ones", async () => {
    await schedule({ accountId: ACCOUNT, quarter: "2027-Q2", scheduledAt: inDays(60) });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/qbr/upcoming?withinDays=30",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const quarters = res.json().data.map((r: { quarter: string }) => r.quarter);
    expect(quarters).toContain("2026-Q1");
    expect(quarters).not.toContain("2027-Q2");
  });

  it("rejects withinDays beyond a year → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/qbr/upcoming?withinDays=400",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/qbr/upcoming" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/qbr/:id/complete", () => {
  it("records outcomes → 200", async () => {
    const created = await schedule({ accountId: ACCOUNT, quarter: "2028-Q1", scheduledAt: inDays(2) });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/complete`,
      headers: headers(),
      payload: { outcomes: [{ topic: "Renewal", decision: "Committed for FY27" }] },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("completed");
    expect(res.json().data.version).toBe(2);
  });

  it("supports recording a no_show", async () => {
    const created = await schedule({ accountId: ACCOUNT, quarter: "2028-Q2", scheduledAt: inDays(2) });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/complete`,
      headers: headers(),
      payload: { outcomes: [{ topic: "Nobody attended" }], status: "no_show" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("no_show");
  });

  it("refuses to complete twice → 422", async () => {
    const created = await schedule({ accountId: ACCOUNT, quarter: "2028-Q3", scheduledAt: inDays(2) });
    const id = created.json().data.id;

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/complete`,
      headers: headers(),
      payload: { outcomes: [{ topic: "Done" }] },
    });
    const again = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/complete`,
      headers: headers(),
      payload: { outcomes: [{ topic: "Again" }] },
    });
    await app.close();

    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("INVALID_STATE");
  });

  it("rejects empty outcomes → 400", async () => {
    const created = await schedule({ accountId: ACCOUNT, quarter: "2028-Q4", scheduledAt: inDays(2) });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/complete`,
      headers: headers(),
      payload: { outcomes: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown QBR", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${NONEXIST}/complete`,
      headers: headers(),
      payload: { outcomes: [{ topic: "Ghost" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${NONEXIST}/complete`,
      payload: { outcomes: [{ topic: "No auth" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/qbr/:id/cancel", () => {
  it("cancels with a reason → 200", async () => {
    const created = await schedule({ accountId: ACCOUNT, quarter: "2029-Q1", scheduledAt: inDays(3) });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/cancel`,
      headers: headers(),
      payload: { reason: "Customer postponed to next quarter" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("cancelled");
  });

  it("requires a reason of 10+ chars → 400", async () => {
    const created = await schedule({ accountId: ACCOUNT, quarter: "2029-Q2", scheduledAt: inDays(3) });
    const id = created.json().data.id;

    const app = await buildApp();
    const short = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/cancel`,
      headers: headers(),
      payload: { reason: "busy" },
    });
    const missing = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/cancel`,
      headers: headers(),
      payload: {},
    });
    await app.close();

    expect(short.statusCode).toBe(400);
    expect(short.json().code).toBe("REASON_REQUIRED");
    expect(missing.statusCode).toBe(400);
  });

  it("refuses to cancel a completed review → 422", async () => {
    const created = await schedule({ accountId: ACCOUNT, quarter: "2029-Q3", scheduledAt: inDays(3) });
    const id = created.json().data.id;

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/complete`,
      headers: headers(),
      payload: { outcomes: [{ topic: "Held" }] },
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${id}/cancel`,
      headers: headers(),
      payload: { reason: "Trying to cancel a completed review" },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it("returns 404 for an unknown QBR", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${NONEXIST}/cancel`,
      headers: headers(),
      payload: { reason: "Ghost review cancellation" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/qbr/${NONEXIST}/cancel`,
      headers: headers(["citizen"]),
      payload: { reason: "Forbidden cancellation attempt" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
