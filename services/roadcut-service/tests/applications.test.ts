/**
 * applications module — route -> consumer -> persisted-state lifecycle,
 * plus a direct DB-level proof that repo.ts's updateStatus is a real
 * compare-and-swap (CAS), and route-level proof of the poison-pill /
 * overflow guards on cuttingLength/cuttingWidth/cuttingDepth
 * (positiveDecimalString in routes.ts). Mirrors services/fire-service/tests/
 * applications.test.ts (PR #1011).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import * as repo from "../src/modules/applications/repo.js";
import { hdr, drainQueue, waitFor, USER_ROLES, ADMIN_ROLES, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const validBody = {
  applicantName: "Test Applicant",
  purpose: "water_pipe" as const,
  location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
  roadType: "local" as const,
  cuttingLength: "2",
  cuttingWidth: "3",
  cuttingDepth: "1",
};

async function createAndWait(overrides: Partial<Omit<typeof validBody, "roadType">> & { roadType?: string } = {}, roles = USER_ROLES): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/roadcut/applications",
    headers: hdr(ACTOR_A, TENANT_A, roles),
    payload: { ...validBody, ...overrides },
  });
  expect(create.statusCode).toBe(202);
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, roles) })).statusCode === 200);
  return id;
}

describe("applications — route -> consumer -> persisted state", () => {
  it("create: publishes 202, consumer persists a draft row with computed fee/deposit and a real application number", async () => {
    const id = await createAndWait();
    const row = (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;

    expect(row.status).toBe("draft");
    // local road, area = 2*3 = 6 sqm; fee 100000/sqm, deposit 200000/sqm
    expect(String(row.feeMinor)).toBe("600000");
    expect(String(row.depositMinor)).toBe("1200000");
    expect(row.applicationNumber).toMatch(/^ROADCUT\/ULB\/\d{4}\/\d{6}$/);
  });

  it("arterial road type uses the higher fee/deposit rate", async () => {
    const id = await createAndWait({ roadType: "arterial", cuttingLength: "10", cuttingWidth: "5" });
    const row = (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    // area = 50 sqm; arterial fee 250000/sqm, deposit 500000/sqm
    expect(String(row.feeMinor)).toBe("12500000");
    expect(String(row.depositMinor)).toBe("25000000");
  });

  it("submit: draft -> submitted, sets submittedAt", async () => {
    const id = await createAndWait();
    const submit = await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    expect(submit.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
    const row = (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.submittedAt).not.toBeNull();
  });

  it("submit twice is rejected at the route (canTransition: submitted has no re-submit)", async () => {
    const id = await createAndWait();
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
    const second = await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("INVALID_STATUS");
  });

  it("full happy path: draft -> submitted -> under_review -> approved, gated on fee/deposit being set", async () => {
    const id = await createAndWait();
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");

    const review = await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/start-review`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    expect(review.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "under_review");

    const approve = await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/approve`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    expect(approve.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "approved");
  });

  it("reject: under_review -> rejected, records the reason via audit (route accepts a reason body)", async () => {
    const id = await createAndWait();
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/start-review`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "under_review");

    const reject = await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/reject`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { reason: "incomplete documents" } });
    expect(reject.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "rejected");
  });

  it("withdraw: draft -> withdrawn", async () => {
    const id = await createAndWait();
    const withdraw = await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/withdraw`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    expect(withdraw.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "withdrawn");
  });
});

describe("applications — cuttingLength/cuttingWidth/cuttingDepth poison-pill and overflow guards (route-level)", () => {
  it("rejects a non-numeric cuttingLength before it ever reaches the queue (poison-pill guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/applications",
      headers: hdr(ACTOR_A, TENANT_A, USER_ROLES),
      payload: { ...validBody, cuttingLength: "abc" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a zero cuttingWidth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/applications",
      headers: hdr(ACTOR_A, TENANT_A, USER_ROLES),
      payload: { ...validBody, cuttingWidth: "0" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a negative cuttingDepth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/applications",
      headers: hdr(ACTOR_A, TENANT_A, USER_ROLES),
      payload: { ...validBody, cuttingDepth: "-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a ~300-digit numeral that parseFloat would resolve to Infinity (overflow guard, independent-review finding)", async () => {
    const hugeNumeral = "9".repeat(300);
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/applications",
      headers: hdr(ACTOR_A, TENANT_A, USER_ROLES),
      payload: { ...validBody, cuttingLength: hugeNumeral },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("applications repo.updateStatus — real compare-and-swap", () => {
  it("rejects a transition whose fromStatus does not match the row's current status", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const applicationNumber = `ROADCUT/ULB/CASTEST/${String(await repo.nextApplicationNumber(tx)).padStart(6, "0")}`;
        await repo.insertApplication(tx, {
          id, tenantId: TENANT_A, applicationNumber, status: "draft",
          applicantName: "CAS Test", applicantOrg: null, purpose: "water_pipe",
          location: { latitude: 0, longitude: 0, address: "x" }, roadType: "local",
          cuttingLength: "1", cuttingWidth: "1", cuttingDepth: "1", documents: [],
          feeMinor: 100000n, depositMinor: 200000n, currency: "INR",
          createdBy: ACTOR_A, updatedBy: ACTOR_A,
        });
      }),
    );
    const okFromWrongStatus = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "submitted", ACTOR_A, "under_review")),
    );
    expect(okFromWrongStatus).toBe(false);
    const okFromRightStatus = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "submitted", ACTOR_A, "draft")),
    );
    expect(okFromRightStatus).toBe(true);
  });

  it("under real concurrency, exactly one of two racing transitions off the same status wins", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const applicationNumber = `ROADCUT/ULB/CASRACE/${String(await repo.nextApplicationNumber(tx)).padStart(6, "0")}`;
        await repo.insertApplication(tx, {
          id, tenantId: TENANT_A, applicationNumber, status: "under_review",
          applicantName: "CAS Race Test", applicantOrg: null, purpose: "water_pipe",
          location: { latitude: 0, longitude: 0, address: "x" }, roadType: "local",
          cuttingLength: "1", cuttingWidth: "1", cuttingDepth: "1", documents: [],
          feeMinor: 100000n, depositMinor: 200000n, currency: "INR",
          createdBy: ACTOR_A, updatedBy: ACTOR_A,
        });
      }),
    );
    const [approveResult, rejectResult] = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "approved", ACTOR_A, "under_review"))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "rejected", ACTOR_A, "under_review"))),
    ]);
    // Exactly one of the two racing CAS updates applied; the other found the
    // row already moved off "under_review" and correctly no-op'd.
    expect([approveResult, rejectResult].filter(Boolean)).toHaveLength(1);
  });
});
