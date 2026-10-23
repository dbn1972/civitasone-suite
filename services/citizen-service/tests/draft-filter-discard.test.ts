/**
 * Intake drafts: server-side filtering (the apply landing banner used to download
 * every draft with its formData and filter in the browser) and owner-scoped
 * discard (DELETE), which the apply flow now offers as "Discard draft".
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import * as catalogueRepo from "../src/modules/catalogue/repo.js";

registerApplicationConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const CITIZEN_A = randomUUID();
const CITIZEN_B = randomUUID();
const OFFICER = randomUUID();
const SYSTEM = randomUUID();
const SERVICE_1 = randomUUID();
const SERVICE_2 = randomUUID();
const KEY_1 = `drafts-1-${Date.now().toString(36)}`;
const KEY_2 = `drafts-2-${Date.now().toString(36)}`;

const tok = (actor: string, roles: string[]) =>
  signToken({ sub: actor, tid: TENANT, roles, sid: "sess-drafts" }, SECRET, 3600);
const hdr = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT });

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

describe("intake drafts: server-side filter + owner-scoped discard", () => {
  let app: FastifyInstance;

  async function seedService(serviceId: string, key: string) {
    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await catalogueRepo.insertDefinition(tx, {
          id: randomUUID(), tenantId: TENANT, serviceKey: key, serviceId, name: key,
          servicePattern: "certificate", ownerDepartment: "Licensing", version: 1, status: "published",
          channels: ["portal"], requiredDocuments: [], forms: [], outputs: [], statutoryReferences: [],
          slaDays: 7, publishedBy: SYSTEM, publishedAt: new Date(), createdBy: SYSTEM, updatedBy: SYSTEM,
        });
      });
    });
  }

  async function saveDraft(actor: string, serviceId: string, key: string, formData: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/intake/drafts", headers: hdr(tok(actor, ["citizen"])),
      payload: { serviceId, serviceKey: key, channel: "portal", formData },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await waitFor(async () => (await app.inject({
      method: "GET", url: `/v1/citizen/intake/drafts/${id}`, headers: hdr(tok(actor, ["citizen"])),
    })).statusCode === 200);
    return id;
  }

  beforeAll(async () => {
    app = await buildApp();
    await seedService(SERVICE_1, KEY_1);
    await seedService(SERVICE_2, KEY_2);
  });
  afterAll(async () => {
    await app.close();
    await sqlClient.end();
  });

  it("GET /drafts?serviceId&status&summary returns only matching drafts, without formData", async () => {
    const d1 = await saveDraft(CITIZEN_A, SERVICE_1, KEY_1, { secret_answer: "x" });
    await saveDraft(CITIZEN_A, SERVICE_2, KEY_2, { secret_answer: "y" });

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/intake/drafts?serviceId=${SERVICE_1}&status=draft&summary=true&limit=1`,
      headers: hdr(tok(CITIZEN_A, ["citizen"])),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(d1);
    expect(rows[0].serviceId).toBe(SERVICE_1);
    expect(rows[0]).not.toHaveProperty("formData");

    // Unfiltered list is unchanged: both drafts, with formData.
    const all = await app.inject({ method: "GET", url: "/v1/citizen/intake/drafts", headers: hdr(tok(CITIZEN_A, ["citizen"])) });
    const allRows = all.json().data as Array<Record<string, unknown>>;
    expect(allRows.length).toBeGreaterThanOrEqual(2);
    expect(allRows.every((r) => "formData" in r)).toBe(true);
  });

  it("GET /drafts rejects a malformed serviceId (400)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/citizen/intake/drafts?serviceId=not-a-uuid", headers: hdr(tok(CITIZEN_A, ["citizen"])),
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /drafts/:id discards the owner's draft", async () => {
    const id = await saveDraft(CITIZEN_A, SERVICE_1, KEY_1, { name: "gone" });
    const del = await app.inject({ method: "DELETE", url: `/v1/citizen/intake/drafts/${id}`, headers: hdr(tok(CITIZEN_A, ["citizen"])) });
    expect(del.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({
      method: "GET", url: `/v1/citizen/intake/drafts/${id}`, headers: hdr(tok(CITIZEN_A, ["citizen"])),
    })).statusCode === 404);
  });

  it("DELETE /drafts/:id by another citizen is 404 and leaves the draft intact", async () => {
    const id = await saveDraft(CITIZEN_A, SERVICE_1, KEY_1, { name: "mine" });
    const del = await app.inject({ method: "DELETE", url: `/v1/citizen/intake/drafts/${id}`, headers: hdr(tok(CITIZEN_B, ["citizen"])) });
    expect(del.statusCode).toBe(404);
    await new Promise((r) => setTimeout(r, 150));
    const still = await app.inject({ method: "GET", url: `/v1/citizen/intake/drafts/${id}`, headers: hdr(tok(CITIZEN_A, ["citizen"])) });
    expect(still.statusCode).toBe(200);
  });

  it("DELETE /drafts/:id by an unrelated officer is 404 (read access is not delete access)", async () => {
    const id = await saveDraft(CITIZEN_A, SERVICE_1, KEY_1, { name: "mine" });
    const del = await app.inject({ method: "DELETE", url: `/v1/citizen/intake/drafts/${id}`, headers: hdr(tok(OFFICER, ["citizen_officer"])) });
    expect(del.statusCode).toBe(404);
  });

  it("DELETE /drafts/:id on a missing id is 404", async () => {
    const del = await app.inject({ method: "DELETE", url: `/v1/citizen/intake/drafts/${randomUUID()}`, headers: hdr(tok(CITIZEN_A, ["citizen"])) });
    expect(del.statusCode).toBe(404);
  });
});
