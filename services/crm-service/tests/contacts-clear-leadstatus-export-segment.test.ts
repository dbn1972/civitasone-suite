/**
 * Cluster 02 backend gaps (DB-backed, HTTP round-trip through the real consumers):
 *
 *  GAP-CRM-CONTACTS-DETAIL-EDIT-01  PATCH /v1/crm/contacts/:id accepts `null` to
 *      CLEAR email / phone / company / designation / city (and the identifiers),
 *      instead of 400-ing the whole request; absent keys leave a value alone.
 *      `accountId: null` (the edit form clearing the Organisation link) unlinks
 *      the contact from its account instead of 400-ing the whole PATCH.
 *  GAP-CRM-CONTACTS-DETAIL-EDIT-02  the generic PATCH refuses `leadStatus` (status
 *      moves only through POST /v1/crm/leads/:id/transition) and the update
 *      consumer no longer applies one that is already in flight.
 *  GAP-CRM-CONTACTS-01              GET /v1/crm/contacts/export honours the
 *      list's `segment` view (mine / recent), so a "Mine" or "Recent" view does
 *      not export every matching contact; the recent clause no longer escapes
 *      the other filters (unparenthesised OR).
 *
 * Each assertion fails on the previous behaviour.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000c0201";
const ACTOR = "cccccccc-3333-4000-8000-0000000c0201";
const OTHER_OWNER = "dddddddd-4444-4000-8000-0000000c0201";
const ACCOUNT = "eeeeeeee-5555-4000-8000-0000000c0201";

function headers(roles: string[]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function inject(
  method: "GET" | "POST" | "PATCH",
  url: string,
  roles: string[],
  payload?: Record<string, unknown>,
) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(roles), ...(payload ? { payload } : {}) });
  await app.close();
  await drainQueue();
  return res;
}

async function createContact(body: Record<string, unknown>): Promise<string> {
  const res = await inject("POST", "/v1/crm/contacts", ["crm_admin"], body);
  expect(res.statusCode).toBe(202);
  return res.json().id as string;
}

async function rawRow(id: string): Promise<Record<string, unknown>> {
  const rows = await scoped((tx) => tx`SELECT * FROM crm.contacts WHERE id = ${id}`);
  return rows[0] as Record<string, unknown>;
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
  await scoped(
    (tx) => tx`
      INSERT INTO crm.accounts (id, tenant_id, name, status, created_by, updated_by)
      VALUES (${ACCOUNT}, ${TENANT}, 'Unlink Acct', 'active', ${ACTOR}, ${ACTOR})`,
  );
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GAP-CRM-CONTACTS-DETAIL-EDIT-01: PATCH null clears a field", () => {
  it("clears city, company, designation, email and phone, and leaves untouched keys alone", async () => {
    const id = await createContact({
      name: "Clear Me",
      email: "clear.me@example.com",
      phone: "9811100001",
      company: "ClearCo",
      designation: "Manager",
      city: "Pune",
    });
    const before = await rawRow(id);
    expect(before.city).toBe("Pune");
    expect(before.email_idx).toBeTruthy();

    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], {
      city: null,
      company: null,
      designation: null,
      email: null,
      phone: null,
    });
    expect(res.statusCode).toBe(202);

    const after = await rawRow(id);
    expect(after.city).toBeNull();
    expect(after.company).toBeNull();
    expect(after.designation).toBeNull();
    expect(after.email).toBeNull();
    expect(after.phone).toBeNull();
    // the blind index is cleared with the email so the address can be re-used
    expect(after.email_idx).toBeNull();
    expect(after.name).toBe("Clear Me");
    expect(Number(after.version)).toBe(Number(before.version) + 1);
  });

  it("an omitted key is left unchanged (absent = keep, null = clear)", async () => {
    const id = await createContact({ name: "Keep Me", company: "KeepCo", city: "Delhi" });
    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], { city: null });
    expect(res.statusCode).toBe(202);
    const after = await rawRow(id);
    expect(after.city).toBeNull();
    expect(after.company).toBe("KeepCo");
  });

  it("accountId: null unlinks a linked contact (with company cleared in the same PATCH)", async () => {
    // The edit form sends accountId: null (JSON drops undefined) when the
    // Organisation account link is cleared. Before, updateContactBody rejected
    // it ("accountId: Expected string, received null") and the whole PATCH 400ed.
    const id = await createContact({ name: "Unlink Me", company: "Unlink Acct", accountId: ACCOUNT });
    const before = await rawRow(id);
    expect(before.account_id).toBe(ACCOUNT);

    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], {
      accountId: null,
      company: null,
    });
    expect(res.statusCode).toBe(202);

    const after = await rawRow(id);
    expect(after.account_id).toBeNull();
    expect(after.company).toBeNull();
    expect(after.name).toBe("Unlink Me");
    expect(Number(after.version)).toBe(Number(before.version) + 1);
  });

  it("an omitted accountId leaves the account link alone (absent = keep)", async () => {
    const id = await createContact({ name: "Keep Link", accountId: ACCOUNT });
    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], { city: "Goa" });
    expect(res.statusCode).toBe(202);
    const after = await rawRow(id);
    expect(after.account_id).toBe(ACCOUNT);
    expect(after.city).toBe("Goa");
  });

  it("a malformed accountId is still refused (null clears, a non-uuid string does not)", async () => {
    const id = await createContact({ name: "Bad Link" });
    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], { accountId: "not-a-uuid" });
    expect(res.statusCode).toBe(400);
  });

  it("still rejects null for a required / non-clearable field (name)", async () => {
    const id = await createContact({ name: "Needs Name" });
    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], { name: null });
    expect(res.statusCode).toBe(400);
    expect((await rawRow(id)).name).toBe("Needs Name");
  });

  it("still format-validates a present value (a malformed phone is refused)", async () => {
    const id = await createContact({ name: "Bad Phone", phone: "9811100002" });
    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], { phone: "12345" });
    expect(res.statusCode).toBe(400);
  });
});

describe("GAP-CRM-CONTACTS-DETAIL-EDIT-02: lead status only via the governed transition", () => {
  it("PATCH with leadStatus is refused (400 LEAD_STATUS_VIA_TRANSITION) and nothing is written", async () => {
    const id = await createContact({ name: "Status Guard" });
    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_admin"], {
      leadStatus: "disqualified",
      city: "Mumbai",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { fieldErrors?: Array<{ field: string; message: string }> };
    expect(body.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "leadStatus", message: "LEAD_STATUS_VIA_TRANSITION" })]),
    );
    const row = await rawRow(id);
    expect(row.lead_status).toBe("new");
    // the whole PATCH is refused, not half-applied
    expect(row.city).toBeNull();
  });

  it("a crm_user (owner) cannot use PATCH to disqualify their own lead either", async () => {
    const id = await createContact({ name: "Owner Guard" });
    const res = await inject("PATCH", `/v1/crm/contacts/${id}`, ["crm_user"], { leadStatus: "disqualified" });
    expect(res.statusCode).toBe(400);
    expect((await rawRow(id)).lead_status).toBe("new");
  });

  it("an updateContact message already queued with leadStatus applies the other fields but not the status", async () => {
    const id = await createContact({ name: "Inflight" });
    await queue.publish(COMMANDS.updateContact, {
      messageId: randomUUID(),
      type: COMMANDS.updateContact,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, leadStatus: "disqualified", city: "Chennai" },
    });
    await drainQueue();
    const row = await rawRow(id);
    expect(row.city).toBe("Chennai");
    expect(row.lead_status).toBe("new");
  });
});

describe("GAP-CRM-CONTACTS-01: export honours the Mine / Recent view", () => {
  beforeAll(async () => {
    await createContact({ name: "Seg Mine Recent" });
    await createContact({ name: "Seg Other Recent", ownerId: OTHER_OWNER });
    // created_at is immutable once written (system-field trigger), so the aged
    // contact - outside the 30-day activity / 7-day creation "recent" window - is
    // inserted directly with a back-dated created_at.
    const oldId = randomUUID();
    await scoped(
      (tx) => tx`
        INSERT INTO crm.contacts (id, tenant_id, name, owner_id, created_at, created_by, updated_by)
        VALUES (${oldId}, ${TENANT}, 'Seg Mine Old', ${ACTOR}, now() - interval '90 days', ${ACTOR}, ${ACTOR})`,
    );
  });

  const exportCsv = (qs: string) =>
    inject("GET", `/v1/crm/contacts/export?purpose=segment export check&${qs}`, ["crm_admin"]);

  it("segment=mine exports only the caller's contacts", async () => {
    const res = await exportCsv("segment=mine&search=Seg");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Seg Mine Recent");
    expect(res.body).toContain("Seg Mine Old");
    expect(res.body).not.toContain("Seg Other Recent");
  });

  it("without a segment the export still covers everyone (all)", async () => {
    const res = await exportCsv("search=Seg");
    expect(res.body).toContain("Seg Mine Recent");
    expect(res.body).toContain("Seg Other Recent");
    expect(res.body).toContain("Seg Mine Old");
  });

  it("segment=recent drops contacts outside the 30-day / 7-day window", async () => {
    const res = await exportCsv("segment=recent&search=Seg");
    expect(res.body).toContain("Seg Mine Recent");
    expect(res.body).toContain("Seg Other Recent");
    expect(res.body).not.toContain("Seg Mine Old");
  });

  it("segment=recent still obeys the other filters (the OR must not escape the search)", async () => {
    // Pre-fix the unparenthesised OR let any contact created in the last 7 days
    // through regardless of the name search.
    const res = await exportCsv("segment=recent&search=Seg Mine Old");
    expect(res.body).not.toContain("Seg Mine Recent");
    expect(res.body).not.toContain("Seg Other Recent");
  });

  it("segment=mine combined with a status filter ANDs, it does not widen", async () => {
    const res = await exportCsv("segment=mine&search=Seg Other");
    expect(res.body).not.toContain("Seg Other Recent");
  });

  it("an unknown segment value is a 400, not a silent full export", async () => {
    const res = await exportCsv("segment=everything");
    expect(res.statusCode).toBe(400);
  });
});
