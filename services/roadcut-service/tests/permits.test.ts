/**
 * permits module — route -> consumer -> persisted-state lifecycle, plus a
 * dedicated proof of the pre-accept validation chain in permits/routes.ts's
 * POST /v1/roadcut/permits (existence -> status -> agreement/fee-set ->
 * duplicate -> date-range), the pattern the earlier fleet-wide hardening
 * audit named as roadcut-service's reference implementation (cited by
 * building-service, advertisement-service and others). Each stage is
 * exercised independently so a regression narrowing any single check would
 * fail its own test, not just the aggregate happy path.
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
import * as appRepo from "../src/modules/applications/repo.js";
import * as permitRepo from "../src/modules/permits/repo.js";
import { hdr, drainQueue, waitFor, USER_ROLES, ADMIN_ROLES, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerPermitConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const appBody = {
  applicantName: "Permit Test Applicant",
  purpose: "water_pipe" as const,
  location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
  roadType: "local" as const,
  cuttingLength: "2",
  cuttingWidth: "3",
  cuttingDepth: "1",
};

/** Drives a fresh application all the way to "approved" (fee/deposit set by canApprove's own gate). */
async function approvedApplicationId(): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
  await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/start-review`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "under_review");
  await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/approve`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "approved");
  return id;
}

const validPermitDates = { workStartDate: "2027-01-10", workEndDate: "2027-02-10" };

describe("permits — pre-accept validation chain (existence -> status -> agreement -> duplicate -> date-range)", () => {
  it("stage 1, existence: issuing against a non-existent applicationId is rejected with 404, before any command is queued", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/permits",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { applicationId: randomUUID(), ...validPermitDates },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("APPLICATION_NOT_FOUND");
  });

  it("stage 2, status: issuing against a real application still in 'draft' is rejected with 422 APPLICATION_NOT_APPROVED", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/permits",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { applicationId, ...validPermitDates },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("APPLICATION_NOT_APPROVED");
  });

  it("stage 3, agreement: an 'approved' application with fee/deposit not actually calculated is rejected with 422 FEE_NOT_SET — isolates this check from stage 2, since the live approve endpoint's own canApprove gate never lets this combination arise through the route", async () => {
    // canApprove() (applications/domain.ts) already refuses to approve an
    // application whose feeMinor/depositMinor are null, so this exact
    // combination is unreachable through the live route today. Constructing
    // it directly at the repo layer proves permits/routes.ts's OWN
    // feeMinor/depositMinor null-check is a real, independent line of
    // defense — not dead code riding on an invariant enforced elsewhere —
    // in case that upstream invariant is ever loosened.
    const applicationId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const applicationNumber = `ROADCUT/ULB/FEETEST/${String(await appRepo.nextApplicationNumber(tx)).padStart(6, "0")}`;
        await appRepo.insertApplication(tx, {
          id: applicationId, tenantId: TENANT_A, applicationNumber, status: "approved",
          applicantName: "Fee Gate Test", applicantOrg: null, purpose: "water_pipe",
          location: { latitude: 0, longitude: 0, address: "x" }, roadType: "local",
          cuttingLength: "1", cuttingWidth: "1", cuttingDepth: "1", documents: [],
          feeMinor: null, depositMinor: null, currency: "INR",
          createdBy: ACTOR_A, updatedBy: ACTOR_A,
        });
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/permits",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { applicationId, ...validPermitDates },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FEE_NOT_SET");
  });

  it("rejects a second permit for an application that already has one (PERMIT_ALREADY_EXISTS)", async () => {
    const applicationId = await approvedApplicationId();
    const first = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, ...validPermitDates } });
    expect(first.statusCode).toBe(202);
    const permitId = (first.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const second = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, ...validPermitDates } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("PERMIT_ALREADY_EXISTS");
  });

  it("rejects workEndDate <= workStartDate", async () => {
    const applicationId = await approvedApplicationId();
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/permits",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { applicationId, workStartDate: "2027-02-10", workEndDate: "2027-01-10" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_DATE_RANGE");
  });

  it("issues cleanly once every stage is satisfied — a real Postgres SEQUENCE-backed permit_number and a CSPRNG verification code", async () => {
    const applicationId = await approvedApplicationId();
    const issue = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, ...validPermitDates } });
    expect(issue.statusCode).toBe(202);
    const permitId = (issue.json() as { id: string }).id;

    let row: { permitNumber: string; verificationCode: string; status: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
      if (get.statusCode !== 200) return false;
      row = get.json().data;
      return true;
    });
    expect(row!.status).toBe("issued");
    expect(row!.permitNumber).toMatch(/^RCP\/ULB\/\d{4}\/\d{6}$/);
    expect(row!.verificationCode).toMatch(/^[0-9A-F]{16}$/); // 8 CSPRNG bytes, hex, uppercase
  });
});

describe("permits — extend / complete / cancel status gates", () => {
  async function issuedPermitId(): Promise<string> {
    const applicationId = await approvedApplicationId();
    const issue = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, ...validPermitDates } });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    return permitId;
  }

  it("extend: issued -> extended, sets extendedUntil", async () => {
    const permitId = await issuedPermitId();
    const extend = await app.inject({ method: "POST", url: `/v1/roadcut/permits/${permitId}/extend`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { extendedUntil: "2027-03-10" } });
    expect(extend.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "extended");
    const row = (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.extendedUntil).toBe("2027-03-10");
  });

  it("complete: issued -> completed", async () => {
    const permitId = await issuedPermitId();
    const complete = await app.inject({ method: "POST", url: `/v1/roadcut/permits/${permitId}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    expect(complete.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "completed");
  });

  it("cancel: issued -> cancelled, requires a reason", async () => {
    const permitId = await issuedPermitId();
    const missingReason = await app.inject({ method: "POST", url: `/v1/roadcut/permits/${permitId}/cancel`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: {} });
    expect(missingReason.statusCode).toBe(400);

    const cancel = await app.inject({ method: "POST", url: `/v1/roadcut/permits/${permitId}/cancel`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { reason: "application withdrawn by applicant" } });
    expect(cancel.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "cancelled");
  });

  it("cannot complete an already-completed permit (canComplete gate)", async () => {
    const permitId = await issuedPermitId();
    await app.inject({ method: "POST", url: `/v1/roadcut/permits/${permitId}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "completed");
    const again = await app.inject({ method: "POST", url: `/v1/roadcut/permits/${permitId}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("INVALID_STATUS");
  });
});

describe("permits repo — reissuing after cancellation is allowed (partial unique index, not a plain UNIQUE)", () => {
  it("a cancelled permit does not block a fresh permit for the same application", async () => {
    const applicationId = await approvedApplicationId();
    const first = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, ...validPermitDates } });
    const firstId = (first.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${firstId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/roadcut/permits/${firstId}/cancel`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { reason: "superseded" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${firstId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "cancelled");

    const second = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, ...validPermitDates } });
    expect(second.statusCode).toBe(202);
    const secondId = (second.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${secondId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    expect(secondId).not.toBe(firstId);
    const row = await permitRepo.findById(secondId, TENANT_A);
    expect(row?.status).toBe("issued");
  });
});
