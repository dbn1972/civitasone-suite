/**
 * W2 crm cluster 07 -- GAP-CRM-OPPORTUNITIES-NEW-02 / -NEW-06.
 *
 *  NEW-02: POST/PATCH /v1/crm/deals now persist an optional direct accountId
 *          (migration 0168), the account must exist in the caller's tenant, and the
 *          account 360 view lists the deal.
 *  NEW-06: an OMITTED probability takes the chosen pipeline stage's own configured
 *          probability instead of a hard-coded 0; an explicit probability (including
 *          an explicit 0) is honoured; a pipeline-less deal still stores 0.
 *
 * Real route -> queue -> consumer -> DB round trips (needs the disposable Postgres).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

function token(tenantId = TENANT, roles = ["crm_admin"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-w2c7-deals" }, SECRET);
}
const auth = (tenantId = TENANT) => ({ authorization: `Bearer ${token(tenantId)}`, "x-tenant-id": tenantId });

let app: FastifyInstance;

async function createAccount(name: string, tenantId = TENANT): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/crm/accounts", headers: auth(tenantId), payload: { name } });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return res.json().id as string;
}

async function createPipeline(): Promise<{ pipelineId: string; intakeId: string; midId: string }> {
  const intakeId = randomUUID();
  const midId = randomUUID();
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/pipelines",
    headers: auth(),
    payload: {
      name: "W2C7 Pipeline",
      stages: [
        { id: intakeId, name: "Intake", probability: 15, ordinal: 0 },
        { id: midId, name: "Evaluation", probability: 55, ordinal: 1 },
        { id: randomUUID(), name: "Won", probability: 100, ordinal: 2 },
        { id: randomUUID(), name: "Lost", probability: 0, ordinal: 3 },
      ],
    },
  });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return { pipelineId: res.json().id as string, intakeId, midId };
}

async function dealRow(id: string): Promise<{ accountId: string | null; probability: number; stage: string } | undefined> {
  const rows = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx<Array<{ accountId: string | null; probability: number; stage: string }>>`
      SELECT account_id AS "accountId", probability, stage FROM crm.deals WHERE id = ${id} AND tenant_id = ${TENANT}
    `;
  });
  return rows[0];
}

beforeAll(async () => {
  app = await buildApp();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GAP-CRM-OPPORTUNITIES-NEW-02: a deal carries an optional direct account link", () => {
  it("persists accountId on create and the account 360 view lists the deal (no contact needed)", async () => {
    const accountId = await createAccount("Acme Corp");
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: auth(),
      payload: { name: "Acme renewal", accountId },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const id = res.json().id as string;

    expect((await dealRow(id))?.accountId).toBe(accountId);

    const detail = await app.inject({ method: "GET", url: `/v1/crm/deals/${id}`, headers: auth() });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().accountId).toBe(accountId);

    const view = await app.inject({ method: "GET", url: `/v1/crm/accounts/${accountId}/360`, headers: auth() });
    expect(view.statusCode).toBe(200);
    const names = (view.json().data.deals as Array<{ name: string }>).map((d) => d.name);
    expect(names).toContain("Acme renewal");
  });

  it("leaves accountId null when none is supplied (the link stays optional)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: { name: "Unlinked quick capture" } });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect((await dealRow(res.json().id as string))?.accountId).toBeNull();
  });

  it("rejects an account that does not exist in the caller's tenant (422 ACCOUNT_NOT_FOUND) and creates nothing", async () => {
    const foreignAccount = await createAccount("Other tenant account", OTHER_TENANT);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: auth(),
      payload: { name: "Cross-tenant link", accountId: foreignAccount },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ACCOUNT_NOT_FOUND");

    const missing = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: auth(),
      payload: { name: "Missing account", accountId: randomUUID() },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("PATCH can link and unlink the account; a foreign account is refused", async () => {
    const accountId = await createAccount("Patch target");
    const create = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: { name: "Patch me" } });
    await drainQueue();
    const id = create.json().id as string;

    const link = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${id}`, headers: auth(), payload: { accountId } });
    expect(link.statusCode).toBe(202);
    await drainQueue();
    expect((await dealRow(id))?.accountId).toBe(accountId);

    const unlink = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${id}`, headers: auth(), payload: { accountId: null } });
    expect(unlink.statusCode).toBe(202);
    await drainQueue();
    expect((await dealRow(id))?.accountId).toBeNull();

    const foreign = await createAccount("Foreign", OTHER_TENANT);
    const refused = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${id}`, headers: auth(), payload: { accountId: foreign } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("GAP-CRM-OPPORTUNITIES-NEW-02: account merge follows the direct link", () => {
  it("re-points a deal linked directly to the merged-away account onto the surviving account", async () => {
    const primaryId = await createAccount("Merge primary");
    const duplicateId = await createAccount("Merge duplicate");
    const deal = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: { name: "Dup deal", accountId: duplicateId } });
    await drainQueue();
    const dealId = deal.json().id as string;
    expect((await dealRow(dealId))?.accountId).toBe(duplicateId);

    const merged = await app.inject({ method: "POST", url: "/v1/crm/accounts/merge", headers: auth(), payload: { primaryId, duplicateId } });
    expect(merged.statusCode).toBe(202);
    await drainQueue();

    expect((await dealRow(dealId))?.accountId).toBe(primaryId);
    const view = await app.inject({ method: "GET", url: `/v1/crm/accounts/${primaryId}/360`, headers: auth() });
    expect((view.json().data.deals as Array<{ name: string }>).map((d) => d.name)).toContain("Dup deal");
  });
});

describe("GAP-CRM-OPPORTUNITIES-NEW-06: an omitted probability takes the stage default, not a hard-coded 0", () => {
  it("omitted probability on a pipeline deal = the entry stage's configured probability", async () => {
    const { pipelineId } = await createPipeline();
    const res = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: { name: "Blank probability", pipelineId } });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const row = await dealRow(res.json().id as string);
    expect(row?.stage).toBe("Intake");
    expect(row?.probability).toBe(15);
  });

  it("omitted probability on a chosen non-entry stage = THAT stage's probability", async () => {
    const { pipelineId } = await createPipeline();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: auth(),
      payload: { name: "Direct to Evaluation", pipelineId, stage: "Evaluation" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect((await dealRow(res.json().id as string))?.probability).toBe(55);
  });

  it("an explicit probability -- including an explicit 0 -- is honoured over the stage default", async () => {
    const { pipelineId } = await createPipeline();
    for (const probability of [0, 70]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/deals",
        headers: auth(),
        payload: { name: `Explicit ${probability}`, pipelineId, probability },
      });
      expect(res.statusCode).toBe(202);
      await drainQueue();
      expect((await dealRow(res.json().id as string))?.probability).toBe(probability);
    }
  });

  it("a pipeline-less deal with no probability still stores 0 (no stage to take a default from)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: { name: "No pipeline" } });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect((await dealRow(res.json().id as string))?.probability).toBe(0);
  });
});
