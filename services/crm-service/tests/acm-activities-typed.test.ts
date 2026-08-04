/**
 * AC-001 typed activities + reminders, and the per-record (subject-scoped) timeline.
 * HTTP -> bus -> consumer -> DB round-trips through the real create route + the
 * subject-scoped list read path. Includes same-tenant isolation + cross-tenant RLS.
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
const OTHER = "aaaaaaaa-1111-4000-8000-0000000ac009";
const ACTOR = "cccccccc-3333-4000-8000-0000000ac001";
const CONTACT = "22222222-bbbb-4000-8000-0000000ac001";
const CONTACT2 = "22222222-bbbb-4000-8000-0000000ac002";
const ACCOUNT = "44444444-aaaa-4000-8000-0000000ac001";

function headers(tenant = TENANT, roles = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`, "x-tenant-id": tenant };
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM crm.activities WHERE tenant_id = ${t}`.catch(() => {});
      await tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`.catch(() => {});
      await tx`DELETE FROM crm.accounts WHERE tenant_id = ${t}`.catch(() => {});
    }).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const c of [CONTACT, CONTACT2]) {
      await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
               VALUES (${c}, ${TENANT}, 'ACM Contact', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
    }
    await tx`INSERT INTO crm.accounts (id, tenant_id, name, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${ACCOUNT}, ${TENANT}, 'ACM Account', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
  });
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function create(payload: Record<string, unknown>, tenant = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: headers(tenant), payload });
  await app.close();
  await drainQueue();
  return res;
}

async function listBySubject(subjectType: string, subjectId: string, tenant = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/crm/activities?subjectType=${subjectType}&subjectId=${subjectId}&limit=50&offset=0`, headers: headers(tenant) });
  await app.close();
  return res;
}

describe("AC-001 typed activities + reminders", () => {
  for (const type of ["task", "call", "meeting", "appointment", "note", "reminder"]) {
    it(`creates a '${type}' activity and applies it`, async () => {
      const res = await create({ text: `${type} body`, type, contactId: CONTACT });
      expect(res.statusCode).toBe(202);
      const id = res.json().id;
      const row = (await listBySubject("contact", CONTACT)).json().data.find((r: { id: string }) => r.id === id);
      expect(row, `activity ${id} was never applied`).toBeDefined();
      expect(row.type).toBe(type);
    });
  }

  it("persists remind_at on a reminder", async () => {
    const remindAt = "2026-09-01T09:30:00.000Z";
    const res = await create({ text: "call the vendor back", type: "reminder", contactId: CONTACT, remindAt });
    const row = (await listBySubject("contact", CONTACT)).json().data.find((r: { id: string }) => r.id === res.json().id);
    expect(new Date(String(row.remindAt)).toISOString()).toBe(remindAt);
  });

  it("persists location on a meeting", async () => {
    const res = await create({ text: "kickoff", type: "meeting", contactId: CONTACT, location: "Conf Room 4, Delhi" });
    const row = (await listBySubject("contact", CONTACT)).json().data.find((r: { id: string }) => r.id === res.json().id);
    expect(row.location).toBe("Conf Room 4, Delhi");
  });

  it("rejects an unknown activity type (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: headers(), payload: { text: "x", type: "carrier_pigeon" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("AC-001 per-record timeline is subject-scoped", () => {
  it("requires subjectType+subjectId (400 without them)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/activities?limit=50&offset=0", headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns ONLY the requested contact's activities (same-tenant isolation)", async () => {
    // CONTACT already has several activities from the tests above.
    const c2 = await create({ text: "only for contact2", type: "note", contactId: CONTACT2 });
    const c2Id = c2.json().id;

    const contact1 = (await listBySubject("contact", CONTACT)).json().data as Array<{ id: string; contactId: string }>;
    expect(contact1.length).toBeGreaterThan(0);
    expect(contact1.every((r) => r.contactId === CONTACT)).toBe(true);
    expect(contact1.map((r) => r.id)).not.toContain(c2Id);

    const contact2 = (await listBySubject("contact", CONTACT2)).json().data as Array<{ id: string }>;
    expect(contact2.map((r) => r.id)).toEqual([c2Id]);
  });

  it("scopes account-subject activities to that account", async () => {
    const res = await create({ text: "account level note", type: "note", accountId: ACCOUNT });
    const id = res.json().id;
    const rows = (await listBySubject("account", ACCOUNT)).json().data as Array<{ id: string; accountId: string }>;
    expect(rows.map((r) => r.id)).toContain(id);
    expect(rows.every((r) => r.accountId === ACCOUNT)).toBe(true);
    // It must NOT appear on an unrelated contact's timeline.
    const onContact = (await listBySubject("contact", CONTACT)).json().data as Array<{ id: string }>;
    expect(onContact.map((r) => r.id)).not.toContain(id);
  });

  it("does not leak another tenant's activities (cross-tenant RLS)", async () => {
    const res = await listBySubject("contact", CONTACT, OTHER);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});
