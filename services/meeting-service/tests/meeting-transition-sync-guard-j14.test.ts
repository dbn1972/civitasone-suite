/**
 * UAT J14 / D9: POST /v1/meetings/:meetingId/transition answered 202 for any
 * target state and left the state machine to the async consumer, so the
 * console's "Start meeting" on a scheduled meeting (an edge the machine does
 * not have) was "accepted" and then silently dead-lettered. The route now
 * refuses an edge that does not exist with 422 MEETING_INVALID_TRANSITION and
 * the allowed targets; a valid edge is still queued (202).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const DRAFT = randomUUID();
const SCHEDULED = randomUUID();

const auth = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["committee_chairperson"], sid: "s-j14" }, SECRET)}` });

async function seedMeeting(id: string, status: string): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, status, chairperson_id, secretary_id, scheduled_at, version, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'committee', 'J14 guard', ${status}, ${ACTOR}, ${ACTOR}, '2027-01-15T05:30:00Z', 1, ${ACTOR}, ${ACTOR})`;
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  await seedMeeting(DRAFT, "draft");
  await seedMeeting(SCHEDULED, "scheduled");
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

const post = (id: string, to: string) =>
  app.inject({ method: "POST", url: `/v1/meetings/${id}/transition`, headers: auth(), payload: { version: 1, to } });

describe("meeting transition: structural check at the route (UAT J14 / D9)", () => {
  it("refuses scheduled -> in_progress (agenda must be locked first) with 422 and the allowed targets", async () => {
    const res = await post(SCHEDULED, "in_progress");
    expect(res.statusCode).toBe(422);
    const body = res.json() as { code: string; details?: { allowed?: string[] } };
    expect(body.code).toBe("MEETING_INVALID_TRANSITION");
    expect(JSON.stringify(body)).toContain("agenda_locked");
  });

  it("refuses draft -> in_progress", async () => {
    expect((await post(DRAFT, "in_progress")).statusCode).toBe(422);
  });

  it("still queues a valid edge (draft -> scheduled, scheduled -> agenda_locked)", async () => {
    expect((await post(DRAFT, "scheduled")).statusCode).toBe(202);
    expect((await post(SCHEDULED, "agenda_locked")).statusCode).toBe(202);
  });
});
