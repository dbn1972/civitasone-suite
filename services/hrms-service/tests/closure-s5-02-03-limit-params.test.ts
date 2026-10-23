/**
 * CLOS-S5-02 / CLOS-S5-03 -- `?limit=` was parsed with a bare Number():
 * "abc" -> NaN and "-5" -> -5. In SQL LIMIT that is a 500; in the combined
 * social feed `slice(0, NaN)` silently returned an empty feed and
 * `slice(0, -5)` dropped the last five items. Bad limits must fall back to the
 * default (or clamp), never 500 or truncate wrongly.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = randomUUID();
const tok = (roles: string[]) =>
  ({ authorization: `Bearer ${signToken({ sub: randomUUID(), tid: T, roles, sid: "s-clos-s5" }, SECRET)}` });

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${T}, true)`;
    for (let i = 0; i < 8; i++) {
      await sql`insert into employee.hrms_social_kudos (id, tenant_id, giver_id, receiver_id, giver_name, receiver_name, message)
                values (${randomUUID()}, ${T}, ${randomUUID()}, ${randomUUID()}, ${"G"}, ${"R"}, ${`kudos ${i}`})`;
    }
  });
});
afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${T}, true)`;
    await sql`delete from employee.hrms_social_kudos where tenant_id = ${T}`;
  });
  await app.close();
  await sqlClient.end();
});

describe("CLOS-S5-02: social feed limit", () => {
  for (const bad of ["abc", "-5", "0", "NaN"]) {
    it(`GET /v1/hrms/kudos/feed?limit=${bad} -> 200 with the default-sized page`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/hrms/kudos/feed?limit=${bad}`, headers: tok(["employee"]) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(8);
    });

    it(`GET /v1/hrms/social/feed?limit=${bad} -> 200, feed neither emptied nor truncated`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/hrms/social/feed?limit=${bad}`, headers: tok(["employee"]) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(8);
    });
  }

  it("a valid limit is still honoured", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/kudos/feed?limit=3", headers: tok(["employee"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(3);
  });
});

describe("CLOS-S5-03: jd-templates limit", () => {
  for (const bad of ["abc", "-1", "0", "NaN"]) {
    it(`GET /v1/hrms/jd-templates?limit=${bad} -> 200, not 500`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/hrms/jd-templates?limit=${bad}`, headers: tok(["hr_admin"]) });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
    });
  }

  it("GET /v1/hrms/jd-templates?limit=500 is capped, not rejected", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/jd-templates?limit=500", headers: tok(["hr_admin"]) });
    expect(res.statusCode).toBe(200);
  });
});
