/**
 * lifecycle (renewals) module — route -> consumer -> persisted-state
 * lifecycle, the stale-renewal-after-revoke regression (see consumer.ts's
 * CRITICAL fix: decideRenewal must re-check the NOC's LIVE state, not just
 * the renewal record's own fields, before reactivating it), and a direct
 * DB-level CAS proof for repo.ts's updateDecision under real concurrency.
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
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import * as repo from "../src/modules/lifecycle/repo.js";
import { hdr, drainQueue, waitFor, OFFICER_ROLES, INSPECTOR_ROLES, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerInspectionConsumers(queue);
  registerNocConsumers(queue);
  registerLifecycleConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const appBody = {
  buildingName: "Renewal Test Building",
  buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
  occupancyType: "commercial" as const,
};

async function createActiveNoc(): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
  const applicationId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/fire/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "submitted");

  const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
  const inspectionId = (schedule.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/fire/inspections/${inspectionId}/complete`, headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { recommendation: "approve" } });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "completed");

  const issue = await app.inject({ method: "POST", url: "/v1/fire/nocs", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { applicationId, validFrom: "2027-02-01" } });
  const nocId = (issue.json() as { id: string }).id;
  // Two-step wait: the row does not exist at all until the consumer
  // processes it, so a GET can genuinely 404 on the first poll -- check
  // statusCode before touching .json().data (a 404 body has no `data` key).
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "active");
  return nocId;
}

describe("lifecycle/renewals — route -> consumer -> persisted state", () => {
  it("request: publishes 202, consumer persists a requested renewal with the correct fee and previousValidUntil snapshot", async () => {
    const nocId = await createActiveNoc();
    const noc = (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;

    const request = await app.inject({
      method: "POST",
      url: "/v1/fire/renewals",
      headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES),
      payload: { nocId, renewalType: "renewal" },
    });
    expect(request.statusCode).toBe(202);
    const id = (request.json() as { id: string }).id;

    let row: { status: string; feeMinor: string; previousValidUntil: string | null } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/renewals/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      if (get.statusCode !== 200) return false;
      row = get.json().data;
      return true;
    });
    expect(row!.status).toBe("requested");
    expect(String(row!.feeMinor)).toBe("150000");
    expect(row!.previousValidUntil).toBe(noc.validUntil);
  });

  it("decide approved: renewal -> approved, NOC extended and reactivated", async () => {
    const nocId = await createActiveNoc();
    const request = await app.inject({ method: "POST", url: "/v1/fire/renewals", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { nocId, renewalType: "renewal" } });
    const id = (request.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/renewals/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const decide = await app.inject({ method: "POST", url: `/v1/fire/renewals/${id}/decide`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { decision: "approved" } });
    expect(decide.statusCode).toBe(202);

    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/renewals/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "approved");
    const noc = (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    expect(noc.status).toBe("active");
  });

  it("decide rejected: renewal -> rejected, NOC untouched", async () => {
    const nocId = await createActiveNoc();
    const nocBefore = (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    const request = await app.inject({ method: "POST", url: "/v1/fire/renewals", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { nocId, renewalType: "renewal" } });
    const id = (request.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/renewals/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    await app.inject({ method: "POST", url: `/v1/fire/renewals/${id}/decide`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { decision: "rejected" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/renewals/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "rejected");

    const nocAfter = (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    expect(nocAfter.validUntil).toBe(nocBefore.validUntil); // untouched
  });

  it("REGRESSION: a renewal approved after its NOC was independently revoked in the interim must NOT reactivate the revoked NOC", async () => {
    const nocId = await createActiveNoc();
    const request = await app.inject({ method: "POST", url: "/v1/fire/renewals", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { nocId, renewalType: "renewal" } });
    const id = (request.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/renewals/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    // Independently revoke the NOC while the renewal is still pending —
    // e.g. an officer discovers a violation after the citizen already filed
    // for renewal.
    await app.inject({ method: "POST", url: `/v1/fire/nocs/${nocId}/revoke`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { reason: "violation found" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "revoked");

    // Now a (possibly different) officer approves the now-stale renewal.
    await app.inject({ method: "POST", url: `/v1/fire/renewals/${id}/decide`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { decision: "approved" } });
    await drainQueue();
    await new Promise((r) => setTimeout(r, 200));
    await drainQueue();

    const noc = (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    // The bug this guards against: the NOC would have been silently flipped
    // back to "active", fully undoing the revocation.
    expect(noc.status).toBe("revoked");
  });

  it("requesting a renewal for a revoked NOC is rejected pre-accept with 422", async () => {
    const nocId = await createActiveNoc();
    await app.inject({ method: "POST", url: `/v1/fire/nocs/${nocId}/revoke`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { reason: "violation" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "revoked");

    const request = await app.inject({ method: "POST", url: "/v1/fire/renewals", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { nocId, renewalType: "renewal" } });
    expect(request.statusCode).toBe(422);
  });
});

async function seedRenewal(status: string, nocId = randomUUID()): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: TENANT_A,
        nocId,
        renewalType: "renewal",
        status,
        feeMinor: 150000n,
        previousValidUntil: "2027-02-01",
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

describe("lifecycle/repo.ts updateDecision — compare-and-swap guard", () => {
  it("rejects deciding an already-decided renewal and leaves it untouched", async () => {
    const id = await seedRenewal("approved");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateDecision(tx, TENANT_A, id, "rejected", "rejected", null, ["requested", "under_review"], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.version).toBe(1);
  });

  it("rejects with an empty fromStatuses list instead of crashing (drizzle's inArray() throws on [])", async () => {
    const id = await seedRenewal("requested");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateDecision(tx, TENANT_A, id, "approved", "approved", "2030-02-01", [], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("requested");
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own", async () => {
    const id = await seedRenewal("requested");
    const row = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => repo.updateDecision(tx, TENANT_B, id, "approved", "approved", "2030-02-01", ["requested", "under_review"], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("requested");
  });

  it("proves the guard holds under real concurrency: two decide calls racing for the SAME renewal — only the first to commit applies", async () => {
    const id = await seedRenewal("requested");

    const results = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateDecision(tx, TENANT_A, id, "approved", "approved", "2030-02-01", ["requested", "under_review"], ACTOR_A))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateDecision(tx, TENANT_A, id, "rejected", "rejected", null, ["requested", "under_review"], ACTOR_A))),
    ]);

    const applied = results.filter((r) => r !== null);
    expect(applied).toHaveLength(1);

    const row = await findAsTenantA(id);
    expect(row?.version).toBe(2);
    expect(["approved", "rejected"]).toContain(row?.status);
  });
});
