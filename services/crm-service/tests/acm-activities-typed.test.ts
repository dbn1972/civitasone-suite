/**
 * AC-001 typed activities + reminders. HTTP -> bus -> consumer -> DB round-trips
 * through the real activity create route and list read path.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000ac001";
const ACTOR = "cccccccc-3333-4000-8000-0000000ac001";
const CONTACT = "22222222-bbbb-4000-8000-0000000ac001";

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "x-tenant-id": TENANT };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${CONTACT}, ${TENANT}, 'ACM Contact', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
             ON CONFLICT (id) DO NOTHING`;
  });
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function create(payload: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: headers(), payload });
  await app.close();
  await drainQueue();
  return res;
}

async function listForContact() {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/crm/activities?limit=50&offset=0`, headers: headers() });
  await app.close();
  return res.json().data as Array<Record<string, unknown>>;
}

describe("AC-001 typed activities + reminders", () => {
  for (const type of ["task", "call", "meeting", "appointment", "note", "reminder"]) {
    it(`creates a '${type}' activity and applies it`, async () => {
      const res = await create({ text: `${type} body`, type, contactId: CONTACT });
      expect(res.statusCode).toBe(202);
      const id = res.json().id;
      const row = (await listForContact()).find((r) => r.id === id);
      expect(row, `activity ${id} was never applied`).toBeDefined();
      expect(row!.type).toBe(type);
    });
  }

  it("persists remind_at on a reminder", async () => {
    const remindAt = "2026-09-01T09:30:00.000Z";
    const res = await create({ text: "call the vendor back", type: "reminder", contactId: CONTACT, remindAt });
    const row = (await listForContact()).find((r) => r.id === res.json().id);
    expect(new Date(String(row!.remindAt)).toISOString()).toBe(remindAt);
  });

  it("persists location on a meeting", async () => {
    const res = await create({ text: "kickoff", type: "meeting", contactId: CONTACT, location: "Conf Room 4, Delhi" });
    const row = (await listForContact()).find((r) => r.id === res.json().id);
    expect(row!.location).toBe("Conf Room 4, Delhi");
  });

  it("rejects an unknown activity type (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: headers(), payload: { text: "x", type: "carrier_pigeon" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
