/**
 * Stabilisation of the integrated CRM branch -- GAP-CRM-OPPORTUNITIES-NEW-02 / -NEW-06.
 *
 *  1. A deal can be linked only to a LIVE account (status = 'active'): the account lists, the picker
 *     search and the by-id lookup return active accounts only, so a merged / soft-deleted account
 *     is not offered anywhere and must not be accepted by POST/PATCH /v1/crm/deals either (route
 *     422 ACCOUNT_NOT_FOUND), nor by the consumer if the account went inactive after the command
 *     was accepted.
 *  2. The REAL web client bodies (apps/web/src/lib/crm/opportunityBody.ts, built from the exact
 *     Opportunity OpportunityForm assembles, blanks included) are accepted by the real routes and
 *     land in the row: the opportunity form can create and edit a deal end to end.
 *
 * Real route -> queue -> consumer -> DB round trips (needs the disposable Postgres).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
// The web client's wire-body builders: pure functions, deliberately imported so this test drives the
// exact JSON the browser sends (a contract test across the two packages).
import { buildCreateDealBody, buildUpdateDealBody } from "../../../apps/web/src/lib/crm/opportunityBody";
import type { Opportunity } from "../../../apps/web/src/lib/crm/opportunity";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const ACTOR = randomUUID();

const auth = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["crm_admin"], sid: "sess-stab-deals" }, SECRET)}`,
  "x-tenant-id": tenantId,
});

let app: FastifyInstance;

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function createAccount(name: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/crm/accounts", headers: auth(), payload: { name } });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return res.json().id as string;
}
async function setAccountStatus(id: string, status: string): Promise<void> {
  await scoped((tx) => tx`UPDATE crm.accounts SET status = ${status} WHERE id = ${id} AND tenant_id = ${TENANT}`);
}
async function accountStatus(id: string): Promise<string | undefined> {
  const rows = await scoped((tx) => tx<Array<{ status: string }>>`SELECT status FROM crm.accounts WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return rows[0]?.status;
}
interface DealRow {
  accountId: string | null;
  name: string;
  valueMinor: string;
  probability: number;
  product: string | null;
  quantity: number | null;
  nextStep: string | null;
  expectedCloseDate: string | null;
  competitors: string[];
}
async function dealRow(id: string): Promise<DealRow | undefined> {
  const rows = await scoped((tx) => tx<DealRow[]>`
    SELECT account_id AS "accountId", name, value_minor::text AS "valueMinor", probability, product, quantity,
           next_step AS "nextStep", to_char(expected_close_date, 'YYYY-MM-DD') AS "expectedCloseDate", competitors
    FROM crm.deals WHERE id = ${id} AND tenant_id = ${TENANT}
  `);
  return rows[0];
}
async function dealCountByName(name: string): Promise<number> {
  const rows = await scoped((tx) => tx<Array<{ n: number }>>`SELECT count(*)::int AS n FROM crm.deals WHERE tenant_id = ${TENANT} AND name = ${name}`);
  return rows[0]?.n ?? 0;
}
async function createDealVia(payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return res.json().id as string;
}
async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`);
  await scoped((tx) => tx`DELETE FROM crm.pipelines WHERE tenant_id = ${TENANT}`);
  await scoped((tx) => tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  app = await buildApp();
  registerAllConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("a deal can be linked only to a live (active) account", () => {
  it("POST refuses an account that was merged away (inactive): 422 ACCOUNT_NOT_FOUND, nothing created", async () => {
    const primaryId = await createAccount("Stab merge primary");
    const duplicateId = await createAccount("Stab merge duplicate");
    const merged = await app.inject({ method: "POST", url: "/v1/crm/accounts/merge", headers: auth(), payload: { primaryId, duplicateId } });
    expect(merged.statusCode).toBe(202);
    await drainQueue();
    // the real merge soft-deletes the duplicate: it is no longer a live account
    expect(await accountStatus(duplicateId)).toBe("inactive");
    expect(await accountStatus(primaryId)).toBe("active");

    const refused = await app.inject({
      method: "POST", url: "/v1/crm/deals", headers: auth(), payload: { name: "Stab link to merged", accountId: duplicateId },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe("ACCOUNT_NOT_FOUND");
    await drainQueue();
    expect(await dealCountByName("Stab link to merged")).toBe(0);

    // the surviving account is still linkable
    const ok = await createDealVia({ name: "Stab link to survivor", accountId: primaryId });
    expect((await dealRow(ok))?.accountId).toBe(primaryId);
  });

  it("POST and PATCH refuse a soft-deleted account of any non-active status", async () => {
    const accountId = await createAccount("Stab soft deleted");
    const dealId = await createDealVia({ name: "Stab patch target" });
    await setAccountStatus(accountId, "inactive");

    const post = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: { name: "Stab link to inactive", accountId } });
    expect(post.statusCode).toBe(422);
    expect(post.json().code).toBe("ACCOUNT_NOT_FOUND");

    const patch = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${dealId}`, headers: auth(), payload: { accountId } });
    expect(patch.statusCode).toBe(422);
    expect(patch.json().code).toBe("ACCOUNT_NOT_FOUND");
    await drainQueue();
    expect((await dealRow(dealId))?.accountId).toBeNull();
    expect(await dealCountByName("Stab link to inactive")).toBe(0);

    // reactivated: linkable again (the check follows the account's live status, nothing is cached)
    await setAccountStatus(accountId, "active");
    const again = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${dealId}`, headers: auth(), payload: { accountId } });
    expect(again.statusCode).toBe(202);
    await drainQueue();
    expect((await dealRow(dealId))?.accountId).toBe(accountId);
  });

  it("unlinking (accountId: null) from a deal whose account has since gone inactive still works", async () => {
    const accountId = await createAccount("Stab deactivated later");
    const dealId = await createDealVia({ name: "Stab keeps then drops", accountId });
    await setAccountStatus(accountId, "inactive");
    const res = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${dealId}`, headers: auth(), payload: { accountId: null } });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect((await dealRow(dealId))?.accountId).toBeNull();
  });

  it("the consumer re-checks: a create / update command accepted while the account was live is rejected once it is inactive", async () => {
    const accountId = await createAccount("Stab went inactive after accept");
    const dealId = await createDealVia({ name: "Stab existing unlinked" });
    await setAccountStatus(accountId, "inactive");

    const { handlerFor } = captureHandlers();
    const newId = randomUUID();
    await runWithTenant(TENANT, () =>
      handlerFor(COMMANDS.createDeal)(
        envelope(COMMANDS.createDeal, {
          id: newId, tenantId: TENANT, name: "Stab late create", stage: "Lead", valueMinor: "0", currency: "INR",
          status: "active", probability: 0, accountId,
        }, { tenantId: TENANT, actorId: ACTOR }),
      ),
    );
    expect(await dealRow(newId)).toBeUndefined();

    await runWithTenant(TENANT, () =>
      handlerFor(COMMANDS.updateDeal)(
        envelope(COMMANDS.updateDeal, { id: dealId, tenantId: TENANT, accountId }, { tenantId: TENANT, actorId: ACTOR }),
      ),
    );
    expect((await dealRow(dealId))?.accountId).toBeNull();
  });
});

describe("the opportunity form's real bodies are accepted end to end (NEW-02 / NEW-06)", () => {
  async function pipeline(): Promise<{ pipelineId: string; intakeId: string }> {
    const intakeId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: auth(),
      payload: {
        name: "Stab UI pipeline",
        stages: [
          { id: intakeId, name: "Intake", probability: 15, ordinal: 0 },
          { id: randomUUID(), name: "Evaluation", probability: 55, ordinal: 1 },
          { id: randomUUID(), name: "Won", probability: 100, ordinal: 2 },
          { id: randomUUID(), name: "Lost", probability: 0, ordinal: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    return { pipelineId: res.json().id as string, intakeId };
  }

  it("create from a form with only the required fields (every optional field blank), then edit it, then clear fields", async () => {
    const { pipelineId, intakeId } = await pipeline();
    const accountId = await createAccount("Stab UI account");
    // Exactly what OpportunityForm.submit() assembles for a create with nothing optional entered.
    const created: Opportunity = {
      name: "Stab UI deal", pipelineId, stage: "Intake", stageId: intakeId, valueMinor: "150050",
      product: "", competitors: [], nextStep: "", expectedCloseDate: "", accountId,
    };
    const post = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: buildCreateDealBody(created) });
    expect(post.statusCode).toBe(202);
    await drainQueue();
    const id = post.json().id as string;
    expect(await dealRow(id)).toMatchObject({
      accountId, name: "Stab UI deal", valueMinor: "150050",
      probability: 15, // NEW-06: probability left blank takes the entry stage's own probability, not an invented 0
      product: null, quantity: null, nextStep: null, expectedCloseDate: null,
    });

    // The edit form re-sends everything it holds (blanks included) as a PATCH.
    const edited: Opportunity = {
      ...created, id, valueMinor: "250075", probability: 40, product: "Server racks", quantity: 12,
      competitors: ["Acme", "Globex"], nextStep: "Send quotation", expectedCloseDate: "2027-01-15",
    };
    const patch = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${id}`, headers: auth(), payload: buildUpdateDealBody(edited) });
    expect(patch.statusCode).toBe(202);
    await drainQueue();
    expect(await dealRow(id)).toMatchObject({
      accountId, valueMinor: "250075", product: "Server racks", quantity: 12,
      competitors: ["Acme", "Globex"], nextStep: "Send quotation", expectedCloseDate: "2027-01-15",
    });

    // Clearing the optional fields in the form (blank strings, no quantity) clears them in the row.
    const cleared: Opportunity = { ...edited, product: "", quantity: undefined, competitors: [], nextStep: "", expectedCloseDate: "" };
    const clear = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${id}`, headers: auth(), payload: buildUpdateDealBody(cleared) });
    expect(clear.statusCode).toBe(202);
    await drainQueue();
    expect(await dealRow(id)).toMatchObject({
      accountId, valueMinor: "250075", product: null, quantity: null, competitors: [], nextStep: null, expectedCloseDate: null,
    });
  });

  it("premise: the un-built form object (blank strings, a string value on PATCH) is what the routes answer 400 to", async () => {
    const { pipelineId, intakeId } = await pipeline();
    const raw: Opportunity = {
      name: "Stab raw body", pipelineId, stage: "Intake", stageId: intakeId, valueMinor: "150050",
      product: "", competitors: [], nextStep: "", expectedCloseDate: "",
    };
    const post = await app.inject({ method: "POST", url: "/v1/crm/deals", headers: auth(), payload: raw });
    expect(post.statusCode).toBe(400);
    expect((post.json().fieldErrors as Array<{ field: string }>).map((f) => f.field)).toEqual(expect.arrayContaining(["product", "expectedCloseDate"]));
    expect(await dealCountByName("Stab raw body")).toBe(0);

    const id = await createDealVia({ name: "Stab raw patch target" });
    const patch = await app.inject({ method: "PATCH", url: `/v1/crm/deals/${id}`, headers: auth(), payload: raw });
    expect(patch.statusCode).toBe(400);
    expect((patch.json().fieldErrors as Array<{ field: string }>).map((f) => f.field)).toEqual(expect.arrayContaining(["valueMinor", "product", "expectedCloseDate"]));
  });

  it("a fully filled create form lands every value in the row", async () => {
    const { pipelineId, intakeId } = await pipeline();
    const full: Opportunity = {
      name: "Stab UI full", pipelineId, stage: "Intake", stageId: intakeId, valueMinor: "99999999900",
      probability: 0, product: "Racks", quantity: 3, competitors: ["Acme"], nextStep: "Visit", expectedCloseDate: "2026-12-31",
    };
    const id = await createDealVia({ ...buildCreateDealBody(full) });
    expect(await dealRow(id)).toMatchObject({
      name: "Stab UI full", valueMinor: "99999999900",
      probability: 0, // an explicit 0 is honoured
      product: "Racks", quantity: 3, competitors: ["Acme"], nextStep: "Visit", expectedCloseDate: "2026-12-31",
    });
  });
});
