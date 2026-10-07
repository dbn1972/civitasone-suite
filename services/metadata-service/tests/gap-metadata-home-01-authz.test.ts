/**
 * GAP-METADATA-HOME-01: metadata schema routes are schema-admin-only.
 *
 * The audit finding said metadata write routes could not be verified (service
 * "absent" in the snapshot). The service is present now, so this test asserts
 * the actual server-side contract the web layer's new /metadata/layout.tsx gate
 * mirrors: a non-admin (e.g. a plain "employee") is refused 403 on both a read
 * and a write of entity definitions, while a metadata_admin is admitted. This
 * is the real security boundary; the web gate is only defence-in-depth.
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

function hdr(roles: string[]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess" }, SECRET);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
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

describe("GAP-METADATA-HOME-01 — schema routes require a metadata admin role", () => {
  it("401s an unauthenticated entity list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metadata/entities", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(401);
  });

  it("403s a non-admin (employee) listing entities", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metadata/entities", headers: hdr(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("403s a non-admin (employee) creating an entity", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/entities",
      headers: hdr(["employee"]),
      body: JSON.stringify({ apiName: "grievance", label: "Grievance", pluralLabel: "Grievances" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("admits a metadata_admin to list entities (200)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metadata/entities", headers: hdr(["metadata_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("admits a metadata_admin to create an entity (202 accepted)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/entities",
      headers: hdr(["metadata_admin"]),
      body: JSON.stringify({ apiName: `grievance_${Math.floor(Math.random() * 1e6)}`, label: "Grievance", pluralLabel: "Grievances" }),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});
