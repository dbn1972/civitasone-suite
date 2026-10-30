/**
 * UAT W8-C (live API sweep, platform package) — metadata-service.
 *
 * 1. POST /v1/metadata/config/import answered 500 for {} / unknown fields: registerSchemaErrorHandler ran
 *    AFTER the route plugins, and the config module has no handler of its own, so the ZodError fell
 *    through to Fastify's default 500.
 * 2. PATCH /v1/metadata/{entities,fields,validation-rules}/:id published (or queued) the update without
 *    reading the row: a random id got 202. Now a tenant-scoped read first -> 404, nothing published.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerConsumersOnce, drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "8c000000-0000-4000-8000-0000000003a1";
const OTHER_TENANT = "8c000000-0000-4000-8000-0000000003b2";
const ACTOR = "8c000000-0000-4000-8000-0000000003c3";
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

function hdr(tenant = TENANT) {
  const t = signToken({ sub: ACTOR, tid: tenant, roles: ["metadata_admin"], sid: "s" }, SECRET);
  return { authorization: `Bearer ${t}`, "content-type": "application/json" };
}

let app: FastifyInstance;
const ids = { entity: randomUUID(), field: "", rule: "" };

async function wipe(): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM metadata.validation_rules WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM metadata.field_definitions WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM metadata.entity_definitions WHERE tenant_id = ${TENANT}`;
  });
}

beforeAll(async () => {
  registerConsumersOnce();
  app = await buildApp();
  await wipe();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO metadata.entity_definitions (id, tenant_id, api_name, label, plural_label, created_by, updated_by)
      VALUES (${ids.entity}, ${TENANT}, ${"w8c_entity"}, ${"W8C"}, ${"W8Cs"}, ${ACTOR}, ${ACTOR})`;
  });
  const f = await app.inject({ method: "POST", url: `/v1/metadata/entities/${ids.entity}/fields`, headers: hdr(), payload: { apiName: "status", label: "Status", fieldType: "text" } });
  expect(f.statusCode).toBe(202);
  ids.field = f.json().data.id;
  const r = await app.inject({ method: "POST", url: `/v1/metadata/entities/${ids.entity}/validation-rules`, headers: hdr(), payload: { name: "r1", expression: "amount > 0", errorMessage: "pos" } });
  expect(r.statusCode).toBe(202);
  ids.rule = r.json().data.id;
  await drainQueue();
});

afterAll(async () => {
  await wipe().catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /v1/metadata/config/import: invalid body -> 400, not a ZodError 500", () => {
  for (const [name, payload] of [["empty body", {}], ["invalid fields", INVALID_FIELDS]] as const) {
    it(name, async () => {
      const res = await app.inject({ method: "POST", url: "/v1/metadata/config/import", headers: hdr(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

const ROUTES = [
  { name: "entities", url: (id: string) => `/v1/metadata/entities/${id}`, id: () => ids.entity, body: { label: "New" } },
  { name: "fields", url: (id: string) => `/v1/metadata/fields/${id}`, id: () => ids.field, body: { label: "Status2" } },
  { name: "validation-rules", url: (id: string) => `/v1/metadata/validation-rules/${id}`, id: () => ids.rule, body: { name: "r1b" } },
];

describe("PATCH on an unknown id -> 404 and nothing published (was 202)", () => {
  for (const r of ROUTES) {
    it(`${r.name}: random id, empty and invalid-field bodies`, async () => {
      const spy = vi.spyOn(queue, "publish");
      for (const payload of [{}, INVALID_FIELDS]) {
        const res = await app.inject({ method: "PATCH", url: r.url(randomUUID()), headers: hdr(), payload });
        expect(res.statusCode).toBe(404);
      }
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${r.name}: another tenant's row -> 404`, async () => {
      const res = await app.inject({ method: "PATCH", url: r.url(r.id()), headers: hdr(OTHER_TENANT), payload: r.body });
      expect(res.statusCode).toBe(404);
    });
    it(`${r.name}: the real row -> 202`, async () => {
      const res = await app.inject({ method: "PATCH", url: r.url(r.id()), headers: hdr(), payload: r.body });
      expect(res.statusCode).toBe(202);
    });
    it(`${r.name}: body validation still runs first (400 on a bad field type)`, async () => {
      const res = await app.inject({ method: "PATCH", url: r.url(r.id()), headers: hdr(), payload: { isActive: "yes" } });
      expect(res.statusCode).toBe(400);
    });
  }
});
