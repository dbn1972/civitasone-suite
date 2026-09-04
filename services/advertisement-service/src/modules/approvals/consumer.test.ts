/**
 * Real, DB-backed approvals tests — route → consumer → persisted-state.
 *
 * Replaces the previous fully vi.mock'd consumer.test.ts. Covers the
 * original regression this file protected (initiateScrutiny previously
 * discarded appRepo.updateStatus's boolean return, so a scrutiny record +
 * event + audit record could be created for an application never actually
 * moved to "under_review" — a fake-success), now proven against a real
 * Postgres row instead of a mocked function call, plus the full
 * scrutiny → decision lifecycle and this branch's applications pre-accept
 * check (draft applications cannot be scrutinized).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { queue } from "../../shared/infra.js";
import { sqlClient } from "../../shared/db.js";
import { registerApplicationConsumers } from "../applications/consumer.js";
import { registerApprovalConsumers } from "./consumer.js";
import * as appRepo from "../applications/repo.js";
import * as repo from "./repo.js";
import { COMMANDS } from "../../topics.js";
import { tokenForTenant, settle } from "../../shared/test-helpers.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
// "adv_admin" (not "adv_officer" alone) so the SAME token can create +
// submit applications (applications/routes.ts ADV_ROLES = adv_user/adv_admin/
// super_admin) as well as drive scrutiny/decide (approvals/routes.ts
// OFFICER_ROLES = adv_admin/adv_officer/super_admin) in one test flow.
const OFFICER_ROLES = ["adv_admin"];

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  registerApplicationConsumers(queue);
  registerApprovalConsumers(queue);
  await queue.start();
  app = await buildApp();
  token = tokenForTenant(TENANT, ACTOR, OFFICER_ROLES);
});

afterAll(async () => {
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

function appPayload() {
  return {
    advertiserName: "Acme Ads",
    advertiserOrg: "Acme Pvt Ltd",
    advertisementType: "banner",
    location: { address: "MG Road" },
    dimensions: { widthFt: 20, heightFt: 10, areaInSqFt: 200 },
  };
}

async function createApplication(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/advertisement/applications",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: appPayload(),
  });
  const { id } = res.json() as { id: string };
  await settle();
  return id;
}

async function createSubmittedApplication(): Promise<string> {
  const id = await createApplication();
  await app.inject({ method: "POST", url: `/v1/advertisement/applications/${id}/submit`, headers: { authorization: `Bearer ${token}` } });
  await settle();
  return id;
}

describe("scrutiny + decision — route → consumer → persisted state", () => {
  it("initiateScrutiny moves the application to under_review and persists a pending scrutiny record", async () => {
    const applicationId = await createSubmittedApplication();
    const res = await app.inject({
      method: "POST",
      url: "/v1/advertisement/approvals/scrutiny",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { applicationId, scrutinyType: "zone_check", officerId: ACTOR },
    });
    expect(res.statusCode).toBe(202);
    await settle();

    const application = await appRepo.findById(applicationId, TENANT);
    expect(application!.status).toBe("under_review");

    const scrutinies = await repo.listByApplication(applicationId, TENANT);
    expect(scrutinies).toHaveLength(1);
    expect(scrutinies[0]!.status).toBe("pending");
  });

  it("completeScrutiny persists findings and marks the record completed", async () => {
    const applicationId = await createSubmittedApplication();
    const initiate = await app.inject({
      method: "POST",
      url: "/v1/advertisement/approvals/scrutiny",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { applicationId, scrutinyType: "zone_check", officerId: ACTOR },
    });
    await settle();
    const scrutinyId = (initiate.json() as { id: string }).id;

    const complete = await app.inject({
      method: "POST",
      url: `/v1/advertisement/approvals/scrutiny/${scrutinyId}/complete`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { findings: { zoneOk: true } },
    });
    expect(complete.statusCode).toBe(202);
    await settle();

    const scrutiny = await repo.findById(scrutinyId, TENANT);
    expect(scrutiny!.status).toBe("completed");
    expect(scrutiny!.findings).toEqual({ zoneOk: true });
  });

  it("decideApplication moves an under_review application to approved, and the read-through cache reflects it", async () => {
    const applicationId = await createSubmittedApplication();
    await app.inject({
      method: "POST",
      url: "/v1/advertisement/approvals/scrutiny",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { applicationId, scrutinyType: "zone_check", officerId: ACTOR },
    });
    await settle();

    const decide = await app.inject({
      method: "POST",
      url: "/v1/advertisement/approvals/decide",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { applicationId, decision: "approved" },
    });
    expect(decide.statusCode).toBe(202);
    await settle();

    const application = await appRepo.findById(applicationId, TENANT);
    expect(application!.status).toBe("approved");

    // decideApplication's consumer must invalidate the GET's read-through
    // cache — a stale entry would still show "under_review" here.
    const getRes = await app.inject({ method: "GET", url: `/v1/advertisement/applications/${applicationId}`, headers: { authorization: `Bearer ${token}` } });
    expect((getRes.json() as { data: { status: string } }).data.status).toBe("approved");
  });

  it("rejects initiating scrutiny for an application still in draft (pre-accept validation)", async () => {
    const applicationId = await createApplication(); // never submitted
    const res = await app.inject({
      method: "POST",
      url: "/v1/advertisement/approvals/scrutiny",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { applicationId, scrutinyType: "zone_check", officerId: ACTOR },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("initiateScrutiny consumer — fake-success guard (regression)", () => {
  it("does NOT insert a scrutiny record when the referenced application does not exist for this tenant", async () => {
    // Bypasses the route's own pre-accept check (which would 404 this) to
    // exercise the consumer's OWN guard directly — the actual fix this file
    // protects: appRepo.updateStatus's boolean return must gate the insert,
    // not be discarded.
    const bogusApplicationId = randomUUID();
    const scrutinyId = randomUUID();
    await queue.publish(COMMANDS.initiateScrutiny, {
      messageId: randomUUID(),
      type: COMMANDS.initiateScrutiny,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id: scrutinyId, applicationId: bogusApplicationId, scrutinyType: "zone_check", officerId: ACTOR },
    });
    await settle();

    const scrutiny = await repo.findById(scrutinyId, TENANT);
    expect(scrutiny).toBeNull();
  });
});
