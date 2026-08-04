/**
 * AC-003 structured communication log. HTTP -> consumer -> DB round-trips + a
 * cross-tenant RLS isolation check on the read path.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000c0003";
const OTHER = "aaaaaaaa-1111-4000-8000-0000000c9999";
const ACTOR = "cccccccc-3333-4000-8000-0000000c0003";
const SUBJECT = "22222222-bbbb-4000-8000-0000000c0003";

function headers(tenant = TENANT, roles = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`, "x-tenant-id": tenant };
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM crm.communications WHERE tenant_id = ${t}`.catch(() => {});
    }).catch(() => {});
  }
}

beforeAll(async () => { await cleanup(); registerAllConsumers(queue); await queue.start(); });
afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function log(payload: Record<string, unknown>, tenant = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/crm/communications", headers: headers(tenant), payload });
  await app.close();
  await drainQueue();
  return res;
}

async function list(subjectId = SUBJECT, tenant = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/crm/communications?subjectType=contact&subjectId=${subjectId}`, headers: headers(tenant) });
  await app.close();
  return res;
}

describe("AC-003 communication log", () => {
  it("logs a communication (202) and reads it back", async () => {
    const res = await log({ subjectType: "contact", subjectId: SUBJECT, direction: "outbound", channel: "email", outcome: "left voicemail", disposition: "follow_up", summary: "intro email", occurredAt: "2026-08-01T10:00:00.000Z" });
    expect(res.statusCode).toBe(202);
    const body = (await list()).json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].direction).toBe("outbound");
    expect(body.data[0].channel).toBe("email");
    expect(body.data[0].outcome).toBe("left voicemail");
  });

  it("returns communications in reverse-chronological order", async () => {
    await log({ subjectType: "contact", subjectId: SUBJECT, direction: "inbound", channel: "phone", occurredAt: "2026-08-03T10:00:00.000Z" });
    await log({ subjectType: "contact", subjectId: SUBJECT, direction: "outbound", channel: "whatsapp", occurredAt: "2026-08-02T10:00:00.000Z" });
    const data = (await list()).json().data as Array<Record<string, string>>;
    const times = data.map((r) => new Date(r.occurredAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Date(data[0].occurredAt).toISOString()).toBe("2026-08-03T10:00:00.000Z");
  });

  it("rejects an invalid channel (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/crm/communications", headers: headers(), payload: { subjectType: "contact", subjectId: SUBJECT, direction: "inbound", channel: "telepathy" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/crm/communications?subjectType=contact&subjectId=${SUBJECT}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("does not leak another tenant's communications (RLS)", async () => {
    await log({ subjectType: "contact", subjectId: SUBJECT, direction: "outbound", channel: "sms" }, OTHER);
    // Tenant TENANT already has rows for SUBJECT; OTHER must not see them and vice versa.
    const otherView = (await list(SUBJECT, OTHER)).json().data as unknown[];
    expect(otherView.length).toBe(1); // only OTHER's own row
  });
});
