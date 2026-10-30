/**
 * UAT W8-D (P1 accept-nonexistent): PATCH grievances/:id/resolve and tickets/:id/resolve|close
 * published a command and answered 202 for ANY well-formed id. Each now does a tenant-scoped
 * existence read first: random id or another tenant's row -> 404 and nothing published; a real
 * row of the caller's tenant -> 202 and the command is published. Body validation is unchanged
 * (`note` stays optional, so an empty body on a real row is still accepted). The sibling sweep
 * added grievance assign / actions / escalate and ticket notes / assign (same gap).
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

type Case = {
  name: string; method: "PATCH" | "POST"; url: (id: string) => string; realId: () => string;
  /** a valid body; `note`-only commands accept an empty one */
  payload: Record<string, unknown>;
  /** a body that fails validation, to show validation still runs */
  invalid: Record<string, unknown>;
};
const noteOnly = { payload: {}, invalid: { note: "x".repeat(2001) } };
const cases: Case[] = [
  { name: "grievance resolve", method: "PATCH", url: (id) => `/v1/citizen/grievances/${id}/resolve`, realId: () => ids.grievance, ...noteOnly },
  { name: "ticket resolve", method: "PATCH", url: (id) => `/v1/citizen/tickets/${id}/resolve`, realId: () => ids.ticket, ...noteOnly },
  { name: "ticket close", method: "PATCH", url: (id) => `/v1/citizen/tickets/${id}/close`, realId: () => ids.ticket, ...noteOnly },
  // sibling sweep: the same gap on the other grievance / ticket commands
  { name: "grievance assign", method: "PATCH", url: (id) => `/v1/citizen/grievances/${id}/assign`, realId: () => ids.grievance,
    payload: { assignedTo: randomUUID() }, invalid: { assignedTo: "not-a-uuid" } },
  { name: "grievance action", method: "POST", url: (id) => `/v1/citizen/grievances/${id}/actions`, realId: () => ids.grievance,
    payload: { actionType: "site_visit", note: "w8d" }, invalid: {} },
  { name: "grievance escalate", method: "PATCH", url: (id) => `/v1/citizen/grievances/${id}/escalate`, realId: () => ids.grievance,
    payload: { reason: "w8d no progress" }, invalid: {} },
  { name: "ticket note", method: "POST", url: (id) => `/v1/citizen/tickets/${id}/notes`, realId: () => ids.ticket,
    payload: { body: "w8d note" }, invalid: {} },
  { name: "ticket assign", method: "PATCH", url: (id) => `/v1/citizen/tickets/${id}/assign`, realId: () => ids.ticket,
    payload: { assigneeId: randomUUID() }, invalid: { assigneeId: "not-a-uuid" } },
];

describe("UAT W8-D: citizen command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404 NOT_FOUND, nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: bearer(), payload: c.payload });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: another tenant's real id -> 404 (tenant-scoped read), nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(OTHER_TENANT), payload: c.payload });
      expect(res.statusCode).toBe(404);
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: a real row of this tenant -> 202 and the command is published`, async () => {
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(), payload: c.payload });
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it(`${c.name}: body validation still runs first (invalid body -> 400)`, async () => {
      const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(), payload: c.invalid });
      expect(res.statusCode).toBe(400);
    });
  }
});
