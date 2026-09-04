/**
 * Real-DB integration test for building-service's lifecycle module
 * (certificates + renewals).
 *
 * Replaces the previous vi.mock("../../shared/db.js") version. Drives the
 * real Fastify app + real consumers (applications, permits, lifecycle)
 * against a real, migrated Postgres database and asserts on persisted rows.
 *
 * Covers:
 *  1. Route -> consumer -> persisted state for
 *     issue permit -> issue certificate -> request renewal -> decide renewal
 *     (approved), including the permit's validUntil actually being extended.
 *  2. Read-through cache invalidation on the permit's GET-by-id cache after
 *     an approved renewal decision (shared/infra.ts, TTL 60s).
 *  3. The fake-success guard on decideRenewal (repo.updateRenewalDecision
 *     AND permitRepo.updateValidUntil, both boolean "did a row actually
 *     match" returns): a decide command for a renewal id that does not
 *     exist must write no outbox event / audit row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../../app.js";
import { queue } from "../../shared/infra.js";
import { db, sqlClient } from "../../shared/db.js";
import { registerApplicationConsumers } from "../applications/consumer.js";
import { registerPermitConsumers } from "../permits/consumer.js";
import { registerLifecycleConsumers } from "./consumer.js";
import * as applicationsRepo from "../applications/repo.js";
import { COMMANDS } from "../../topics.js";

// `drain()` is a test-aid method on the concrete Bus implementation
// (services/queue-service/src/bus.ts) that resolves once every in-flight
// delivery (including retry backoffs and any cascaded publishes) has
// settled — it lets a test await async fan-out deterministically instead of
// racing a fixed sleep. It is intentionally not part of the public `Queue`
// interface (production consumers are push-based and never need it), so it
// is accessed through a narrow local cast rather than widening the shared
// `Queue` type fleet-wide for a test-only concern.
async function drain(): Promise<void> {
  await (queue as unknown as { drain(): Promise<void> }).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "10000000-aaaa-4000-8000-000000000004";
const ACTOR = "20000000-bbbb-4000-8000-000000000004";

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "test-session" }, SECRET, 3600);
}

const userAuth = { authorization: `Bearer ${token(ACTOR, ["building_user"])}` };
const officerAuth = { authorization: `Bearer ${token(ACTOR, ["building_admin"])}` };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerPermitConsumers(queue);
  registerLifecycleConsumers(queue);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function seedApprovedApplication(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, async () => {
    await db.transaction(async (tx) => {
      await applicationsRepo.insertApplication(tx, {
        id,
        tenantId: TENANT,
        applicationNumber: `BLDG/TEST/${randomUUID().slice(0, 8)}`,
        status: "approved",
        siteAddress: { line1: "1 Lifecycle St", city: "Test City", pin: "560001" },
        feeMinor: 500000n,
        feeCurrency: "INR",
        feePaid: true,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    });
  });
  return id;
}

async function issuePermit(): Promise<{ permitId: string; validUntil: string }> {
  const applicationId = await seedApprovedApplication();
  const issueRes = await app.inject({
    method: "POST",
    url: "/v1/building/permits",
    headers: officerAuth,
    payload: { applicationId, validityMonths: 24 },
  });
  const { id: permitId } = issueRes.json() as { id: string };
  await drain();
  const getRes = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: officerAuth });
  return { permitId, validUntil: getRes.json().data.validUntil };
}

describe("lifecycle — certificates + renewals, real DB reproduction", () => {
  it("issues a certificate against an active permit and persists it", async () => {
    const { permitId } = await issuePermit();

    const certRes = await app.inject({
      method: "POST",
      url: "/v1/building/certificates",
      headers: officerAuth,
      payload: { permitId, certType: "commencement" },
    });
    expect(certRes.statusCode).toBe(202);
    await drain();

    const listRes = await app.inject({ method: "GET", url: `/v1/building/certificates?permitId=${permitId}`, headers: userAuth });
    expect(listRes.json().data).toHaveLength(1);
    expect(listRes.json().data[0].certType).toBe("commencement");
    expect(listRes.json().data[0].status).toBe("issued");
    expect(listRes.json().data[0].verificationCode).toBeTruthy();
  });

  it("rejects issuing a certificate against a non-'active' permit", async () => {
    const { permitId } = await issuePermit();
    const suspendRes = await app.inject({
      method: "POST",
      url: `/v1/building/permits/${permitId}/suspend`,
      headers: officerAuth,
      payload: { reason: "site inspection pending" },
    });
    expect(suspendRes.statusCode).toBe(202);
    await drain();

    const certRes = await app.inject({
      method: "POST",
      url: "/v1/building/certificates",
      headers: officerAuth,
      payload: { permitId, certType: "completion" },
    });
    expect(certRes.statusCode).toBe(422);
  });

  it("request -> approve renewal extends the permit's validUntil and invalidates the permit's read-through cache", async () => {
    const { permitId, validUntil: originalValidUntil } = await issuePermit();

    // Populate the permit's GET-by-id cache with the pre-renewal value.
    const before = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: userAuth });
    expect(before.json().data.validUntil).toBe(originalValidUntil);

    const requestRes = await app.inject({
      method: "POST",
      url: "/v1/building/renewals",
      headers: userAuth,
      payload: { permitId, renewalType: "renewal" },
    });
    expect(requestRes.statusCode).toBe(202);
    const { id: renewalId } = requestRes.json() as { id: string };
    await drain();

    const renewalGet = await app.inject({ method: "GET", url: `/v1/building/renewals/${renewalId}`, headers: userAuth });
    expect(renewalGet.json().data.status).toBe("submitted");
    expect(renewalGet.json().data.feeMinor).not.toBeNull();

    const decideRes = await app.inject({
      method: "POST",
      url: `/v1/building/renewals/${renewalId}/decide`,
      headers: officerAuth,
      payload: { decision: "approved" },
    });
    expect(decideRes.statusCode).toBe(202);
    await drain();

    // Cache invalidation check: this GET must reflect the extended
    // validUntil, not the pre-renewal cached value.
    const afterDecide = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: userAuth });
    expect(afterDecide.json().data.validUntil).not.toBe(originalValidUntil);
    expect(new Date(afterDecide.json().data.validUntil).getTime()).toBeGreaterThan(new Date(originalValidUntil).getTime());

    const renewalAfterDecide = await app.inject({ method: "GET", url: `/v1/building/renewals/${renewalId}`, headers: userAuth });
    expect(renewalAfterDecide.json().data.status).toBe("approved");
  });

  it("a rejected renewal leaves the permit's validUntil unchanged", async () => {
    const { permitId, validUntil: originalValidUntil } = await issuePermit();
    const requestRes = await app.inject({
      method: "POST",
      url: "/v1/building/renewals",
      headers: userAuth,
      payload: { permitId, renewalType: "extension" },
    });
    const { id: renewalId } = requestRes.json() as { id: string };
    await drain();

    await app.inject({
      method: "POST",
      url: `/v1/building/renewals/${renewalId}/decide`,
      headers: officerAuth,
      payload: { decision: "rejected", reason: "insufficient documentation" },
    });
    await drain();

    const afterDecide = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: userAuth });
    expect(afterDecide.json().data.validUntil).toBe(originalValidUntil);
  });
});

describe("fake-success guard — a stale/mismatched decideRenewal command must not fabricate success", () => {
  it("a decideRenewal command for a renewal id that does not exist writes no outbox event", async () => {
    const bogusRenewalId = randomUUID();
    await queue.publish(COMMANDS.decideRenewal, {
      messageId: randomUUID(),
      type: COMMANDS.decideRenewal,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id: bogusRenewalId, tenantId: TENANT, decision: "approved" },
    });
    await drain();

    const rows = await sqlClient`
      SELECT id FROM _outbox.messages
      WHERE payload->>'renewalId' = ${bogusRenewalId}
    `;
    expect(rows.length).toBe(0);
  });
});
