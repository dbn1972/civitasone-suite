/**
 * UAT W6 P1 (accept-nonexistent): PATCH contact (admin path), PATCH account and
 * POST lead accept used to publish and answer 202 for ANY well-formed id. They now
 * do a tenant-scoped existence read first: unknown / other-tenant / inactive id →
 * 404 and nothing is published; a real active row still gets 202 + the command.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const headers = (tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["crm_admin"], sid: "sess-w6b" }, SECRET, 3600)}`,
  "x-tenant-id": tid,
});

const ids = { contact: randomUUID(), inactiveContact: randomUUID(), account: randomUUID() };

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`;
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  await cleanup();
  await scoped(async (tx) => {
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, status, created_by, updated_by)
             VALUES (${ids.contact}, ${TENANT}, 'w6b contact', 'active', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, status, created_by, updated_by)
             VALUES (${ids.inactiveContact}, ${TENANT}, 'w6b gone', 'inactive', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO crm.accounts (id, tenant_id, name, status, created_by, updated_by)
             VALUES (${ids.account}, ${TENANT}, 'w6b account', 'active', ${ACTOR}, ${ACTOR})`;
  });
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; method: "PATCH" | "POST"; url: (id: string) => string; real: string; payload: unknown; topic: string };
const cases: Case[] = [
  { name: "PATCH /v1/crm/contacts/:id (admin)", method: "PATCH", url: (id) => `/v1/crm/contacts/${id}`, real: ids.contact, payload: { city: "Pune" }, topic: COMMANDS.updateContact },
  { name: "PATCH /v1/crm/accounts/:id", method: "PATCH", url: (id) => `/v1/crm/accounts/${id}`, real: ids.account, payload: { ownerId: null }, topic: COMMANDS.updateAccount },
  { name: "POST /v1/crm/leads/:id/accept", method: "POST", url: (id) => `/v1/crm/leads/${id}/accept`, real: ids.contact, payload: {}, topic: COMMANDS.acceptLead },
];

describe("UAT W6 P1 — crm commands on non-existent ids", () => {
  for (const c of cases) {
    it(`${c.name}: random id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: headers(), payload: c.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${c.name}: another tenant's id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.real), headers: headers(OTHER_TENANT), payload: c.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${c.name}: real id → 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.real), headers: headers(), payload: c.payload as object });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(c.topic);
    });
  }

  it("PATCH contact / accept lead on an INACTIVE contact → 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const a = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${ids.inactiveContact}`, headers: headers(), payload: { city: "Goa" } });
    const b = await app.inject({ method: "POST", url: `/v1/crm/leads/${ids.inactiveContact}/accept`, headers: headers(), payload: {} });
    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
