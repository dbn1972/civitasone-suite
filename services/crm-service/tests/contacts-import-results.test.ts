/**
 * GAP-CRM-CONTACTS-IMPORT-04 — bulk-import job status/result endpoint.
 * GAP-CRM-SERVICE-REQUESTS-NEW-04 / GAP-CRM-DEALS-NEW-04 — contact lookup.
 *
 * Real DB (RLS), no mocks. The bulk-import consumer persists per-batch outcomes
 * (accepted / rejected-with-row-number+reason / errored) INSIDE the write
 * transaction; GET /v1/crm/contacts/import/:batchId reads them back. The
 * rejected-rows list must carry only { index, reason } — never any contact PII.
 * The lookup returns id + display name + MASKED phone/email only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { registerContactConsumers } = await import("../src/modules/contacts/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "a11c0000-7777-4000-8000-00000000c0de";
const OTHER_TENANT = "a11c0000-7777-4000-8000-00000000beef";
const ACTOR = "a11c0000-7777-4000-8000-0000000ac70a";

function adminHeaders(tenantId = TENANT) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["crm_admin"], sid: "sess-import-04" }, SECRET)}`,
    "x-tenant-id": tenantId,
    "content-type": "application/json",
  };
}

function userHeaders(tenantId = TENANT) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["crm_user"], sid: "sess-import-04u" }, SECRET)}`,
    "x-tenant-id": tenantId,
    "content-type": "application/json",
  };
}

async function cleanup(): Promise<void> {
  for (const tenant of [TENANT, OTHER_TENANT]) {
    await sqlClient
      .begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
        await tx`DELETE FROM crm.contact_import_batches WHERE tenant_id = ${tenant}`.catch(() => {});
        await tx`DELETE FROM crm.contacts WHERE tenant_id = ${tenant}`.catch(() => {});
      })
      .catch(() => {});
  }
}

let app: FastifyInstance;
let queue: MemoryQueue;

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  await app.ready();
  queue = new MemoryQueue();
  registerContactConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await queue.stop();
  await cleanup();
  await app.close();
  await sqlClient.end();
});

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.bulkImportContacts,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

describe("GAP-CRM-CONTACTS-IMPORT-04 — import batch status/result", () => {
  it("persists accepted/rejected outcomes for a mixed batch and serves them without PII", async () => {
    const batchId = randomUUID();
    const dupEmail = `dup-${batchId.slice(0, 8)}@example.com`;
    // Two rows share an email: the second is a duplicate (skipped). A third row
    // is unique and accepted.
    const contacts = [
      { name: "Asha Rao", email: dupEmail, leadStatus: "new" },
      { name: "Asha Rao (dup)", email: dupEmail, leadStatus: "new" },
      { name: "Vikram Singh", email: `vik-${batchId.slice(0, 8)}@example.com`, leadStatus: "new" },
    ];

    await queue.publish(COMMANDS.bulkImportContacts, makeMsg({ batchId, tenantId: TENANT, contacts }));
    await queue.drain();

    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/import/${batchId}`,
      headers: adminHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.batchId).toBe(batchId);
    expect(body.status).toBe("completed");
    expect(body.total).toBe(3);
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(1);
    // The one duplicate email is reported by row index + a coarse reason.
    expect(Array.isArray(body.rejectedRows)).toBe(true);
    expect(body.rejectedRows).toContainEqual({ index: 1, reason: "duplicate_email" });
    // No PII: the serialised result must not echo any email/name from the rows.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(dupEmail);
    expect(serialised).not.toContain("Asha Rao");
    expect(serialised).not.toContain("Vikram");
  });

  it("404 for an unknown / not-yet-processed batch id (UI treats as 'still processing')", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/import/${randomUUID()}`,
      headers: adminHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("a non-admin CRM user may not read import results (admin-only, matches who may import)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/import/${randomUUID()}`,
      headers: userHeaders(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: another tenant cannot read a batch it did not create", async () => {
    const batchId = randomUUID();
    await queue.publish(
      COMMANDS.bulkImportContacts,
      makeMsg({ batchId, tenantId: TENANT, contacts: [{ name: "Solo", email: `solo-${batchId.slice(0, 8)}@example.com`, leadStatus: "new" }] }),
    );
    await queue.drain();

    const mine = await app.inject({ method: "GET", url: `/v1/crm/contacts/import/${batchId}`, headers: adminHeaders(TENANT) });
    expect(mine.statusCode).toBe(200);

    const theirs = await app.inject({ method: "GET", url: `/v1/crm/contacts/import/${batchId}`, headers: adminHeaders(OTHER_TENANT) });
    expect(theirs.statusCode).toBe(404);
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-NEW-04 / GAP-CRM-DEALS-NEW-04 — contact lookup", () => {
  it("returns id + display name + MASKED phone/email only (never raw PII)", async () => {
    const email = `lookup-${randomUUID().slice(0, 8)}@example.com`;
    const phone = "9876500000";
    const batchId = randomUUID();
    await queue.publish(
      COMMANDS.bulkImportContacts,
      makeMsg({ batchId, tenantId: TENANT, contacts: [{ name: "Lookup Target Org Person", email, phone, company: "Lookup Target Org", leadStatus: "new" }] }),
    );
    await queue.drain();

    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/contacts/lookup?q=Lookup%20Target&limit=10",
      headers: userHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.data.find((r: { name: string }) => r.name === "Lookup Target Org Person");
    expect(row).toBeTruthy();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    // Even a non-admin lookup never returns the raw email/phone.
    expect(row.email).not.toBe(email);
    expect(row.phone).not.toBe(phone);
    // Masking preserves a hint, so it must not be null when a value exists.
    expect(row.email).toBeTruthy();
  });
});
