/**
 * CRM internal bulk-import seam (BRD §9 #12 / LM-005).
 *
 * POST /v1/crm/contacts/bulk/import/internal — service-to-service lead create,
 * authenticated by INTERNAL_SERVICE_SECRET (x-internal + x-service-secret),
 * NOT a user JWT. Reuses commands.bulkImportContacts (DQ-001 dedup preserved)
 * and stamps leadSource = source (MK-002 attribution) on every contact.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

const INTERNAL_SECRET = "test-internal-service-secret";
process.env.INTERNAL_SERVICE_SECRET = INTERNAL_SECRET;

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = randomUUID();

function internalHeaders(tenantId = TENANT, secret = INTERNAL_SECRET) {
  return {
    "x-internal": "1",
    "x-service-secret": secret,
    "x-tenant-id": tenantId,
    "content-type": "application/json",
  };
}

const validContacts = [
  { name: "Asha Rao", email: "asha@example.com", phone: "9876543210", city: "Pune" },
  { name: "Vikram S", email: "vikram@example.com", phone: "9812345678", company: "Vik Ltd" },
];

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("internal bulk-import — auth", () => {
  it("401 without x-internal (a user token cannot reach the internal seam)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/contacts/bulk/import/internal",
      headers: { "content-type": "application/json" },
      payload: { tenantId: TENANT, source: "sftp", contacts: validContacts },
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 with x-internal but a WRONG service secret", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/contacts/bulk/import/internal",
      headers: internalHeaders(TENANT, "wrong-secret"),
      payload: { tenantId: TENANT, source: "sftp", contacts: validContacts },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400 when body tenantId != x-tenant-id", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/contacts/bulk/import/internal",
      headers: internalHeaders(TENANT),
      payload: { tenantId: randomUUID(), source: "sftp", contacts: validContacts },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("internal bulk-import — happy path", () => {
  it("202 accepted; publishes the import command with leadSource = source on every contact", async () => {
    const captured: Array<{ payload: unknown }> = [];
    queue.subscribe(COMMANDS.bulkImportContacts, async (msg: { payload: unknown }) => { captured.push({ payload: msg.payload }); });

    const res = await app.inject({
      method: "POST", url: "/v1/crm/contacts/bulk/import/internal",
      headers: internalHeaders(TENANT),
      payload: { tenantId: TENANT, source: "SFTP Partner X", contacts: validContacts },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");

    // The published command carries the tenant + attributed contacts.
    await new Promise((r) => setTimeout(r, 20));
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const p = captured[captured.length - 1]!.payload as { tenantId: string; contacts: Array<{ name: string; leadSource: string }> };
    expect(p.tenantId).toBe(TENANT);
    expect(p.contacts.length).toBe(2);
    expect(p.contacts.every((c) => c.leadSource === "SFTP Partner X")).toBe(true);
  });

  it("400 on a malformed contact (DQ-003 mobile) — the strict schema still applies", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/contacts/bulk/import/internal",
      headers: internalHeaders(TENANT),
      payload: { tenantId: TENANT, source: "sftp", contacts: [{ name: "Bad", phone: "12345" }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
