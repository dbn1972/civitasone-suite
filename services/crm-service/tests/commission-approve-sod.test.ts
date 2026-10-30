/**
 * F60 (UAT bundle 8) — segregation of duties on commission approval.
 *
 * POST /v1/crm/commissions/:id/approve used to approve any pending ledger entry for any
 * crm_admin, including an admin who is the commission's own beneficiary (agent_id). The
 * route must refuse that with the CRM self-approval convention (403
 * SELF_APPROVAL_FORBIDDEN) and leave the entry pending; a different admin still approves.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const AGENT_ADMIN = randomUUID(); // crm_admin who is also the commission beneficiary
const OTHER_ADMIN = randomUUID();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function seedPending(agentId: string): Promise<string> {
  const id = randomUUID();
  await scoped((tx) => tx`
    INSERT INTO crm.commission_ledger (id, tenant_id, agent_id, deal_id, rule_id, amount_minor, currency, status, period)
    VALUES (${id}, ${TENANT}, ${agentId}, ${randomUUID()}, ${randomUUID()}, 50000, 'INR', 'pending', '2026-10')
  `);
  return id;
}

async function ledgerRow(id: string): Promise<{ status: string; approved_by: string | null }> {
  const rows = await scoped((tx) => tx<{ status: string; approved_by: string | null }[]>`
    SELECT status, approved_by FROM crm.commission_ledger WHERE id = ${id}
  `);
  return rows[0]!;
}

async function approve(id: string, actor: string) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: `/v1/crm/commissions/${id}/approve`,
    headers: {
      authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles: ["crm_admin"], sid: "s-f60" }, SECRET)}`,
      "x-tenant-id": TENANT,
    },
  });
  await app.close();
  return res;
}

async function purge() {
  await scoped((tx) => tx`DELETE FROM crm.commission_ledger WHERE tenant_id = ${TENANT}`);
}

beforeAll(purge);
afterAll(async () => {
  await purge();
  await sqlClient.end();
});

describe("F60 commission approval — maker/checker (beneficiary cannot approve)", () => {
  it("refuses an admin approving a commission they are the beneficiary of → 403 SELF_APPROVAL_FORBIDDEN, stays pending", async () => {
    const id = await seedPending(AGENT_ADMIN);
    const res = await approve(id, AGENT_ADMIN);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
    const row = await ledgerRow(id);
    expect(row.status).toBe("pending");
    expect(row.approved_by).toBeNull();
  });

  it("lets a different admin approve the same commission", async () => {
    const id = await seedPending(AGENT_ADMIN);
    const res = await approve(id, OTHER_ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ id, status: "approved" });
    const row = await ledgerRow(id);
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBe(OTHER_ADMIN);
  });

  it("still 404s for an unknown or already-processed entry", async () => {
    const id = await seedPending(AGENT_ADMIN);
    expect((await approve(id, OTHER_ADMIN)).statusCode).toBe(200);
    expect((await approve(id, OTHER_ADMIN)).statusCode).toBe(404);
    expect((await approve(randomUUID(), OTHER_ADMIN)).statusCode).toBe(404);
  });
});
