/**
 * GAP2-CRM-FORECAST-07 + GAP2-CRM-AGENT-WORKLOAD-05 — web↔server role parity.
 *
 * Both the forecast read and the teams agent-capacity routes were missing
 * `tenant_admin` from their role lists while sibling deal/pipeline reads
 * (quotations, tenders, account plans, QBR) and the catalogue admin routes
 * (products, service-requests) accept it. These DB-backed HTTP tests assert the
 * aligned contract: tenant_admin now reaches the forecast and the agent list /
 * capacity write, and a non-CRM role is still denied.
 *
 * On the OLD code: `GET /v1/crm/forecast` as tenant_admin → 403;
 * `GET /v1/crm/teams/agents` as tenant_admin → 403; the capacity PATCH → 403.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const AGENT_ID = randomUUID();

function headers(roles: string[], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-rp" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  opts: { roles: string[]; payload?: unknown },
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    headers: headers(opts.roles),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
  await scoped((tx) => tx`
    INSERT INTO crm.agent_workload (id, tenant_id, agent_id, max_leads, current_load, available, skills)
    VALUES (gen_random_uuid(), ${TENANT}, ${AGENT_ID}, 50, 10, true, '[]'::jsonb)
    ON CONFLICT DO NOTHING
  `);
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GAP2-CRM-FORECAST-07: forecast read role parity", () => {
  it("admits tenant_admin (matches the sibling deal/pipeline reads)", async () => {
    const res = await call("GET", "/v1/crm/forecast", { roles: ["tenant_admin"] });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { totalForecast: string } };
    expect(typeof body.data.totalForecast).toBe("string");
  });

  it("still admits a plain crm_user", async () => {
    expect((await call("GET", "/v1/crm/forecast", { roles: ["crm_user"] })).statusCode).toBe(200);
  });

  it("denies a non-CRM role", async () => {
    expect((await call("GET", "/v1/crm/forecast", { roles: ["finance_user"] })).statusCode).toBe(403);
  });
});

describe("GAP2-CRM-AGENT-WORKLOAD-05: teams agent routes role parity", () => {
  it("tenant_admin can GET the agent list", async () => {
    const res = await call("GET", "/v1/crm/teams/agents", { roles: ["tenant_admin"] });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ agentId: string }> };
    expect(body.data.some((a) => a.agentId === AGENT_ID)).toBe(true);
  });

  it("tenant_admin can PATCH an agent capacity", async () => {
    const res = await call("PATCH", `/v1/crm/teams/agents/${AGENT_ID}/capacity`, {
      roles: ["tenant_admin"],
      payload: { maxLeads: 25 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("denies a non-CRM role on both routes", async () => {
    expect((await call("GET", "/v1/crm/teams/agents", { roles: ["finance_user"] })).statusCode).toBe(403);
    expect(
      (await call("PATCH", `/v1/crm/teams/agents/${AGENT_ID}/capacity`, {
        roles: ["finance_user"],
        payload: { maxLeads: 5 },
      })).statusCode,
    ).toBe(403);
  });
});
