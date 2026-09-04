/**
 * restoration module — route -> consumer -> persisted-state lifecycle for
 * start/complete/refund, plus the quality<->decision consistency matrix and
 * the derived-not-client-supplied refund amount, and a direct proof that
 * repo.completeRestoration / repo.updateDepositRefund are real
 * compare-and-swaps. Also covers the refundMinor codec swap (restoration/
 * routes.ts now uses @civitasone/schemas' zMoneyMinorStringNonNeg instead of
 * a hand-rolled regex) — confirms the field still round-trips a decision as
 * a plain non-negative integer string all the way to the bigint column.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerRestorationConsumers } from "../src/modules/restoration/consumer.js";
import * as restorationRepo from "../src/modules/restoration/repo.js";
import { hdr, drainQueue, waitFor, USER_ROLES, ADMIN_ROLES, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerPermitConsumers(queue);
  registerRestorationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// arterial, area = 2*2 = 4 sqm -> depositMinor = 4 * 500000 = 2000000
const appBody = {
  applicantName: "Restoration Test Applicant",
  purpose: "gas_pipe" as const,
  location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
  roadType: "arterial" as const,
  cuttingLength: "2",
  cuttingWidth: "2",
  cuttingDepth: "1",
};
const DEPOSIT_MINOR = "2000000";

async function completedPermitId(): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
  const applicationId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
  await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/start-review`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "under_review");
  await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/approve`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "approved");

  const row = (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
  expect(String(row.depositMinor)).toBe(DEPOSIT_MINOR);

  const issue = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, workStartDate: "2027-01-10", workEndDate: "2027-02-10" } });
  const permitId = (issue.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/roadcut/permits/${permitId}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "completed");
  return permitId;
}

async function startedRestorationId(): Promise<string> {
  const permitId = await completedPermitId();
  const start = await app.inject({ method: "POST", url: "/v1/roadcut/restorations", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { permitId, startDate: "2027-02-11" } });
  const restorationId = (start.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/restorations/${restorationId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);
  return restorationId;
}

async function assessedRestorationId(quality: "satisfactory" | "unsatisfactory"): Promise<string> {
  const restorationId = await startedRestorationId();
  await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { quality, endDate: "2027-02-20" } });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/restorations/${restorationId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).json().data.quality === quality);
  return restorationId;
}

describe("restoration — start: pre-accept validation (permit existence -> completed -> not-already-started)", () => {
  it("rejects a non-existent permitId with 404", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/roadcut/restorations", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { permitId: randomUUID(), startDate: "2027-02-11" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PERMIT_NOT_FOUND");
  });

  it("rejects a permit whose work is not yet completed", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/start-review`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "under_review");
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/approve`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "approved");
    const issue = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, workStartDate: "2027-01-10", workEndDate: "2027-02-10" } });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    // Still "issued", never completed.
    const res = await app.inject({ method: "POST", url: "/v1/roadcut/restorations", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { permitId, startDate: "2027-02-11" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PERMIT_NOT_COMPLETED");
  });

  it("rejects starting a second restoration for the same permit", async () => {
    const permitId = await completedPermitId();
    const first = await app.inject({ method: "POST", url: "/v1/roadcut/restorations", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { permitId, startDate: "2027-02-11" } });
    expect(first.statusCode).toBe(202);
    const firstId = (first.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/restorations/${firstId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);

    const second = await app.inject({ method: "POST", url: "/v1/roadcut/restorations", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { permitId, startDate: "2027-02-12" } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("RESTORATION_ALREADY_EXISTS");
  });
});

describe("restoration — refund: quality gate and quality<->decision consistency", () => {
  it("rejects any refund decision before the restoration has been assessed (quality still 'pending')", async () => {
    const restorationId = await startedRestorationId();
    const res = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "full_refund" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("RESTORATION_NOT_ASSESSED");
  });

  it("rejects full_refund when quality was assessed unsatisfactory (BUG this fleet-wide review found and fixed: previously only checked the full_refund half)", async () => {
    const restorationId = await assessedRestorationId("unsatisfactory");
    const res = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "full_refund" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("QUALITY_MISMATCH");
  });

  it("rejects forfeited when quality was assessed satisfactory (the previously-unchecked half)", async () => {
    const restorationId = await assessedRestorationId("satisfactory");
    const res = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "forfeited" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("QUALITY_MISMATCH");
  });

  it("full_refund on a satisfactory restoration pays out the entire deposit, derived server-side", async () => {
    const restorationId = await assessedRestorationId("satisfactory");
    const refund = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "full_refund" } });
    expect(refund.statusCode).toBe(202);
    let row: { depositRefundStatus: string; refundMinor: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/roadcut/restorations/${restorationId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
      row = get.json().data;
      return row!.depositRefundStatus === "full_refund";
    });
    expect(String(row!.refundMinor)).toBe(DEPOSIT_MINOR);
  });

  it("forfeited on an unsatisfactory restoration pays out zero", async () => {
    const restorationId = await assessedRestorationId("unsatisfactory");
    const refund = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "forfeited" } });
    expect(refund.statusCode).toBe(202);
    let row: { depositRefundStatus: string; refundMinor: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/roadcut/restorations/${restorationId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
      row = get.json().data;
      return row!.depositRefundStatus === "forfeited";
    });
    expect(String(row!.refundMinor)).toBe("0");
  });

  it("partial_refund requires an explicit refundMinor strictly between 0 and the deposit", async () => {
    const restorationId1 = await assessedRestorationId("satisfactory");
    const missing = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId1}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "partial_refund" } });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe("REFUND_AMOUNT_REQUIRED");

    const restorationId2 = await assessedRestorationId("satisfactory");
    const tooHigh = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId2}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "partial_refund", refundMinor: DEPOSIT_MINOR } });
    expect(tooHigh.statusCode).toBe(422);
    expect(tooHigh.json().code).toBe("INVALID_PARTIAL_REFUND_AMOUNT");

    const restorationId3 = await assessedRestorationId("satisfactory");
    const zero = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId3}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "partial_refund", refundMinor: "0" } });
    expect(zero.statusCode).toBe(422);
    expect(zero.json().code).toBe("INVALID_PARTIAL_REFUND_AMOUNT");

    const restorationId4 = await assessedRestorationId("satisfactory");
    const ok = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId4}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "partial_refund", refundMinor: "500000" } });
    expect(ok.statusCode).toBe(202);
    let row: { depositRefundStatus: string; refundMinor: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/roadcut/restorations/${restorationId4}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
      row = get.json().data;
      return row!.depositRefundStatus === "partial_refund";
    });
    expect(String(row!.refundMinor)).toBe("500000");
  });

  it("refundMinor is rejected for full_refund/forfeited (amount is computed automatically, never client-supplied)", async () => {
    const restorationId = await assessedRestorationId("satisfactory");
    const res = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "full_refund", refundMinor: "1" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("REFUND_AMOUNT_NOT_APPLICABLE");
  });

  it("rejects a second refund decision once one has already been made (ALREADY_DECIDED)", async () => {
    const restorationId = await assessedRestorationId("satisfactory");
    await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "full_refund" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/restorations/${restorationId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).json().data.depositRefundStatus === "full_refund");
    const again = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "forfeited" } });
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("ALREADY_DECIDED");
  });
});

describe("restoration — refundMinor codec (@civitasone/schemas' zMoneyMinorStringNonNeg, swapped in from a hand-rolled regex)", () => {
  it("rejects a non-numeric refundMinor at the route, before it reaches the queue", async () => {
    const restorationId = await assessedRestorationId("satisfactory");
    const res = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "partial_refund", refundMinor: "abc" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a negative refundMinor at the route", async () => {
    const restorationId = await assessedRestorationId("satisfactory");
    const res = await app.inject({ method: "POST", url: `/v1/roadcut/restorations/${restorationId}/refund`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { decision: "partial_refund", refundMinor: "-100" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("restoration repo — completeRestoration / updateDepositRefund are real compare-and-swaps", () => {
  it("completeRestoration: a losing racer against a concurrent assessment is a no-op", async () => {
    const restorationId = await startedRestorationId();
    const row = await runWithTenant(TENANT_A, () => db.transaction((tx) => restorationRepo.findById(restorationId, TENANT_A)));
    expect(row!.quality).toBe("pending");

    const [satResult, unsatResult] = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => restorationRepo.completeRestoration(tx, restorationId, TENANT_A, "satisfactory", "2027-02-20", ACTOR_A))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => restorationRepo.completeRestoration(tx, restorationId, TENANT_A, "unsatisfactory", "2027-02-20", ACTOR_A))),
    ]);
    expect([satResult, unsatResult].filter(Boolean)).toHaveLength(1);
  });

  it("updateDepositRefund: a losing racer against a concurrent decision is a no-op", async () => {
    const restorationId = await assessedRestorationId("satisfactory");
    const [fullResult, partialResult] = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => restorationRepo.updateDepositRefund(tx, restorationId, TENANT_A, "full_refund", 2000000n, ACTOR_A))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => restorationRepo.updateDepositRefund(tx, restorationId, TENANT_A, "partial_refund", 500000n, ACTOR_A))),
    ]);
    expect([fullResult, partialResult].filter(Boolean)).toHaveLength(1);
  });
});
