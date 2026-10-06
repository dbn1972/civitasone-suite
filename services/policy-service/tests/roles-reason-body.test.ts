/**
 * GAP-TENANT-ADMIN-ROLES-02 / -DETAIL-04 / -DETAIL-05: the role create, update
 * and add-permission routes accept an optional audited `reason` in the BODY
 * (zod-capped at 500 chars) and the command carries it through to the audit
 * event. Verifies acceptance + the published command payload. Uses buildApp +
 * inject with an HS256 test JWT.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const ROLE_ID = randomUUID();

const adminH = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin"], sid: "s1" }, SECRET, 3600)}`,
  "content-type": "application/json",
});

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("role/permission routes carry an audited reason in the body", () => {
  it("createRole accepts reason and includes it in the command payload", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: "/policy/roles", headers: adminH(), payload: { name: "Auditor", reason: "Quarterly audit access" } });
    expect(res.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.createRole);
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ reason: "Quarterly audit access" });
    spy.mockRestore();
  });

  it("addPermission accepts reason and includes it in the command payload", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: `/policy/roles/${ROLE_ID}/permissions`, headers: adminH(), payload: { resource: "finance", action: "read", effect: "allow", reason: "grant read access" } });
    expect(res.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.addPermission);
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ reason: "grant read access" });
    spy.mockRestore();
  });

  it("rejects a reason longer than 500 chars with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/policy/roles", headers: adminH(), payload: { name: "X", reason: "a".repeat(501) } });
    expect(res.statusCode).toBe(400);
  });
});
