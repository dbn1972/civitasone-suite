/**
 * UAT W6 P1 (accept-nonexistent): PATCH saved view and PATCH automation rule used
 * to publish and answer 202 for ANY well-formed id. They now read the row first
 * (tenant-scoped): unknown / other-tenant / invisible → 404, nothing published;
 * a real row still gets 202 and the command is published.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS, VIEW_COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const SOMEONE_ELSE = randomUUID();

const headers = (tid = TENANT, sub = ACTOR) => ({
  authorization: `Bearer ${signToken({ sub, tid, roles: ["helpdesk_admin"], sid: "sess-w6b" }, SECRET, 3600)}`,
  "x-tenant-id": tid,
});

const ids = { view: randomUUID(), privateView: randomUUID(), rule: randomUUID() };

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM helpdesk.saved_views WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM helpdesk.automation_rules WHERE tenant_id = ${TENANT}`;
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  await cleanup();
  await scoped(async (tx) => {
    await tx`INSERT INTO helpdesk.saved_views (id, tenant_id, owner_id, name)
             VALUES (${ids.view}, ${TENANT}, ${ACTOR}, 'w6b view')`;
    await tx`INSERT INTO helpdesk.saved_views (id, tenant_id, owner_id, name, shared)
             VALUES (${ids.privateView}, ${TENANT}, ${SOMEONE_ELSE}, 'w6b private view', false)`;
    await tx`INSERT INTO helpdesk.automation_rules (id, tenant_id, name, ordinal, trigger, actions, created_by, updated_by)
             VALUES (${ids.rule}, ${TENANT}, 'w6b rule', 1, ${tx.json({ event: "ticket.created" })},
                     ${tx.json([{ type: "set_priority", value: "high" }])}, ${ACTOR}, ${ACTOR})`;
  });
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; url: (id: string) => string; real: string; payload: unknown; topic: string };
const cases: Case[] = [
  { name: "PATCH /v1/helpdesk/tickets/views/:id", url: (id) => `/v1/helpdesk/tickets/views/${id}`, real: ids.view, payload: { name: "Renamed" }, topic: VIEW_COMMANDS.update },
  { name: "PATCH /v1/helpdesk/automation/rules/:id", url: (id) => `/v1/helpdesk/automation/rules/${id}`, real: ids.rule, payload: { name: "Renamed" }, topic: COMMANDS.automationRuleUpdate },
];

describe("UAT W6 P1 — helpdesk commands on non-existent ids", () => {
  for (const c of cases) {
    it(`${c.name}: random id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: "PATCH", url: c.url(randomUUID()), headers: headers(), payload: c.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${c.name}: another tenant's id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: "PATCH", url: c.url(c.real), headers: headers(OTHER_TENANT), payload: c.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${c.name}: real id → 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: "PATCH", url: c.url(c.real), headers: headers(), payload: c.payload as object });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(c.topic);
    });
  }

  it("PATCH view: someone else's PRIVATE view is invisible → 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({ method: "PATCH", url: `/v1/helpdesk/tickets/views/${ids.privateView}`, headers: headers(), payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
