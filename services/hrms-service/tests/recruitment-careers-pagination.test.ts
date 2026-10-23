/**
 * GET /v1/careers/vacancies used to .limit(100) with no total/offset, silently
 * dropping every opening past the 100th. Real-Postgres regression: it now pages
 * with limit/offset and returns `total`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const TENANT = randomUUID();
const DEPT = randomUUID();
const ACTOR = randomUUID();
const TOTAL_PUBLISHED = 105;

let app: FastifyInstance;
let db: postgres.Sql;

async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT}', true)`);
    return fn(tx);
  });
}

const get = (qs = "") =>
  app.inject({ method: "GET", url: `/v1/careers/vacancies${qs}`, headers: { "x-tenant-id": TENANT } });

beforeAll(async () => {
  db = postgres(process.env.DATABASE_URL!, { max: 3 });
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.unsafe(
      `INSERT INTO recruitment.hrms_job_openings (tenant_id, ref_no, title, department_id, is_published, status, created_by, updated_by)
       SELECT '${TENANT}', 'PG-' || g, 'Opening ' || g, '${DEPT}', true, 'open', '${ACTOR}', '${ACTOR}'
       FROM generate_series(1, ${TOTAL_PUBLISHED}) g`,
    );
    // Not listed: unpublished, and published-but-closed.
    await tx.unsafe(
      `INSERT INTO recruitment.hrms_job_openings (tenant_id, ref_no, title, department_id, is_published, status, created_by, updated_by) VALUES
       ('${TENANT}', 'PG-U', 'Unpublished', '${DEPT}', false, 'open', '${ACTOR}', '${ACTOR}'),
       ('${TENANT}', 'PG-C', 'Closed', '${DEPT}', true, 'cancelled', '${ACTOR}', '${ACTOR}')`,
    );
  });
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM recruitment.hrms_job_openings WHERE tenant_id = ${TENANT}`);
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

describe("public careers vacancies pagination", () => {
  it("first page is capped at 100 but reports the true total (no silent truncation)", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; total: number; limit: number; offset: number };
    expect(body.data).toHaveLength(100);
    expect(body.total).toBe(TOTAL_PUBLISHED);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
  });

  it("paging with offset reaches every opening exactly once", async () => {
    const seen = new Set<string>();
    for (let offset = 0; offset < TOTAL_PUBLISHED; offset += 100) {
      const body = (await get(`?limit=100&offset=${offset}`)).json() as { data: Array<{ id: string }> };
      for (const v of body.data) seen.add(v.id);
    }
    expect(seen.size).toBe(TOTAL_PUBLISHED);
  });

  it("a small page size is honoured and pages are disjoint", async () => {
    const a = (await get("?limit=10&offset=0")).json() as { data: Array<{ id: string }>; total: number };
    const b = (await get("?limit=10&offset=10")).json() as { data: Array<{ id: string }> };
    expect(a.data).toHaveLength(10);
    expect(a.total).toBe(TOTAL_PUBLISHED);
    expect(b.data.some((v) => a.data.some((x) => x.id === v.id))).toBe(false);
  });

  it("limit above the cap is clamped to 100; a non-numeric limit is a 400", async () => {
    const big = (await get("?limit=500")).json() as { data: unknown[]; limit: number };
    expect(big.limit).toBe(100);
    expect(big.data).toHaveLength(100);
    expect((await get("?limit=abc")).statusCode).toBe(400);
  });

  it("never lists unpublished or closed openings", async () => {
    const body = (await get("?limit=100&offset=100")).json() as { data: Array<{ title: string }>; total: number };
    expect(body.total).toBe(TOTAL_PUBLISHED);
    expect(body.data.map((v) => v.title)).not.toContain("Unpublished");
    expect(body.data.map((v) => v.title)).not.toContain("Closed");
  });
});
