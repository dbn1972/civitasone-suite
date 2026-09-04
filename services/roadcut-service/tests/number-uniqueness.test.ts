/**
 * Proof that application/permit numbers no longer collide under concurrent
 * load. Pre-fix, both applications/consumer.ts and permits/consumer.ts
 * computed the trailing digits via `Date.now() % 999999` -- PERIODIC, not
 * random: two commands processed in the same millisecond collide
 * deterministically against application_number / permit_number's UNIQUE
 * constraint, poison-pilling the consumer transaction.
 *
 * Fixed via real Postgres SEQUENCEs (migrations/0003_number_sequences.sql)
 * + nextval() reserved inside the same transaction as the insert (see
 * applications/repo.ts's nextApplicationNumber, permits/repo.ts's
 * nextPermitNumber) -- guaranteed unique by Postgres itself, independent of
 * process concurrency or timing. Mirrors services/fire-service/tests/
 * number-uniqueness.test.ts (PR #1011) and services/animal-service/tests/
 * business-number-uniqueness.test.ts (PR #1007).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
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
  applicantName: "Concurrency Test Applicant",
  purpose: "electricity" as const,
  location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
  roadType: "local" as const,
  cuttingLength: "1",
  cuttingWidth: "1",
  cuttingDepth: "1",
};

describe("application number generation — no collisions under concurrency", () => {
  it("reserves 50 distinct sequence values when called concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => appRepo.nextApplicationNumber(tx))),
    );
    expect(new Set(results).size).toBe(50);
  });

  it("50 concurrent POST /v1/roadcut/applications all succeed and persist 50 distinct application_numbers — zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/roadcut/applications",
          headers: hdr(randomUUID(), TENANT_A, USER_ROLES),
          payload: appBody,
        }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    await drainQueue();
    await new Promise((r) => setTimeout(r, 200));
    await drainQueue();

    const ids = responses.map((r) => (r.json() as { id: string }).id);
    const numbers = await Promise.all(ids.map((id) => appRepo.findById(id, TENANT_A).then((row) => row?.applicationNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50); // every one is unique -- no dropped/collided inserts
  });
});

describe("permit number generation — no collisions under concurrency", () => {
  it("reserves 50 distinct sequence values when called concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => permitRepo.nextPermitNumber(tx))),
    );
    expect(new Set(results).size).toBe(50);
  });

  it("50 concurrent permit issuances against 50 distinct approved applications all succeed with 50 distinct permit_numbers", async () => {
    // Each permit needs its own approved application (one permit per
    // application is enforced at the DB level), so drive 50 applications to
    // "approved" first, then fire all 50 permit issuances concurrently.
    const applicationIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
      applicationIds.push((create.json() as { id: string }).id);
    }
    await drainQueue();
    await new Promise((r) => setTimeout(r, 200));
    await drainQueue();
    // Each transition's route reads the application's CURRENT status before
    // publishing the next command (canTransition's pre-check) -- firing
    // submit/start-review/approve back-to-back without waiting for each
    // one's consumer to actually land would race that read against a still
    // in-flight prior write and 422 out. Drive each application's own
    // three-step chain to completion before moving to the next await point,
    // but let all 50 applications' chains run concurrently against each
    // other (Promise.all over per-application async chains).
    await Promise.all(
      applicationIds.map(async (id) => {
        await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
        await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
        await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/start-review`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
        await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "under_review");
        await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/approve`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
        await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "approved");
      }),
    );

    const responses = await Promise.all(
      applicationIds.map((applicationId) =>
        app.inject({
          method: "POST",
          url: "/v1/roadcut/permits",
          headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
          payload: { applicationId, workStartDate: "2027-01-10", workEndDate: "2027-02-10" },
        }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    await drainQueue();
    await new Promise((r) => setTimeout(r, 200));
    await drainQueue();

    const permitIds = responses.map((r) => (r.json() as { id: string }).id);
    const numbers = await Promise.all(permitIds.map((id) => permitRepo.findById(id, TENANT_A).then((row) => row?.permitNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50);
  }, 30000);
});
