/**
 * Proof that complaintNumber/hotspotCode generation does not collide under
 * concurrent load. Unlike fire-service/animal-service (real Postgres
 * SEQUENCEs), drainage-service's commands.ts still uses the mitigation
 * documented in complaints/commands.ts and hotspots/commands.ts:
 * `` `DRN-${Date.now()}-${randomInt(1000, 9999)}` `` backed by a genuine
 * UNIQUE constraint on complaint_number/hotspot_code (migrations/
 * 0001_initial.sql). This is weaker than a DB sequence (still probabilistic,
 * not guaranteed-unique by construction) but is the actual shipped design;
 * this test proves that at real concurrency it does not, in practice,
 * produce colliding numbers or dropped/failed inserts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerHotspotConsumers } from "../src/modules/hotspots/consumer.js";
import * as complaintsRepo from "../src/modules/complaints/repo.js";
import * as hotspotsRepo from "../src/modules/hotspots/repo.js";
import { runWithTenant } from "@civitasone/db";
import { hdr, waitFor, ADMIN_ROLES, USER_ROLES, TENANT_A } from "./support.js";

// repo.findById() runs through `db`, which is wrapped with tenant-GUC
// injection (see shared/db.ts / @civitasone/db's wrapWithTenantGuc): it only
// sets the `app.tenant_id` GUC that FORCE ROW LEVEL SECURITY depends on when
// called from inside a matching runWithTenant(...) (or a live HTTP request's
// onRequest hook) context. Calling repo.findById() bare here, outside any
// such context, would not error -- it would just silently see zero rows
// (RLS-filtered), which is a materially different (and much easier to get
// wrong) failure mode than "throws". Always wrap direct repo reads/writes
// used from test code this way.
function findComplaintAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => complaintsRepo.findById(id, TENANT_A));
}
function findHotspotAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => hotspotsRepo.findById(id, TENANT_A));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  registerHotspotConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const complaintBody = { location: { ward: "9" }, complaintType: "overflow" as const, description: "concurrency test" };
const hotspotBody = { location: { ward: "9" }, category: "test", complaintCount: 1, riskScore: 20 };

describe("complaint number generation -- no collisions under concurrency", () => {
  it("50 concurrent POST /v1/drainage/complaints all succeed and persist 50 distinct complaint_numbers -- zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(randomUUID(), TENANT_A, USER_ROLES), payload: complaintBody }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    const ids = responses.map((r) => (r.json() as { id: string }).id);
    // Poll (not a fixed sleep) until every one of the 50 rows has actually
    // landed -- under contention from other test files/DB activity running
    // concurrently, 50 consumer-processed inserts can legitimately take
    // longer than any single fixed delay would assume.
    await waitFor(async () => {
      const rows = await Promise.all(ids.map((id) => findComplaintAsTenantA(id)));
      return rows.every((r) => r != null);
    }, 15000);

    const numbers = await Promise.all(ids.map((id) => findComplaintAsTenantA(id).then((row) => row?.complaintNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50);
  });
});

describe("hotspot code generation -- no collisions under concurrency", () => {
  it("50 concurrent POST /v1/drainage/hotspots all succeed and persist 50 distinct hotspot_codes -- zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: "POST", url: "/v1/drainage/hotspots", headers: hdr(randomUUID(), TENANT_A, ADMIN_ROLES), payload: hotspotBody }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    const ids = responses.map((r) => (r.json() as { id: string }).id);
    await waitFor(async () => {
      const rows = await Promise.all(ids.map((id) => findHotspotAsTenantA(id)));
      return rows.every((r) => r != null);
    }, 15000);

    const codes = await Promise.all(ids.map((id) => findHotspotAsTenantA(id).then((row) => row?.hotspotCode)));
    expect(codes.every((c) => typeof c === "string")).toBe(true);
    expect(new Set(codes).size).toBe(50);
  });
});
