/**
 * inspections module — route -> consumer -> persisted-state lifecycle,
 * the findings-vs-complete regression (see consumer.ts's CRITICAL fix
 * comment: recordFindings must never itself complete an inspection), and a
 * direct DB-level CAS proof for repo.ts's updateStatus, including under
 * real concurrency.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerInspectionConsumers } from "../src/modules/inspections/consumer.js";
import * as repo from "../src/modules/inspections/repo.js";
import { hdr, drainQueue, waitFor, OFFICER_ROLES, INSPECTOR_ROLES, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerInspectionConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const appBody = {
  buildingName: "Inspection Test Building",
  buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
  occupancyType: "commercial" as const,
};

async function createSubmittedApplication(): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/fire/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "submitted");
  return id;
}

describe("inspections — route -> consumer -> persisted state", () => {
  it("schedule: publishes 202, consumer persists a scheduled inspection", async () => {
    const applicationId = await createSubmittedApplication();
    const schedule = await app.inject({
      method: "POST",
      url: "/v1/fire/inspections",
      headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES),
      payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    expect(schedule.statusCode).toBe(202);
    const id = (schedule.json() as { id: string }).id;

    let row: { status: string; applicationId: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      if (get.statusCode !== 200) return false;
      row = get.json().data;
      return true;
    });
    expect(row!.status).toBe("scheduled");
    expect(row!.applicationId).toBe(applicationId);
  });

  it("scheduling against a draft (non-submitted) application is rejected pre-accept with 422", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const schedule = await app.inject({
      method: "POST",
      url: "/v1/fire/inspections",
      headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES),
      payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    expect(schedule.statusCode).toBe(422);
  });

  it("scheduling against a nonexistent application 404s pre-accept, never publishing a command", async () => {
    const schedule = await app.inject({
      method: "POST",
      url: "/v1/fire/inspections",
      headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES),
      payload: { applicationId: randomUUID(), inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    expect(schedule.statusCode).toBe(404);
  });

  it("REGRESSION: recording findings alone does not complete the inspection (it must stay 'scheduled', with no recommendation) — only /complete does", async () => {
    const applicationId = await createSubmittedApplication();
    const schedule = await app.inject({
      method: "POST",
      url: "/v1/fire/inspections",
      headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES),
      payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    const id = (schedule.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const findings = await app.inject({
      method: "POST",
      url: `/v1/fire/inspections/${id}/findings`,
      headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES),
      payload: { findings: [{ description: "Fire extinguisher present", compliant: true }] },
    });
    expect(findings.statusCode).toBe(202);

    let row: { status: string; findings: unknown; recommendation: string | null } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      row = get.json().data;
      return row?.findings != null;
    });
    // The bug this guards against: findings-only used to jump straight to
    // "completed" with recommendation left NULL, permanently blocking NOC
    // eligibility (checkNocEligibility requires status "completed" AND
    // recommendation "approve" on the most recent inspection).
    expect(row!.status).toBe("scheduled");
    expect(row!.recommendation).toBeNull();

    const complete = await app.inject({
      method: "POST",
      url: `/v1/fire/inspections/${id}/complete`,
      headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES),
      payload: { recommendation: "approve" },
    });
    expect(complete.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "completed");
    const finalRow = (await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    expect(finalRow.recommendation).toBe("approve");
    // findings recorded earlier must survive through to completion
    expect(finalRow.findings).not.toBeNull();
  });

  it("recording findings with an invalid shape (missing description) is rejected with 400, not silently dropped", async () => {
    const applicationId = await createSubmittedApplication();
    const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
    const id = (schedule.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const badFindings = await app.inject({
      method: "POST",
      url: `/v1/fire/inspections/${id}/findings`,
      headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES),
      payload: { findings: [{ compliant: true }] },
    });
    expect(badFindings.statusCode).toBe(400);
  });

  it("completing an already-completed inspection is rejected with 422, not re-applied", async () => {
    const applicationId = await createSubmittedApplication();
    const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
    const id = (schedule.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/inspections/${id}/complete`, headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { recommendation: "approve" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "completed");

    const secondComplete = await app.inject({ method: "POST", url: `/v1/fire/inspections/${id}/complete`, headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { recommendation: "reject" } });
    expect(secondComplete.statusCode).toBe(422);
    const row = (await app.inject({ method: "GET", url: `/v1/fire/inspections/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    expect(row.recommendation).toBe("approve"); // untouched by the rejected second attempt
  });
});

async function seedInspection(status: string): Promise<string> {
  const id = randomUUID();
  const applicationId = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: TENANT_A,
        applicationId,
        inspectorId: ACTOR_A,
        scheduledDate: "2027-01-15",
        status,
        createdBy: ACTOR_A,
        updatedBy: ACTOR_A,
      });
    }),
  );
  return id;
}

function findAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => repo.findById(TENANT_A, id));
}

describe("inspections/repo.ts updateStatus — compare-and-swap guard", () => {
  it("rejects completing a non-scheduled inspection and leaves it untouched", async () => {
    const id = await seedInspection("completed");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "completed", { recommendation: "reject" }, ["scheduled"], ACTOR_A)),
    );
    expect(row).toBeNull();
    const current = await findAsTenantA(id);
    expect(current?.version).toBe(1);
  });

  it("rejects with an empty fromStatuses list instead of crashing (drizzle's inArray() throws on [])", async () => {
    const id = await seedInspection("scheduled");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "completed", { recommendation: "approve" }, [], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("scheduled");
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own", async () => {
    const id = await seedInspection("scheduled");
    const row = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_B, id, "completed", { recommendation: "approve" }, ["scheduled"], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("scheduled");
  });

  it("proves the guard holds under real concurrency: two /complete-shaped updateStatus calls racing for the SAME row — only the first to commit applies, the second (now stale) is rejected", async () => {
    const id = await seedInspection("scheduled");

    const results = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "completed", { recommendation: "approve" }, ["scheduled"], ACTOR_A))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "completed", { recommendation: "reject" }, ["scheduled"], ACTOR_A))),
    ]);

    const applied = results.filter((r) => r !== null);
    const rejected = results.filter((r) => r === null);
    // Exactly one of the two racing writers wins — Postgres row-lock
    // serializes them, and the second to run sees the row already
    // "completed", which is no longer in its own ["scheduled"] fromStatuses.
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const row = await findAsTenantA(id);
    expect(row?.status).toBe("completed");
    expect(row?.version).toBe(2);
    expect(["approve", "reject"]).toContain(row?.recommendation);
  });
});
