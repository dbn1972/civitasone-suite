/**
 * nocs module — route -> consumer -> persisted-state lifecycle, the
 * eligibility gate (checkNocEligibility), the public verify route fix (see
 * migrations/0003_noc_public_directory.sql), duplicate-active-NOC
 * prevention, and a direct DB-level CAS proof for repo.ts's updateStatus
 * under real concurrency.
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
import { registerNocConsumers } from "../src/modules/nocs/consumer.js";
import * as repo from "../src/modules/nocs/repo.js";
import { hdr, drainQueue, waitFor, OFFICER_ROLES, INSPECTOR_ROLES, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerInspectionConsumers(queue);
  registerNocConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const appBody = {
  buildingName: "NOC Test Building",
  buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
  occupancyType: "commercial" as const,
};

/** Full pipeline: create -> submit -> schedule inspection -> complete with "approve". Returns the eligible applicationId. */
async function createEligibleApplication(tenantId = TENANT_A): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, tenantId, OFFICER_ROLES), payload: appBody });
  const applicationId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, tenantId, OFFICER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/fire/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, tenantId, OFFICER_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, tenantId, OFFICER_ROLES) })).json().data.status === "submitted");

  const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, tenantId, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
  const inspectionId = (schedule.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, tenantId, OFFICER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/fire/inspections/${inspectionId}/complete`, headers: hdr(ACTOR_A, tenantId, INSPECTOR_ROLES), payload: { recommendation: "approve" } });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, tenantId, OFFICER_ROLES) })).json().data.status === "completed");

  return applicationId;
}

async function issueNoc(applicationId: string, tenantId = TENANT_A) {
  const issue = await app.inject({
    method: "POST",
    url: "/v1/fire/nocs",
    headers: hdr(ACTOR_A, tenantId, OFFICER_ROLES),
    payload: { applicationId, validFrom: "2027-02-01" },
  });
  return issue;
}

describe("nocs — eligibility gate", () => {
  it("issuing a NOC for an application with no inspection at all is rejected pre-accept with 422", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const issue = await issueNoc(applicationId);
    expect(issue.statusCode).toBe(422);
  });

  it("issuing a NOC for an application whose most recent inspection recommends 'reject' is rejected", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "submitted");
    const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
    const inspectionId = (schedule.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/inspections/${inspectionId}/complete`, headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { recommendation: "reject" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "completed");

    const issue = await issueNoc(applicationId);
    expect(issue.statusCode).toBe(422);
  });

  it("issues a NOC end-to-end for an eligible application: route -> consumer -> persisted state with a real number and verification code", async () => {
    const applicationId = await createEligibleApplication();
    const issue = await issueNoc(applicationId);
    expect(issue.statusCode).toBe(202);
    const id = (issue.json() as { id: string }).id;

    let row: { status: string; nocNumber: string; verificationCode: string; applicationId: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/nocs/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      if (get.statusCode !== 200) return false;
      row = get.json().data;
      return true;
    });
    expect(row!.status).toBe("active");
    expect(row!.applicationId).toBe(applicationId);
    expect(row!.nocNumber).toMatch(/^FNOC\/ULB\/\d{4}\/\d{6}$/);
    expect(row!.verificationCode).toHaveLength(32);
  });

  it("a second NOC for the same application (already has an active one) is rejected 409", async () => {
    const applicationId = await createEligibleApplication();
    const first = await issueNoc(applicationId);
    const firstId = (first.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${firstId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const second = await issueNoc(applicationId);
    expect(second.statusCode).toBe(409);
  });
});

describe("nocs — public verify route (BUG FIX: migrations/0003_noc_public_directory.sql)", () => {
  it("GET /v1/fire/nocs/verify with NO auth header returns the public facts for a valid code (previously 401'd unconditionally)", async () => {
    const applicationId = await createEligibleApplication();
    const issue = await issueNoc(applicationId);
    const nocId = (issue.json() as { id: string }).id;
    let verificationCode: string | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      if (get.statusCode !== 200) return false;
      verificationCode = get.json().data.verificationCode;
      return true;
    });

    // Deliberately NO authorization / x-tenant-id header — this is the
    // unauthenticated public path a citizen actually hits.
    const verify = await app.inject({ method: "GET", url: `/v1/fire/nocs/verify?code=${verificationCode}` });
    expect(verify.statusCode).toBe(200);
    const body = verify.json().data;
    expect(body.status).toBe("active");
    expect(body.nocNumber).toMatch(/^FNOC\/ULB\//);
    // Public payload must never leak applicant/building PII.
    expect(body.buildingName).toBeUndefined();
    expect(body.applicationId).toBeUndefined();
  });

  it("GET /v1/fire/nocs/verify with an unknown code returns 404, not a leak or a crash", async () => {
    const verify = await app.inject({ method: "GET", url: "/v1/fire/nocs/verify?code=does-not-exist" });
    expect(verify.statusCode).toBe(404);
  });

  it("the public directory reflects suspend/revoke, kept in sync in the same transaction as the tenant-scoped row", async () => {
    const applicationId = await createEligibleApplication();
    const issue = await issueNoc(applicationId);
    const nocId = (issue.json() as { id: string }).id;
    let verificationCode: string | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      if (get.statusCode !== 200) return false;
      verificationCode = get.json().data.verificationCode;
      return true;
    });

    const suspend = await app.inject({ method: "POST", url: `/v1/fire/nocs/${nocId}/suspend`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { reason: "violation found" } });
    expect(suspend.statusCode).toBe(202);

    await waitFor(async () => {
      const verify = await app.inject({ method: "GET", url: `/v1/fire/nocs/verify?code=${verificationCode}` });
      return verify.statusCode === 200 && verify.json().data.status === "suspended";
    });
  });
});

describe("nocs — suspend/revoke", () => {
  it("revoking a NOC in status 'issued'/'active' succeeds; revoking again is rejected 422", async () => {
    const applicationId = await createEligibleApplication();
    const issue = await issueNoc(applicationId);
    const nocId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const revoke = await app.inject({ method: "POST", url: `/v1/fire/nocs/${nocId}/revoke`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { reason: "fraud" } });
    expect(revoke.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "revoked");

    const revokeAgain = await app.inject({ method: "POST", url: `/v1/fire/nocs/${nocId}/revoke`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { reason: "fraud again" } });
    expect(revokeAgain.statusCode).toBe(422);
  });
});

async function seedNoc(status: string, applicationId = randomUUID()): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      const nocNumber = `FNOC/CASTEST/${new Date().getUTCFullYear()}/${String(await repo.nextNocNumber(tx)).padStart(6, "0")}`;
      await repo.insert(tx, {
        id,
        tenantId: TENANT_A,
        nocNumber,
        applicationId,
        status,
        issuedAt: new Date(),
        validFrom: "2027-02-01",
        validUntil: "2030-02-01",
        verificationCode: randomUUID().replace(/-/g, ""),
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

describe("nocs/repo.ts updateStatus — compare-and-swap guard", () => {
  it("rejects revoking an already-revoked NOC and leaves it untouched", async () => {
    const id = await seedNoc("revoked");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "revoked", ["issued", "active", "suspended", "expired"], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.version).toBe(1);
  });

  it("rejects with an empty fromStatuses list instead of crashing (drizzle's inArray() throws on [])", async () => {
    const id = await seedNoc("active");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "suspended", [], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("active");
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own", async () => {
    const id = await seedNoc("active");
    const row = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_B, id, "suspended", ["issued", "active"], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("active");
  });

  it("proves the guard holds under real concurrency: two suspend attempts racing for the SAME active NOC — only the first to commit wins, the second (now stale) is rejected", async () => {
    // NOTE: this deliberately races two SUSPEND attempts, not suspend vs.
    // revoke -- revoke's fromStatuses list ([issued, active, suspended,
    // expired]) intentionally INCLUDES "suspended" (revoking an
    // already-suspended NOC is a valid transition, per routes.ts's own
    // pre-check), so a suspend/revoke race is not actually mutually
    // exclusive: Postgres re-evaluates the blocked UPDATE's WHERE clause
    // against the row AFTER the other commits, and "suspended" legitimately
    // still matches revoke's own fromStatuses. Two suspends, by contrast,
    // both use fromStatuses=["issued","active"] -- once the first commits
    // (active -> suspended), the second's re-check against "suspended" no
    // longer matches, so they ARE genuinely mutually exclusive, and this is
    // the correct pair to prove the guard's teeth with.
    const id = await seedNoc("active");

    const results = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "suspended", ["issued", "active"], ACTOR_A))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "suspended", ["issued", "active"], ACTOR_A))),
    ]);

    const applied = results.filter((r) => r !== null);
    // Exactly one must win, never both (that would mean the row silently
    // applied two conflicting writes) and never zero (that would mean the
    // guard is over-rejecting a valid transition).
    expect(applied).toHaveLength(1);

    const row = await findAsTenantA(id);
    expect(row?.status).toBe("suspended");
    expect(row?.version).toBe(2);
  });
});
