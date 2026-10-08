/**
 * COMP-007 -- helpdesk-service `road-hotspot` module (BRD 5.14 ROAD-004:
 * recurring-complaint clusters, maintenance planning, ticket linking) smoke
 * test.
 *
 * Registered as a route only but had zero test references anywhere in the
 * service.
 *
 * Two bugs were found while writing this test:
 *
 * 1. (FIXED -- migration 0042_sanitation_road_hotspot_tables.sql.) MISSING
 *    MIGRATION -- schema.ts declares `helpdesk_road_hotspots` and
 *    `helpdesk_road_hotspot_links`, but no migration created either, so every
 *    route that reads via repo.ts (GET list, GET detail, GET linked-tickets, and
 *    the existence check every mutating route performs before acting) answered
 *    500 with `relation ... does not exist`; this file used to assert that 500.
 *    The read side is now asserted against the real tables below.
 *
 * 2. (STILL OPEN, pinned below as-is.) MISSING CONSUMER -- commands.ts publishes
 *    four commands (helpdesk.road_hotspot.{create,link_ticket,plan_maintenance,
 *    resolve}) but nothing in this service consumes them: worker.ts registers
 *    consumers for tickets, citizen-request, views, breach-risk, automation, sla,
 *    csat, routing, and catalogue -- never road-hotspot, and there is no
 *    `consumer.ts` in this module's directory. Every mutating route publishes
 *    into a queue nothing drains: the 202 "accepted" is the only observable
 *    effect. Building the consumer (domain.ts already has the pure risk-score /
 *    state-machine logic, unused) is feature work, not a test-adding or
 *    schema-repair task.
 *
 * Auth gating (401/403), which fails BEFORE any DB or queue access, is asserted
 * first.
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

describe("COMP-007: road-hotspot -- auth gates that fail BEFORE reaching the database/queue", () => {
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

describe("COMP-007: road-hotspot -- read side against the migrated tables (0042_sanitation_road_hotspot_tables.sql)", () => {
  /** Insert a hotspot row directly (there is no consumer to create one -- see KNOWN ISSUE #2). */
  async function seedHotspot(tid: string, over: { status?: string; category?: string } = {}): Promise<string> {
    const id = randomUUID();
    const actor = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await tx`INSERT INTO helpdesk.helpdesk_road_hotspots
        (id, tenant_id, hotspot_code, location, category, status, complaint_count, risk_score, created_by, updated_by)
        VALUES (${id}, ${tid}, ${"RH-" + id.slice(0, 8)}, ${tx.json({ lat: 12.97, lng: 77.59, ward: "Ward 12", zone: "South", road_name: "MG Road" })},
                ${over.category ?? "pothole"}, ${over.status ?? "identified"}, 4, 60, ${actor}, ${actor})`;
    });
    return id;
  }

  async function seedLink(tid: string, hotspotId: string, ticketId: string): Promise<void> {
    const actor = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await tx`INSERT INTO helpdesk.helpdesk_road_hotspot_links
        (id, tenant_id, hotspot_id, ticket_id, linked_by, created_by, updated_by)
        VALUES (${randomUUID()}, ${tid}, ${hotspotId}, ${ticketId}, ${actor}, ${actor}, ${actor})`;
    });
  }

  it("GET /v1/helpdesk/road-hotspots: a tenant with none gets an empty page, not a 500", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/road-hotspots", headers: authHeaders(["helpdesk_agent"], tid) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("GET list / GET :id / linked-tickets return a persisted hotspot and its links; filters apply", async () => {
    const tid = randomUUID();
    const open = await seedHotspot(tid);
    const resolved = await seedHotspot(tid, { status: "resolved", category: "drain" });
    const ticketId = randomUUID();
    await seedLink(tid, open, ticketId);
    const h = authHeaders(["helpdesk_agent"], tid);

    const list = await app.inject({ method: "GET", url: "/v1/helpdesk/road-hotspots", headers: h });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id).sort()).toEqual([open, resolved].sort());

    const onlyResolved = await app.inject({ method: "GET", url: "/v1/helpdesk/road-hotspots?status=resolved", headers: h });
    expect((onlyResolved.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual([resolved]);

    const one = await app.inject({ method: "GET", url: `/v1/helpdesk/road-hotspots/${open}`, headers: h });
    expect(one.statusCode).toBe(200);
    expect(one.json().data).toMatchObject({ id: open, category: "pothole", status: "identified", complaintCount: 4, riskScore: 60, location: { ward: "Ward 12", road_name: "MG Road" } });

    const links = await app.inject({ method: "GET", url: `/v1/helpdesk/road-hotspots/${open}/linked-tickets`, headers: h });
    expect(links.statusCode).toBe(200);
    expect((links.json() as { data: Array<{ ticketId: string }> }).data.map((l) => l.ticketId)).toEqual([ticketId]);
  });

  it("is tenant-isolated: another tenant cannot see or fetch the hotspot", async () => {
    const owner = randomUUID();
    const id = await seedHotspot(owner);
    const other = authHeaders(["helpdesk_agent"], randomUUID());

    const list = await app.inject({ method: "GET", url: "/v1/helpdesk/road-hotspots", headers: other });
    expect(list.json().data).toEqual([]);
    const one = await app.inject({ method: "GET", url: `/v1/helpdesk/road-hotspots/${id}`, headers: other });
    expect(one.statusCode).toBe(404);
  });

  it("GET :id and linked-tickets answer a real 404 for an unknown hotspot", async () => {
    const h = authHeaders(["helpdesk_agent"], randomUUID());
    for (const url of [`/v1/helpdesk/road-hotspots/${randomUUID()}`, `/v1/helpdesk/road-hotspots/${randomUUID()}/linked-tickets`]) {
      const res = await app.inject({ method: "GET", url, headers: h });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    }
  });

  it("the pre-action existence check is a real 404 for resolve / link-ticket / plan-maintenance on an unknown hotspot", async () => {
    const h = authHeaders(["helpdesk_agent"], randomUUID());
    const id = randomUUID();
    const calls: Array<[string, Record<string, unknown> | undefined]> = [
      [`/v1/helpdesk/road-hotspots/${id}/resolve`, undefined],
      [`/v1/helpdesk/road-hotspots/${id}/link-ticket`, { ticketId: randomUUID() }],
      [`/v1/helpdesk/road-hotspots/${id}/plan-maintenance`, { maintenancePlanRef: "PLAN-1" }],
    ];
    for (const [url, payload] of calls) {
      const res = await app.inject({ method: "POST", url, headers: h, payload });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it("state guards: a resolved hotspot cannot take new ticket links (409)", async () => {
    const tid = randomUUID();
    const id = await seedHotspot(tid, { status: "resolved" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/road-hotspots/${id}/link-ticket`,
      headers: authHeaders(["helpdesk_agent"], tid),
      payload: { ticketId: randomUUID() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("HOTSPOT_RESOLVED");
  });
});

describe("COMP-007: road-hotspot -- KNOWN ISSUE (still open, see file header): missing consumer, creates are accepted but never actually processed", () => {
  it("POST /v1/helpdesk/road-hotspots itself 202s (it only calls queue.publish, no DB access on the happy path) -- but there is no consumer anywhere in this service to ever act on it", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/road-hotspots",
      headers: authHeaders(["helpdesk_agent"], tid),
      payload: hotspotPayload(),
    });
    // Documents the actual (misleading) behavior: the route only publishes a
    // command. With the tables now migrated, the absence of a consumer is
    // directly observable: the hotspot is never created, so a listing for this
    // tenant stays empty after the 202.
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");

    const list = await app.inject({ method: "GET", url: "/v1/helpdesk/road-hotspots", headers: authHeaders(["helpdesk_agent"], tid) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);
  });
});
