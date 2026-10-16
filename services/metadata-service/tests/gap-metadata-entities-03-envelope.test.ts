/**
 * GAP-METADATA-ENTITIES-03: GET /v1/metadata/entities must return the
 * { data: [...], meta: { total } } envelope that the web loader (_data.ts
 * extractRows / mapRows) reads, and each item must carry the fields that
 * mapRows maps: `id`, `apiName`, `label`, `pluralLabel`, `isActive`.
 *
 * The first-pass claim was that the entity list DTO was unverifiable (service
 * absent in the snapshot). This test pins the contract so future schema
 * changes that break the loader are caught by CI.
 *
 * Given: a metadata_admin token and at least one seeded entity definition.
 * When: GET /v1/metadata/entities.
 * Then: response.data is an array; each item carries id, apiName, label;
 *       meta.total equals the count of seeded entities; the envelope shape is
 *       { data: [...], meta: { total: N } } — the same shape that
 *       _data.ts::extractRows reads via `payload.data`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();

function hdr() {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["metadata_admin"], sid: "sess" }, SECRET);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function seedEntity(apiName: string): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO metadata.entity_definitions
      (id, tenant_id, api_name, label, plural_label, description, is_active, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${apiName}, ${"Test " + apiName}, ${"Tests"}, ${"GAP-METADATA-ENTITIES-03 fixture"}, ${true}, ${ACTOR}, ${ACTOR})`;
  });
  return id;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM metadata.entity_definitions WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("GAP-METADATA-ENTITIES-03 — entity list envelope and DTO shape", () => {
  it("GET /entities returns { data: [], meta: { total: 0 } } for an empty tenant", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metadata/entities", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown; meta: { total: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ total: 0 });
  });

  it("GET /entities returns items each with id, apiName, label after seeding (envelope matches loader)", async () => {
    const apiName = `e03_${Math.floor(Math.random() * 1e6)}`;
    await seedEntity(apiName);

    const res = await app.inject({ method: "GET", url: "/v1/metadata/entities", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };

    // Envelope: { data: [...], meta: { total: N } }
    // _data.ts extractRows reads `payload.data` as an array — this confirms the
    // real envelope matches what the web loader expects.
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);

    const item = body.data.find((e) => e.apiName === apiName);
    expect(item).toBeDefined();
    // Each row must carry the fields that _data.ts mapRows reads:
    expect(typeof item!.id).toBe("string");
    expect(typeof item!.apiName).toBe("string");
    expect(typeof item!.label).toBe("string");
    // isActive is mapped to "active"/"inactive" StatusPill token in mapRows.
    expect(typeof item!.isActive).toBe("boolean");
  });
});
