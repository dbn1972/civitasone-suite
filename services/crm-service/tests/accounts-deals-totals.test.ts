/**
 * GAP-CRM-ACCOUNTS-02 + GAP-CRM-PIPELINE-05 — real server totals.
 *
 * Accounts: GET /v1/crm/accounts returns meta.total = tenant-wide active count,
 *   so the UI can show "Showing N of M" rather than guessing from a capped page.
 * Deals: GET /v1/crm/deals returns pagination.total and honours a ?pipelineId
 *   filter, so the pipeline board shows "N of M" scoped to one pipeline.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a2";
const ACTOR = "cccccccc-3333-4000-8000-0000000000a2";
const PIPE_A = "55555555-1111-4000-8000-0000000000a1";
const PIPE_B = "55555555-1111-4000-8000-0000000000a2";

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function cleanup() {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    // 5 active accounts + 1 inactive (inactive excluded from the total).
    for (let i = 0; i < 5; i++) {
      await tx`INSERT INTO crm.accounts (tenant_id, name, status, created_by, updated_by)
               VALUES (${TENANT}, ${"Acct " + i}, 'active', ${ACTOR}, ${ACTOR})`;
    }
    await tx`INSERT INTO crm.accounts (tenant_id, name, status, created_by, updated_by)
             VALUES (${TENANT}, 'Closed', 'inactive', ${ACTOR}, ${ACTOR})`;
    // 3 deals in pipeline A, 2 in pipeline B.
    for (let i = 0; i < 3; i++) {
      await tx`INSERT INTO crm.deals (tenant_id, pipeline_id, name, stage, status, created_by, updated_by)
               VALUES (${TENANT}, ${PIPE_A}, ${"A" + i}, 'Lead', 'active', ${ACTOR}, ${ACTOR})`;
    }
    for (let i = 0; i < 2; i++) {
      await tx`INSERT INTO crm.deals (tenant_id, pipeline_id, name, stage, status, created_by, updated_by)
               VALUES (${TENANT}, ${PIPE_B}, ${"B" + i}, 'Lead', 'active', ${ACTOR}, ${ACTOR})`;
    }
  });
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function get(url: string, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url, headers: headers(roles) });
  await app.close();
  return res;
}

describe("GAP-CRM-ACCOUNTS-02 total", () => {
  it("returns meta.total = active account count even when the page is smaller", async () => {
    const res = await get("/v1/crm/accounts?limit=2");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta?: { total: number } };
    expect(body.data.length).toBe(2); // capped page
    expect(body.meta?.total).toBe(5); // tenant-wide active total (inactive excluded)
  });
});

describe("GAP-CRM-PIPELINE-05 total + pipeline filter", () => {
  it("returns pagination.total across all live deals", async () => {
    const res = await get("/v1/crm/deals?limit=1");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; pagination: { total?: number; hasMore: boolean } };
    expect(body.data.length).toBe(1);
    expect(body.pagination.total).toBe(5);
    expect(body.pagination.hasMore).toBe(true);
  });

  it("scopes the list AND the total to one pipeline", async () => {
    const res = await get(`/v1/crm/deals?limit=200&pipelineId=${PIPE_A}`);
    const body = res.json() as { data: Array<{ pipelineId: string | null }>; pagination: { total?: number } };
    expect(body.pagination.total).toBe(3);
    expect(body.data.length).toBe(3);
    expect(body.data.every((d) => d.pipelineId === PIPE_A)).toBe(true);
  });
});
