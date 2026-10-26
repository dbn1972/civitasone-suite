/**
 * GAP-ESTAB-MEETINGS-DETAIL-04 (owner decision #30): the MOM is produced through meeting-service's
 * existing minutes workflow (draft -> approve) and LINKED from the estab meeting. estab-service keeps
 * the link (governance_meeting_id); it never re-implements minutes. Real DB + consumers.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0ff33aa-0000-4000-8000-000000000d30";
const OTHER_TENANT = "c0ff33aa-0000-4000-8000-000000000d31";
const ACTOR = randomUUID();
const COMMITTEE = randomUUID();
const MEETING_A = randomUUID();
const MEETING_B = randomUUID();
const GOV_1 = randomUUID();
const GOV_2 = randomUUID();
const LINK_TOPIC = "estab.meeting.link_governance";

const tok = (tid = TENANT, roles = ["estab_officer"]) => signToken({ sub: ACTOR, tid, roles, sid: "sess-d30" }, SECRET);
const hdr = (tid = TENANT, roles?: string[]) => ({ authorization: `Bearer ${tok(tid, roles)}`, "x-tenant-id": tid, "content-type": "application/json" });

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;
let q: Queue;

async function clean(tenant: string) {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    await sql`DELETE FROM committee.estab_meetings WHERE tenant_id = ${tenant}`;
    await sql`DELETE FROM committee.estab_committees WHERE tenant_id = ${tenant}`;
  });
}

beforeAll(async () => {
  await clean(TENANT);
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO committee.estab_committees (id, tenant_id, name, chair_ref, status, created_by, updated_by)
      VALUES (${COMMITTEE}, ${TENANT}, 'Establishment Committee', ${ACTOR}, 'active', ${ACTOR}, ${ACTOR})`;
    for (const [id, title] of [[MEETING_A, "Q1 Review"], [MEETING_B, "Q2 Review"]] as const) {
      await sql`INSERT INTO committee.estab_meetings (id, tenant_id, committee_id, title, when_at, status, created_by, updated_by)
        VALUES (${id}, ${TENANT}, ${COMMITTEE}, ${title}, '2026-03-01T10:00:00Z', 'completed', ${ACTOR}, ${ACTOR})`;
    }
  });
  app = await buildApp();
  q = wire(new MemoryQueue());
  registerCommitteeConsumers(q);
  await q.start();
});
afterAll(async () => {
  await q.stop();
  await app.close();
  await clean(TENANT);
  await sqlClient.end();
});

const settle = () => new Promise<void>((r) => setTimeout(r, 600));
const link = (meetingId: string, governanceMeetingId: string | null, tid = TENANT, messageId = randomUUID()) =>
  q.publish(LINK_TOPIC, { messageId, type: LINK_TOPIC, tenantId: tid, actorId: ACTOR, correlationId: `c-${messageId}`, schemaVersion: "1.0", payload: { meetingId, tenantId: tid, governanceMeetingId } });
const detail = async (id: string, tid = TENANT) => app.inject({ method: "GET", url: `/v1/estab/meetings/${id}`, headers: hdr(tid) });

describe("estab meeting -> governance meeting link (owner decision #30)", () => {
  it("an unlinked meeting reports no governance link (explicit null, not a made-up id)", async () => {
    const res = await detail(MEETING_A);
    expect(res.statusCode).toBe(200);
    expect(res.json().governanceMeetingId ?? null).toBeNull();
  });

  it("the link route accepts a valid link and publishes the command (CQRS 202)", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    const res = await app.inject({ method: "PATCH", url: `/v1/estab/meetings/${MEETING_A}/governance-link`, headers: hdr(), payload: { governanceMeetingId: GOV_1 } });
    expect(res.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === LINK_TOPIC);
    expect(call?.[1].payload).toMatchObject({ meetingId: MEETING_A, governanceMeetingId: GOV_1 });
    spy.mockRestore();
  });

  it("validates and authorises: bad uuid 400, unknown meeting 404, other tenant 404, non-estab role 403, no token 401", async () => {
    const url = `/v1/estab/meetings/${MEETING_A}/governance-link`;
    expect((await app.inject({ method: "PATCH", url, headers: hdr(), payload: { governanceMeetingId: "nope" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/estab/meetings/${randomUUID()}/governance-link`, headers: hdr(), payload: { governanceMeetingId: GOV_1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url, headers: hdr(OTHER_TENANT), payload: { governanceMeetingId: GOV_1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url, headers: hdr(TENANT, ["citizen"]), payload: { governanceMeetingId: GOV_1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url, payload: { governanceMeetingId: GOV_1 } })).statusCode).toBe(401);
  });

  it("the consumer persists the link and the meeting detail reports it", async () => {
    await link(MEETING_A, GOV_1);
    await settle();
    const res = await detail(MEETING_A);
    expect(res.json().governanceMeetingId).toBe(GOV_1);
  });

  it("one governance meeting cannot be linked to two estab meetings (route 409; consumer refuses too)", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/estab/meetings/${MEETING_B}/governance-link`, headers: hdr(), payload: { governanceMeetingId: GOV_1 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_LINK");
    await link(MEETING_B, GOV_1); // a stale command that slipped past the route
    await settle();
    expect((await detail(MEETING_B)).json().governanceMeetingId ?? null).toBeNull();
  });

  it("a link can be moved to another governance meeting and cleared with null", async () => {
    await link(MEETING_A, GOV_2);
    await settle();
    expect((await detail(MEETING_A)).json().governanceMeetingId).toBe(GOV_2);
    await link(MEETING_A, null);
    await settle();
    expect((await detail(MEETING_A)).json().governanceMeetingId ?? null).toBeNull();
  });

  it("a link command for another tenant's meeting changes nothing", async () => {
    await link(MEETING_A, GOV_1, OTHER_TENANT);
    await settle();
    expect((await detail(MEETING_A)).json().governanceMeetingId ?? null).toBeNull();
  });

  it("every applied link is audited", async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' AND payload->>'action' = 'link_governance_meeting'`;
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
