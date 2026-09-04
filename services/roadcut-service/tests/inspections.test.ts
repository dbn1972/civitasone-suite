/**
 * inspections module — route -> consumer -> persisted-state lifecycle, plus
 * a direct DB-level proof that repo.completeInspection is a real
 * compare-and-swap (CAS) — a gap this hardening pass found and closed:
 * unlike permits/restoration (which already re-asserted the expected prior
 * status in their UPDATE WHERE clauses), completeInspection previously
 * keyed only on id+tenantId, so two concurrent /complete calls for the same
 * inspection could each pass the route's canComplete() pre-check and the
 * second would silently overwrite the first assessment's findings. Fixed to
 * match the pattern already used by restoration/repo.ts's
 * completeRestoration and updateDepositRefund.
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
import { registerInspectionConsumers } from "../src/modules/inspections/consumer.js";
import * as inspectionRepo from "../src/modules/inspections/repo.js";
import { hdr, drainQueue, waitFor, USER_ROLES, ADMIN_ROLES, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerPermitConsumers(queue);
  registerInspectionConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const appBody = {
  applicantName: "Inspection Test Applicant",
  purpose: "sewer_pipe" as const,
  location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
  roadType: "collector" as const,
  cuttingLength: "2",
  cuttingWidth: "2",
  cuttingDepth: "1",
};

async function issuedPermitId(): Promise<string> {
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
  return permitId;
}

describe("inspections — route -> consumer -> persisted state", () => {
  it("schedule: rejects a non-existent permitId with 404 before any command is queued", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadcut/inspections",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { permitId: randomUUID(), inspectionType: "pre_work", inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PERMIT_NOT_FOUND");
  });

  it("schedule: persists a 'scheduled' inspection against a real permit", async () => {
    const permitId = await issuedPermitId();
    const schedule = await app.inject({
      method: "POST",
      url: "/v1/roadcut/inspections",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { permitId, inspectionType: "pre_work", inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    expect(schedule.statusCode).toBe(202);
    const inspectionId = (schedule.json() as { id: string }).id;

    let row: { status: string; permitId: string } | undefined;
    await waitFor(async () => {
      const list = await app.inject({ method: "GET", url: `/v1/roadcut/inspections?permitId=${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
      const found = list.json().data.find((r: { id: string }) => r.id === inspectionId);
      if (!found) return false;
      row = found;
      return true;
    });
    expect(row!.status).toBe("scheduled");
    expect(row!.permitId).toBe(permitId);
  });

  it("complete: scheduled -> completed with findings persisted", async () => {
    const permitId = await issuedPermitId();
    const schedule = await app.inject({ method: "POST", url: "/v1/roadcut/inspections", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { permitId, inspectionType: "during_work", inspectorId: ACTOR_A, scheduledDate: "2027-01-20" } });
    const inspectionId = (schedule.json() as { id: string }).id;
    await waitFor(async () => {
      const list = await app.inject({ method: "GET", url: `/v1/roadcut/inspections?permitId=${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
      return list.json().data.some((r: { id: string }) => r.id === inspectionId);
    });

    const complete = await app.inject({
      method: "POST",
      url: `/v1/roadcut/inspections/${inspectionId}/complete`,
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { status: "completed", findings: { depth_ok: true, width_ok: true } },
    });
    expect(complete.statusCode).toBe(202);

    let row: { status: string; findings: unknown } | undefined;
    await waitFor(async () => {
      const list = await app.inject({ method: "GET", url: `/v1/roadcut/inspections?permitId=${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
      const found = list.json().data.find((r: { id: string }) => r.id === inspectionId);
      if (!found || found.status !== "completed") return false;
      row = found;
      return true;
    });
    expect(row!.findings).toEqual({ depth_ok: true, width_ok: true });
  });

  it("complete: already-completed inspection is rejected at the route (canComplete gate)", async () => {
    const permitId = await issuedPermitId();
    const schedule = await app.inject({ method: "POST", url: "/v1/roadcut/inspections", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { permitId, inspectionType: "post_restoration", inspectorId: ACTOR_A, scheduledDate: "2027-02-15" } });
    const inspectionId = (schedule.json() as { id: string }).id;
    await waitFor(async () => {
      const list = await app.inject({ method: "GET", url: `/v1/roadcut/inspections?permitId=${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
      return list.json().data.some((r: { id: string }) => r.id === inspectionId);
    });
    await app.inject({ method: "POST", url: `/v1/roadcut/inspections/${inspectionId}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "completed", findings: {} } });
    await waitFor(async () => {
      const list = await app.inject({ method: "GET", url: `/v1/roadcut/inspections?permitId=${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
      const found = list.json().data.find((r: { id: string }) => r.id === inspectionId);
      return found?.status === "completed";
    });

    const again = await app.inject({ method: "POST", url: `/v1/roadcut/inspections/${inspectionId}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "failed", findings: {} } });
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("ALREADY_COMPLETED");
  });
});

describe("inspections repo.completeInspection — real compare-and-swap (bug found and fixed by this hardening pass)", () => {
  it("a losing racer against a concurrent completion is a genuine no-op, not a silent overwrite", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        inspectionRepo.insertInspection(tx, {
          id, tenantId: TENANT_A, permitId: randomUUID(), inspectionType: "pre_work",
          inspectorId: ACTOR_A, scheduledDate: "2027-01-15", status: "scheduled",
          createdBy: ACTOR_A, updatedBy: ACTOR_A,
        }),
      ),
    );

    const [passResult, failResult] = await Promise.all([
      runWithTenant(TENANT_A, () =>
        db.transaction((tx) => inspectionRepo.completeInspection(tx, id, TENANT_A, "completed", { verdict: "pass" }, null, "satisfactory", ACTOR_A)),
      ),
      runWithTenant(TENANT_A, () =>
        db.transaction((tx) => inspectionRepo.completeInspection(tx, id, TENANT_A, "failed", { verdict: "fail" }, null, "unsatisfactory", ACTOR_A)),
      ),
    ]);
    // Exactly one of the two racing completions applied.
    expect([passResult, failResult].filter(Boolean)).toHaveLength(1);

    const finalRow = await runWithTenant(TENANT_A, () => db.transaction((tx) => inspectionRepo.findById(id, TENANT_A)));
    // Whichever one actually won, the row must reflect ONE coherent
    // assessment (status and findings agree), never a mix of the two.
    if (finalRow!.status === "completed") {
      expect(finalRow!.findings).toEqual({ verdict: "pass" });
    } else {
      expect(finalRow!.status).toBe("failed");
      expect(finalRow!.findings).toEqual({ verdict: "fail" });
    }

    // A second call attempted after the row is no longer "scheduled" must
    // also cleanly no-op (proves the guard holds beyond just the race
    // window, e.g. for a stale retried command).
    const stale = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => inspectionRepo.completeInspection(tx, id, TENANT_A, "completed", { verdict: "late" }, null, "satisfactory", ACTOR_A)),
    );
    expect(stale).toBe(false);
  });
});
