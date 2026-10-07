/**
 * GAP-CITIZEN-RTI-DETAIL-01 — DB-backed route pins (integrator run).
 *
 * The fixer established the server behaviour by inspection but could NOT run
 * the DB-backed route test because the throwaway test Postgres (:5672) was
 * down. The DB is back; this file runs the real flow end-to-end:
 *
 *  1. respond / transfer are OFFICER-gated — a bare `citizen` gets 403, so an
 *     applicant can never answer or re-route their own RTI (defence against the
 *     original "applicant can respond to own RTI" gap).
 *  2. §19(1) deemed-refusal: a *premature* appeal (freshly filed RTI — no
 *     response yet AND the 30-day §7 clock has not expired) is rejected with
 *     409 APPEAL_NOT_ALLOWED (fail-closed), enforced AFTER ownership so a
 *     non-owner still gets 404 (existence not leaked).
 *
 * Pattern mirrors tests/authz.crosscitizen.test.ts (register consumer, file via
 * the public contract, poll until the projection is readable).
 *
 * Source: modules/rti/routes.ts, modules/rti/domain.ts (isAppealAllowed).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";

registerRtiConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000d1";
const OWNER = "11111111-1111-4000-8000-0000000000d1"; // citizen actorId == own id
const OTHER = "22222222-2222-4000-8000-0000000000d1"; // a different citizen
const OFFICER = "99999999-9999-4000-8000-0000000000d1";
const CPIO = "33333333-3333-4000-8000-0000000000d1";

function citizenTok(sub: string) {
  return signToken({ sub, tid: TENANT, roles: ["citizen"], sid: "s" }, SECRET, 3600);
}
function officerTok() {
  return signToken({ sub: OFFICER, tid: TENANT, roles: ["citizen_officer"], sid: "s" }, SECRET, 3600);
}
const ofH = { authorization: `Bearer ${officerTok()}`, "content-type": "application/json" };
const ownerH = { authorization: `Bearer ${citizenTok(OWNER)}`, "content-type": "application/json" };
const otherH = { authorization: `Bearer ${citizenTok(OTHER)}`, "content-type": "application/json" };

let app: FastifyInstance;
let rtiId = "";

async function waitReady(url: string) {
  for (let i = 0; i < 40; i++) {
    const r = await app.inject({ method: "GET", url, headers: ofH });
    if (r.statusCode === 200) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`waitReady timeout for ${url}`);
}

beforeAll(async () => {
  app = await buildApp();
  // File an RTI owned by OWNER via the public contract (officer may file on behalf).
  const r = await app.inject({
    method: "POST",
    url: "/v1/citizen/rti",
    headers: ofH,
    payload: { citizenId: OWNER, subject: "info", description: "please provide records", cpioRef: CPIO },
  });
  expect(r.statusCode).toBe(202);
  rtiId = JSON.parse(r.body).id as string;
  await waitReady(`/v1/citizen/rti/${rtiId}`);
}, 30000);

afterAll(async () => {
  await sqlClient
    .begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`DELETE FROM rti.citizen_rti_appeals WHERE rti_id = ${rtiId}`;
      await sql`DELETE FROM rti.citizen_rti_requests WHERE id = ${rtiId}`;
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("GAP-CITIZEN-RTI-DETAIL-01 — respond/transfer are officer-gated", () => {
  it("POST :id/respond by a bare citizen (the applicant) → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/rti/${rtiId}/respond`,
      headers: ownerH,
      payload: { responseUrl: "https://example.gov.in/rti/response.pdf" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST :id/transfer by a bare citizen → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/rti/${rtiId}/transfer`,
      headers: otherH,
      payload: { toAuthority: CPIO },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST :id/respond by an officer is accepted → 202", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/rti/${rtiId}/respond`,
      headers: ofH,
      payload: { responseUrl: "https://example.gov.in/rti/response.pdf" },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("GAP-CITIZEN-RTI-DETAIL-01 — §19 premature-appeal is rejected", () => {
  it("a non-owner appealing gets 404 before any 409 (existence not leaked)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/citizen/rti/${rtiId}/appeal`,
      headers: otherH,
      payload: { appealType: "first", grounds: "no response received" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("the OWNER appealing a fresh RTI (no response, within 30-day deadline) → 409 APPEAL_NOT_ALLOWED", async () => {
    // NOTE: this must run before the officer response above is projected; the
    // response above is published async and the appeal check reads the current
    // projection. To avoid ordering flakiness we file a SECOND fresh RTI here.
    const r2 = await app.inject({
      method: "POST",
      url: "/v1/citizen/rti",
      headers: ownerH,
      payload: { subject: "second", description: "fresh request", cpioRef: CPIO },
    });
    expect(r2.statusCode).toBe(202);
    const freshId = JSON.parse(r2.body).id as string;
    await waitReady(`/v1/citizen/rti/${freshId}`);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/citizen/rti/${freshId}/appeal`,
      headers: ownerH,
      payload: { appealType: "first", grounds: "premature — no response yet and deadline not past" },
    });
    expect(res.statusCode).toBe(409);
    // rti/routes.ts error handler sends { code, message, ... } at top level.
    expect(res.json().code).toBe("APPEAL_NOT_ALLOWED");

    await sqlClient
      .begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        await sql`DELETE FROM rti.citizen_rti_requests WHERE id = ${freshId}`;
      })
      .catch(() => {});
  });
});
