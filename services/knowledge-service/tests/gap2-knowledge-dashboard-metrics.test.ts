/**
 * GAP2-KNOWLEDGE-DASHBOARD-CAP-01 — GET /v1/knowledge/documents/summary returns
 *   repository-wide counts (not page-capped). Seeding 60 documents must yield
 *   total=60; the old dashboard counted only the first 50 from the list.
 * GAP2-KNOWLEDGE-ASSISTANT-METRICS-01 — GET /v1/knowledge/assistant/metrics is
 *   gated to ADMIN_ROLES; a base knowledge_user must get 403 (was 200).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = randomUUID();
const ACTOR = "cccccccc-0000-4000-8000-00000000f001";

function tok(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dash01" }, SECRET, 3600);
}
const userTok = tok(["knowledge_user"]);
const adminTok = tok(["knowledge_admin"]);

const SEED_COUNT = 60;

let app: FastifyInstance;

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM knowledge.documents WHERE tenant_id = ${TENANT}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (let i = 0; i < SEED_COUNT; i++) {
      const status = i < 40 ? "approved" : i < 50 ? "under_review" : "archived";
      const category = i % 3 === 0 ? "Circular" : "general";
      await sql`
        INSERT INTO knowledge.documents (id, tenant_id, title, category, status, created_by, updated_by)
        VALUES (${randomUUID()}, ${TENANT}, ${"Doc " + i}, ${category}, ${status}, ${ACTOR}, ${ACTOR})`;
    }
  });
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("GAP2-KNOWLEDGE-DASHBOARD-CAP-01 — repository-wide summary", () => {
  it("returns the true total (60), not the capped first-50", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/knowledge/documents/summary",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total: number; active: number; archived: number; circulars: number;
      byCategory: Array<{ category: string; count: number }>;
    };
    expect(body.total).toBe(60);
    // approved(40) + under_review(10) = 50 active, 10 archived.
    expect(body.active).toBe(50);
    expect(body.archived).toBe(10);
    // every 3rd doc (0,3,...,57) → 20 circulars.
    expect(body.circulars).toBe(20);
    const cat = body.byCategory.find((c) => c.category === "Circular");
    expect(cat?.count).toBe(20);
  });
});

describe("GAP2-KNOWLEDGE-ASSISTANT-METRICS-01 — metrics gated to admins", () => {
  it("a base knowledge_user is forbidden from /assistant/metrics", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/knowledge/assistant/metrics",
      headers: { authorization: `Bearer ${userTok}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a knowledge_admin may read /assistant/metrics", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/knowledge/assistant/metrics",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
