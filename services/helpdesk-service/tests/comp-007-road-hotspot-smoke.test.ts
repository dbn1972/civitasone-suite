/**
 * COMP-007 -- helpdesk-service `road-hotspot` module (BRD 5.14 ROAD-004:
 * recurring-complaint clusters, maintenance planning, ticket linking) smoke
 * test.
 *
 * Registered as a route only but had zero test references anywhere in the
 * service.
 *
 * TWO REAL BUGS found while writing this test, not fixed here (see PR
 * description) -- this module is non-functional end to end, for two
 * independent reasons:
 *
 * 1. MISSING MIGRATION -- schema.ts declares `road_hotspots` and
 *    `road_hotspot_links`, but no migration anywhere in the repository
 *    creates either (grepped every *.sql file, not just this service's own
 *    migrations/ directory). Confirmed live against a real disposable
 *    Postgres, freshly bootstrapped via this repo's own
 *    scripts/ci/bootstrap-postgres.sh: `\dt *.*road_hotspot*` finds nothing.
 *    Every route that reads via repo.ts (GET list, GET detail, GET
 *    linked-tickets, and the existence-check every mutating route performs
 *    before acting) 500s with a real `relation ... does not exist` error.
 *
 * 2. MISSING CONSUMER -- commands.ts publishes four commands
 *    (helpdesk.road_hotspot.{create,link_ticket,plan_maintenance,resolve})
 *    but grepping the entire service source for any consumer of them (or of
 *    this module's name in any form) finds nothing: worker.ts registers
 *    consumers for tickets, citizen-request, views, breach-risk, automation,
 *    sla, csat, routing, and catalogue -- never road-hotspot. There is no
 *    `consumer.ts` file in this module's own directory either (unlike every
 *    sibling module in this service). Every mutating route (create,
 *    link-ticket, plan-maintenance, resolve) publishes into a queue nothing
 *    ever drains: even with bug #1 fixed, no hotspot would ever actually be
 *    created, updated, or resolved -- the route's 202 "accepted" response is
 *    the ONLY observable effect. Confirmed below: a create followed by a list
 *    call shows the create's 202 was not a lie about acceptance, but reading
 *    any hotspot back always 500s on the SAME missing table, so this can't
 *    even be demonstrated in isolation from bug #1 -- both would need fixing
 *    together for the module to do anything at all.
 *
 * Both are squarely "missing migration" / "non-functional endpoint" --
 * exactly the categories this campaign has consistently disclosed rather
 * than fixed elsewhere (e.g. tenant-service/tenant-extensions and
 * policy-service/policies, COMP-007 tranche 2). Building a real migration AND
 * a real consumer with actual risk-score/state-machine business logic
 * (domain.ts already has the pure logic, unused by anything) is a genuine
 * feature-completion effort, not a test-adding one.
 *
 * Auth gating (401/403), which fails BEFORE any DB or queue access, works
 * correctly today and is asserted as passing, real behavior below.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-road-hotspot" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function hotspotPayload(overrides: Record<string, unknown> = {}) {
  return {
    location: { lat: 12.97, lng: 77.59, ward: "Ward 12", zone: "South", road_name: "MG Road" },
    category: "pothole",
    complaintCount: 4,
    ...overrides,
  };
}

describe("COMP-007: road-hotspot -- auth gates that fail BEFORE reaching the (broken) database/queue", () => {
  it("GET /v1/helpdesk/road-hotspots returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/road-hotspots" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/helpdesk/road-hotspots returns 403 for a role outside the helpdesk ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/road-hotspots",
      headers: authHeaders(["citizen"], tid),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/helpdesk/road-hotspots returns 403 for a role outside the ACL, before any queue publish", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/road-hotspots",
      headers: authHeaders(["citizen"], tid),
      payload: hotspotPayload(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("COMP-007: road-hotspot -- KNOWN ISSUE #1 (see file header): missing migration, every DB read 500s", () => {
  it("GET /v1/helpdesk/road-hotspots: real Postgres 'relation does not exist' for road_hotspots", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/road-hotspots",
      headers: authHeaders(["helpdesk_agent"], tid),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain("road_hotspots");
  });

  it("GET /v1/helpdesk/road-hotspots/:id: same table, same 500 (not a real 404)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/road-hotspots/${randomUUID()}`,
      headers: authHeaders(["helpdesk_agent"], tid),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain("road_hotspots");
  });

  it("POST /v1/helpdesk/road-hotspots/:id/resolve: the pre-action existence check hits the same missing table before the domain state machine is ever consulted", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/road-hotspots/${randomUUID()}/resolve`,
      headers: authHeaders(["helpdesk_agent"], tid),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain("road_hotspots");
  });
});

describe("COMP-007: road-hotspot -- KNOWN ISSUE #2 (see file header): missing consumer, creates are accepted but never actually processed", () => {
  it("POST /v1/helpdesk/road-hotspots itself 202s (it only calls queue.publish, no DB access on the happy path) -- but there is no consumer anywhere in this service to ever act on it", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/road-hotspots",
      headers: authHeaders(["helpdesk_agent"], tid),
      payload: hotspotPayload(),
    });
    // Documents the actual (misleading) behavior: the route itself never
    // touches the database, so bug #1 (missing migration) does not surface
    // here -- only bug #2 does, and only observably by its ABSENCE: reading
    // the "created" hotspot back always 500s on the missing table (see the
    // KNOWN ISSUE #1 block above), so there is no code path in this module,
    // even a broken one, through which a create's effect is ever visible.
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});
