/**
 * UAT W8-C (live API sweep, platform package) — install-service.
 *
 * 1. POST /v1/install/modules/resolve answered 500 for {} / unknown fields: registerSchemaErrorHandler
 *    ran AFTER the route plugins, so the ZodError in module-routes.ts (no local handler) fell through
 *    to Fastify's default 500.
 * 2. POST /v1/install/wizards/:wizardId/steps/:stepKey/{start,complete,skip} published without reading
 *    the wizard: a random id got 202. Now a tenant-scoped read first -> 404 and nothing published.
 * 3. POST /v1/install/stages/3/domain-pack/activate published three commands strictly one after the
 *    other; on UAT each SQS publish costs 3-4.5 s of queue discovery, so the route exceeded the
 *    gateway's 15 s upstream timeout (504). The two install-side commands now go out concurrently and
 *    the citizen command only after both. Unknown body fields are a 400 instead of a real activation.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { CITIZEN_PACK_DOMAIN_ACTIVATE } from "../src/modules/orchestrator/domain-pack-constants.js";
import { wizardDefinitions, stepDefinitions } from "../src/modules/orchestrator/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "8c000000-0000-4000-8000-0000000000a1";
const OTHER_TENANT = "8c000000-0000-4000-8000-0000000000b2";
const ACTOR = "8c000000-0000-4000-8000-0000000000c3";
const WIZARD = randomUUID();
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

const headers = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["install_admin"] }, SECRET, 3600)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(wizardDefinitions).values({ id: WIZARD, tenantId: TENANT, name: "W8C wizard", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(stepDefinitions).values({ tenantId: TENANT, wizardId: WIZARD, stepKey: "one", title: "One", handlerType: "manual", sortOrder: 0, createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(stepDefinitions).where(eq(stepDefinitions.wizardId, WIZARD));
    await tx.delete(wizardDefinitions).where(eq(wizardDefinitions.id, WIZARD));
  })).catch(() => undefined);
  await app.close();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /v1/install/modules/resolve: invalid body -> 400, not a ZodError 500", () => {
  for (const [name, payload] of [["empty body", {}], ["invalid fields", INVALID_FIELDS]] as const) {
    it(name, async () => {
      const res = await app.inject({ method: "POST", url: "/v1/install/modules/resolve", headers: headers(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
  it("a valid selection still resolves (200)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/install/modules/resolve", headers: headers(), payload: { selected: [] } });
    expect(res.statusCode).toBe(200);
  });
});

describe("wizard step commands: existence read before publishing", () => {
  for (const verb of ["start", "complete", "skip"]) {
    it(`${verb}: random wizard -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      for (const payload of [{}, INVALID_FIELDS]) {
        const res = await app.inject({ method: "POST", url: `/v1/install/wizards/${randomUUID()}/steps/one/${verb}`, headers: headers(), payload });
        expect(res.statusCode).toBe(404);
      }
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${verb}: a step the wizard does not define -> 404`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/install/wizards/${WIZARD}/steps/nope/${verb}`, headers: headers(), payload: {} });
      expect(res.statusCode).toBe(404);
    });
    it(`${verb}: another tenant's wizard -> 404 (RLS + tenant filter)`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/install/wizards/${WIZARD}/steps/one/${verb}`, headers: headers(OTHER_TENANT), payload: {} });
      expect(res.statusCode).toBe(404);
    });
    it(`${verb}: the real wizard step -> 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue("m");
      const res = await app.inject({ method: "POST", url: `/v1/install/wizards/${WIZARD}/steps/one/${verb}`, headers: headers(), payload: {} });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  }
});

describe("POST /v1/install/stages/3/domain-pack/activate", () => {
  it("unknown body fields -> 400 and nothing is published (was a real activation with the defaults)", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: "/v1/install/stages/3/domain-pack/activate", headers: headers(), payload: INVALID_FIELDS });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("publishes the record + stage commands concurrently, and the citizen command only after both resolved", async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(queue, "publish").mockImplementation(async (topic: string) => {
      events.push(`start:${topic}`);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      events.push(`end:${topic}`);
      return "m";
    });
    const res = await app.inject({ method: "POST", url: "/v1/install/stages/3/domain-pack/activate", headers: headers(), payload: { domainPackKey: "municipal-in-v1" } });
    expect(res.statusCode).toBe(202);
    // Sequential publishing (the 504 root cause) never has two publishes in flight.
    expect(maxInFlight).toBe(2);
    const citizenStart = events.indexOf(`start:${CITIZEN_PACK_DOMAIN_ACTIVATE}`);
    expect(citizenStart).toBeGreaterThan(events.indexOf(`end:${COMMANDS.recordDomainPackActivation}`));
    expect(citizenStart).toBeGreaterThan(events.indexOf(`end:${COMMANDS.createStage}`));
  });
});
