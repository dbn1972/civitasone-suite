/**
 * UAT W8-D (P1 accept-nonexistent): PATCH grievances/:id/resolve and tickets/:id/resolve|close
 * published a command and answered 202 for ANY well-formed id. Each now does a tenant-scoped
 * existence read first: random id or another tenant's row -> 404 and nothing published; a real
 * row of the caller's tenant -> 202 and the command is published. Body validation is unchanged
 * (`note` stays optional, so an empty body on a real row is still accepted).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { citizenGrievances } from "../src/modules/grievance/schema.js";
import { citizenTickets } from "../src/modules/helpdesk/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const CITIZEN = randomUUID();
const ids = { grievance: randomUUID(), ticket: randomUUID() };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["citizen_officer"], sid: "sess-w8d-citizen" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(TENANT, async (tx) => {
    await tx.insert(citizenGrievances).values({
      id: ids.grievance, tenantId: TENANT, citizenId: CITIZEN, category: "water", subject: "w8d", description: "w8d grievance",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(citizenTickets).values({
      id: ids.ticket, tenantId: TENANT, citizenId: CITIZEN, subject: "w8d", description: "w8d ticket", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(citizenTickets).where(eq(citizenTickets.id, ids.ticket));
    await tx.delete(citizenGrievances).where(eq(citizenGrievances.id, ids.grievance));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; url: (id: string) => string; realId: () => string };
const cases: Case[] = [
  { name: "grievance resolve", url: (id) => `/v1/citizen/grievances/${id}/resolve`, realId: () => ids.grievance },
  { name: "ticket resolve", url: (id) => `/v1/citizen/tickets/${id}/resolve`, realId: () => ids.ticket },
  { name: "ticket close", url: (id) => `/v1/citizen/tickets/${id}/close`, realId: () => ids.ticket },
];

describe("UAT W8-D: citizen command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404 NOT_FOUND, nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: "PATCH", url: c.url(randomUUID()), headers: bearer(), payload: { note: "w8d" } });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: another tenant's real id -> 404 (tenant-scoped read), nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: "PATCH", url: c.url(c.realId()), headers: bearer(OTHER_TENANT), payload: {} });
      expect(res.statusCode).toBe(404);
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: a real row of this tenant -> 202 (empty body still valid) and the command is published`, async () => {
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: "PATCH", url: c.url(c.realId()), headers: bearer(), payload: {} });
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it(`${c.name}: body validation still runs first (oversized note -> 400)`, async () => {
      const res = await app.inject({ method: "PATCH", url: c.url(c.realId()), headers: bearer(), payload: { note: "x".repeat(2001) } });
      expect(res.statusCode).toBe(400);
    });
  }
});
