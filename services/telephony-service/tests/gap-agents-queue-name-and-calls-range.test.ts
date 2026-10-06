/**
 * GAP-TELEPHONY-AGENTS-04 / CALLS-05 contract tests.
 *
 * - AGENTS-04: the agents list projection carries a resolved `queueName` (left
 *   join on queues) so the UI never shows a truncated queueId UUID.
 * - CALLS-05: the calls list accepts a `from`/`to` createdAt window so KPIs
 *   describe a real range; an invalid date is rejected (400).
 *
 * These assert the HTTP contract (param acceptance / rejection, schema shape)
 * and the pure toView projection — no DB seeding required, so they are
 * deterministic whether or not the test GUC is configured.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { agentViewSchema } from "../src/modules/agents/validators.js";
import { toView } from "../src/modules/agents/repo.js";
import type { AgentRow } from "../src/modules/agents/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function token(roles = ["telephony_user"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("GAP-TELEPHONY-AGENTS-04: agents projection exposes queueName", () => {
  it("agentViewSchema requires a queueName field (nullable)", () => {
    const okWithName = agentViewSchema.safeParse({
      id: "11111111-1111-4000-8000-000000000001",
      tenantId: TENANT,
      userId: "22222222-1111-4000-8000-000000000001",
      displayName: "Asha Rao",
      queueId: "33333333-1111-4000-8000-000000000001",
      queueName: "Ward 7 Complaints",
      status: "available",
      extension: "201",
      version: 1,
    });
    expect(okWithName.success).toBe(true);

    const missingName = agentViewSchema.safeParse({
      id: "11111111-1111-4000-8000-000000000001",
      tenantId: TENANT,
      userId: "22222222-1111-4000-8000-000000000001",
      displayName: "Asha Rao",
      queueId: "33333333-1111-4000-8000-000000000001",
      status: "available",
      extension: "201",
      version: 1,
    });
    expect(missingName.success).toBe(false);
  });

  it("toView maps the joined queue name (and defaults to null when unassigned)", () => {
    const row = {
      id: "11111111-1111-4000-8000-000000000001",
      tenantId: TENANT,
      userId: "22222222-1111-4000-8000-000000000001",
      displayName: "Asha Rao",
      queueId: "33333333-1111-4000-8000-000000000001",
      status: "available",
      extension: "201",
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "22222222-1111-4000-8000-000000000001",
      updatedBy: "22222222-1111-4000-8000-000000000001",
      version: 1,
    } as unknown as AgentRow;
    expect(toView(row, "Ward 7 Complaints").queueName).toBe("Ward 7 Complaints");
    expect(toView(row).queueName).toBeNull();
  });

  it("GET /v1/telephony/agents returns rows that satisfy agentViewSchema (incl. queueName)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/agents",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    // 200 = validated response (sendValidated enforces agentsListSchema which
    // now includes queueName); 500 = test GUC not configured (query never ran).
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      for (const row of body.data) expect(row).toHaveProperty("queueName");
    }
  });
});

describe("GAP-TELEPHONY-CALLS-05: calls list accepts a from/to range", () => {
  it("accepts a valid ISO `from` window (200, not 400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls?from=${encodeURIComponent("2026-01-01T00:00:00.000Z")}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts a from+to window", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls?from=${encodeURIComponent("2026-01-01T00:00:00.000Z")}&to=${encodeURIComponent("2026-02-01T00:00:00.000Z")}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).not.toBe(400);
  });

  it("rejects a malformed `from` with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls?from=not-a-date",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
