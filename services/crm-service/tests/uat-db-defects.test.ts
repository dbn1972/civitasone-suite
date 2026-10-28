/**
 * UAT DB-test defects (g2-crm-citizen, 2026-10-28) -- one regression test per item.
 *
 *  1. POST /contacts/resolve matches by email (email_idx holds the blind index)
 *  2. PATCH /campaigns/:id/cost is a real upsert (2nd call no longer 500s)
 *  3. DELETE /document-types/:id accepts the empty-string body the gateway forwards
 *  4. send / bulk-send / template-preview authenticate to notification-service with the
 *     internal service credential (x-internal + x-service-secret), not nothing
 *  5. approving a campaign dispatches it (enqueues the existing bulkSendCommunication command)
 *  6. a closed-won deal earns commission: the REAL close consumer's published event drives
 *     the REAL commission consumer (publisher <-> consumer contract)
 *  7. POST /accounts/:id/sponsors persists `notes`
 *  8. PATCH /activities/:id bumps version / updated_at / updated_by
 */
import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { deleteDocumentTypeBody } from "../src/modules/documents/validators.js";
import { reachedWon } from "../src/modules/commissions/consumer.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const OWNER = randomUUID();

const originalFetch = globalThis.fetch;
const originalInternalSecret = process.env.INTERNAL_SERVICE_SECRET;

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-uat-db" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function call(method: string, url: string, opts: { roles?: string[]; payload?: unknown; contentType?: string } = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method: method as "GET",
    url,
    headers: { ...headers(opts.roles), ...(opts.contentType ? { "content-type": opts.contentType } : {}) },
    payload: opts.payload as object,
  });
  await app.close();
  return res;
}

/** URL-aware notification-service stub: template fetches get a body, sends get a delivery id. */
function mockNotification(templateBody = "Hello") {
  const fn = vi.fn().mockImplementation(async (url: string) => {
    const isTemplate = String(url).includes("/notifications/templates/");
    return {
      ok: true,
      status: 200,
      json: async () => (isTemplate
        ? { data: { id: String(url).split("/").pop(), body: templateBody } }
        : { deliveryId: randomUUID() }),
    };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function createContact(name: string, email?: string, consent = false): Promise<string> {
  const res = await call("POST", "/v1/crm/contacts", {
    payload: { name, ...(email ? { email } : {}) },
  });
  expect(res.statusCode, res.body).toBe(202);
  await drainQueue();
  const id = res.json().id as string;
  // Consent is set directly: the create route demands a consent purpose/channel we are not testing here.
  if (consent) await scoped((tx) => tx`UPDATE crm.contacts SET marketing_consent = true WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return id;
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalInternalSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
  else process.env.INTERNAL_SERVICE_SECRET = originalInternalSecret;
});

afterAll(async () => {
  await drainQueue();
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.commission_ledger WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.commission_rules WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.campaign_performance WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.pending_campaigns WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.account_relationships WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.communications WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.document_types WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
  await sqlClient.end();
});

describe("1. contacts/resolve matches by email", () => {
  it("finds an existing contact by its email (case-insensitive) as email_exact", async () => {
    const email = `resolve.${randomUUID().slice(0, 8)}@example.in`;
    const id = await createContact("Resolve Me", email);

    const res = await call("POST", "/v1/crm/contacts/resolve", { payload: { email: email.toUpperCase() } });
    expect(res.statusCode).toBe(200);
    expect(res.json().matchType).toBe("email_exact");
    expect(res.json().data.id).toBe(id);
  });

  it("still reports none for an email no contact holds", async () => {
    const res = await call("POST", "/v1/crm/contacts/resolve", { payload: { email: "nobody-here@example.in" } });
    expect(res.json().matchType).toBe("none");
  });
});

describe("2. PATCH /campaigns/:id/cost upserts", () => {
  it("amends the cost on a second and third call instead of 500ing on the unique key", async () => {
    const campaignId = randomUUID();
    const url = `/v1/crm/campaigns/${campaignId}/cost`;

    expect((await call("PATCH", url, { payload: { costMinor: "123456" } })).statusCode).toBe(200);
    const second = await call("PATCH", url, { payload: { costMinor: "200000" } });
    expect(second.statusCode).toBe(200);
    expect((await call("PATCH", url, { payload: { costMinor: "250000", currency: "inr" } })).statusCode).toBe(200);

    const rows = await scoped((tx) => tx<Array<{ cost: string; version: number }>>`
      SELECT cost_minor::text AS cost, version FROM crm.campaign_performance
      WHERE tenant_id = ${TENANT} AND campaign_id = ${campaignId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost).toBe("250000");
    expect(rows[0]!.version).toBe(3);
  });
});

describe("3. DELETE /document-types/:id with no body", () => {
  it("the body schema treats the gateway's empty-string body as 'no body'", () => {
    expect(deleteDocumentTypeBody.parse("")).toBeUndefined();
    expect(deleteDocumentTypeBody.parse(undefined)).toBeUndefined();
    expect(deleteDocumentTypeBody.parse({ reason: "retire" })).toEqual({ reason: "retire" });
    expect(deleteDocumentTypeBody.safeParse("not an object").success).toBe(false);
  });

  it("deletes an unused type when the request carries an empty body", async () => {
    const created = await call("POST", "/v1/crm/document-types", {
      payload: { code: `dt_${randomUUID().slice(0, 8)}`, name: "Empty body", appliesTo: ["contact"] },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    const del = await call("DELETE", `/v1/crm/document-types/${id}`, { payload: "", contentType: "application/json" });
    expect(del.statusCode).toBe(204);
    const rows = await scoped((tx) => tx`SELECT 1 FROM crm.document_types WHERE id = ${id}`);
    expect(rows).toHaveLength(0);
  });
});

describe("4. notification-service calls carry the internal service credential", () => {
  function assertInternalAuth(init: RequestInit | undefined) {
    const h = (init?.headers ?? {}) as Record<string, string>;
    expect(h["x-internal"]).toBe("1");
    expect(h["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
    expect(h["x-tenant-id"]).toBe(TENANT);
    expect(h["x-internal-caller"]).toBe("crm-service");
    expect(h.authorization).toBeUndefined();
  }

  it("send: the consumer authenticates and the communication ends up 'sent', not 'failed'", async () => {
    const contactId = await createContact("Send Target", undefined, true);
    const fetchMock = mockNotification();

    const res = await call("POST", "/v1/crm/communications/send", {
      roles: ["crm_user"],
      payload: { recipientContactId: contactId, templateId: randomUUID(), channel: "email", variables: {} },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const sendCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/notifications/send"));
    expect(sendCall).toBeDefined();
    assertInternalAuth(sendCall![1] as RequestInit);
    const rows = await scoped((tx) => tx<Array<{ status: string }>>`
      SELECT status FROM crm.communications WHERE tenant_id = ${TENANT} AND subject_id = ${contactId}`);
    expect(rows.map((r) => r.status)).toEqual(["sent"]);
  });

  it("bulk-send: every fan-out call is authenticated", async () => {
    const a = await createContact("Bulk A", undefined, true);
    const b = await createContact("Bulk B", undefined, true);
    const fetchMock = mockNotification();

    const res = await call("POST", "/v1/crm/communications/bulk-send", {
      roles: ["crm_admin"],
      payload: { contactIds: [a, b], templateId: randomUUID(), channel: "email", variables: {} },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const sends = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/notifications/send"));
    expect(sends).toHaveLength(2);
    for (const c of sends) assertInternalAuth(c[1] as RequestInit);
  });

  it("template-preview: fetches the template with the internal credential", async () => {
    const contactId = await createContact("Preview Target", undefined, true);
    const templateId = randomUUID();
    const fetchMock = mockNotification("Hello {{name}}");

    const res = await call("POST", "/v1/crm/communications/template-preview", {
      roles: ["crm_user"],
      payload: { templateId, contactId, variables: {} },
    });
    expect(res.statusCode).toBe(200);
    const tplCall = fetchMock.mock.calls.find((c) => String(c[0]).includes(`/notifications/templates/${templateId}`));
    expect(tplCall).toBeDefined();
    assertInternalAuth(tplCall![1] as RequestInit);
  });

  it("fails closed (no unauthenticated call) when INTERNAL_SERVICE_SECRET is not configured", async () => {
    const contactId = await createContact("No Secret", undefined, true);
    delete process.env.INTERNAL_SERVICE_SECRET;
    const fetchMock = mockNotification();

    const preview = await call("POST", "/v1/crm/communications/template-preview", {
      roles: ["crm_user"],
      payload: { templateId: randomUUID(), contactId, variables: {} },
    });
    expect(preview.statusCode).toBe(503);

    await call("POST", "/v1/crm/communications/send", {
      roles: ["crm_user"],
      payload: { recipientContactId: contactId, templateId: randomUUID(), channel: "email", variables: {} },
    });
    await drainQueue();
    expect(fetchMock).not.toHaveBeenCalled();
    const rows = await scoped((tx) => tx<Array<{ status: string }>>`
      SELECT status FROM crm.communications WHERE tenant_id = ${TENANT} AND subject_id = ${contactId}`);
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
  });
});

describe("5. approving a campaign dispatches it", () => {
  it("enqueues exactly one bulkSendCommunication carrying the campaign's recipients, even on redelivery", async () => {
    const campaignId = randomUUID();
    const templateId = randomUUID();
    const contactIds = [randomUUID(), randomUUID()];
    await scoped((tx) => tx`
      INSERT INTO crm.pending_campaigns (id, tenant_id, channel, template_id, contact_ids, variables, created_by)
      VALUES (${campaignId}, ${TENANT}, 'email', ${templateId}, ${JSON.stringify(contactIds)}::jsonb, '{"k":"v"}'::jsonb, ${ACTOR})`);

    const handler = captureHandlers().handlerFor(COMMANDS.approveCampaign);
    const msg = envelope(COMMANDS.approveCampaign, {
      campaignId, contactIds, templateId, channel: "email", variables: { k: "v" }, scheduledAt: null,
    }, { tenantId: TENANT, actorId: ACTOR });
    await runWithTenant(TENANT, () => handler(msg));
    await runWithTenant(TENANT, () => handler(msg));

    const dispatched = await scoped((tx) => tx<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = ${COMMANDS.bulkSendCommunication}
        AND payload->>'id' = ${campaignId}`);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.payload).toMatchObject({
      contactIds, templateId, channel: "email", variables: { k: "v" }, tenantId: TENANT,
    });
  });
});

describe("6. commissions: close-consumer publisher <-> commission-consumer contract", () => {
  it("reachedWon understands both won payload shapes and ignores a rejected close", () => {
    expect(reachedWon({ dealId: "d", outcome: "won", stage: "Won" })).toBe(true);
    expect(reachedWon({ dealId: "d", previousStage: "Negotiation", newStage: "Won" })).toBe(true);
    expect(reachedWon({ dealId: "d", outcome: "lost", stage: "Lost" })).toBe(false);
    expect(reachedWon({ dealId: "d", outcome: "cancelled", stage: null })).toBe(false);
    expect(reachedWon({ dealId: "d", rejected: true })).toBe(false);
  });

  it("a deal closed Won through the real close consumer earns exactly one commission", async () => {
    const dealId = randomUUID();
    const ruleId = randomUUID();
    await scoped(async (tx) => {
      await tx`INSERT INTO crm.deals (id, tenant_id, name, stage, owner_id, value_minor, currency, status, created_by, updated_by)
               VALUES (${dealId}, ${TENANT}, 'Commissionable', 'Negotiation', ${OWNER}, 1000000, 'INR', 'active', ${ACTOR}, ${ACTOR})`;
      await tx`INSERT INTO crm.commission_rules (id, tenant_id, name, type, rate_type, rate_value, created_by)
               VALUES (${ruleId}, ${TENANT}, 'five pct', 'sale', 'percentage', 500, ${ACTOR})`;
    });

    const { handlerFor } = captureHandlers();
    await runWithTenant(TENANT, () => handlerFor(COMMANDS.closeDeal)(envelope(COMMANDS.closeDeal, {
      dealId, outcome: "won", reason: "signed", closedValue: null, competitor: null,
    }, { tenantId: TENANT, actorId: ACTOR })));

    // The event exactly as the close consumer published it -- not a hand-built payload.
    const events = await scoped((tx) => tx<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = ${EVENTS.dealClosed} AND payload->>'dealId' = ${dealId}`);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload, JSON.stringify(events[0]!.payload)).toMatchObject({ dealId, outcome: "won", stage: "Won" });

    const closed = envelope(EVENTS.dealClosed, events[0]!.payload, { tenantId: TENANT, actorId: ACTOR });
    await runWithTenant(TENANT, () => handlerFor(EVENTS.dealClosed)(closed));
    // The same deal ALSO reported through the stage-moved topic must not pay twice.
    await runWithTenant(TENANT, () => handlerFor(EVENTS.dealStageUpdated)(envelope(EVENTS.dealStageUpdated, {
      dealId, previousStage: "Negotiation", newStage: "Won",
    }, { tenantId: TENANT, actorId: ACTOR })));

    const ledger = await scoped((tx) => tx<Array<{ amount: string; agent: string }>>`
      SELECT amount_minor::text AS amount, agent_id::text AS agent FROM crm.commission_ledger
      WHERE tenant_id = ${TENANT} AND deal_id = ${dealId}`);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toEqual({ amount: "50000", agent: OWNER });
  });

  it("a deal closed Lost earns nothing", async () => {
    const dealId = randomUUID();
    await scoped((tx) => tx`INSERT INTO crm.deals (id, tenant_id, name, stage, owner_id, value_minor, currency, status, created_by, updated_by)
               VALUES (${dealId}, ${TENANT}, 'Lost deal', 'Negotiation', ${OWNER}, 1000000, 'INR', 'active', ${ACTOR}, ${ACTOR})`);
    const { handlerFor } = captureHandlers();
    await runWithTenant(TENANT, () => handlerFor(COMMANDS.closeDeal)(envelope(COMMANDS.closeDeal, {
      dealId, outcome: "lost", reason: "price", closedValue: null, competitor: null,
    }, { tenantId: TENANT, actorId: ACTOR })));
    const events = await scoped((tx) => tx<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = ${EVENTS.dealClosed} AND payload->>'dealId' = ${dealId}`);
    await runWithTenant(TENANT, () => handlerFor(EVENTS.dealClosed)(
      envelope(EVENTS.dealClosed, events[0]!.payload, { tenantId: TENANT, actorId: ACTOR })));
    const ledger = await scoped((tx) => tx`SELECT 1 FROM crm.commission_ledger WHERE tenant_id = ${TENANT} AND deal_id = ${dealId}`);
    expect(ledger).toHaveLength(0);
  });
});

describe("7. sponsors persist notes", () => {
  it("stores and returns the note, on create and on list", async () => {
    const acc = await call("POST", "/v1/crm/accounts", { payload: { name: `Sponsor Acct ${randomUUID().slice(0, 6)}` } });
    expect(acc.statusCode).toBe(202);
    await drainQueue();
    const accountId = acc.json().id as string;
    const contactId = await createContact("Exec Sponsor");

    const res = await call("POST", `/v1/crm/accounts/${accountId}/sponsors`, {
      roles: ["crm_user"], payload: { contactId, notes: "Board-level champion" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.notes).toBe("Board-level champion");

    const list = await call("GET", `/v1/crm/accounts/${accountId}/sponsors`, { roles: ["crm_user"] });
    expect(list.json().data[0].notes).toBe("Board-level champion");
    const row = await scoped((tx) => tx<Array<{ notes: string | null }>>`
      SELECT notes FROM crm.account_relationships WHERE tenant_id = ${TENANT} AND from_account_id = ${accountId}`);
    expect(row[0]!.notes).toBe("Board-level champion");
  });
});

describe("8. PATCH /activities/:id bumps the row version", () => {
  it("increments version and stamps updated_at / updated_by", async () => {
    const created = await call("POST", "/v1/crm/activities", { payload: { text: "follow up", type: "task", subject: "call back" } });
    expect(created.statusCode).toBe(202);
    await drainQueue();
    const id = created.json().id as string;
    const before = (await scoped((tx) => tx<Array<{ version: number; updatedAt: Date }>>`
      SELECT version, updated_at AS "updatedAt" FROM crm.activities WHERE id = ${id} AND tenant_id = ${TENANT}`))[0]!;
    expect(before.version).toBe(1);
    await new Promise((r) => setTimeout(r, 20));

    const res = await call("PATCH", `/v1/crm/activities/${id}`, { payload: { status: "completed" } });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const after = (await scoped((tx) => tx<Array<{ version: number; updatedAt: Date; updatedBy: string; status: string }>>`
      SELECT version, updated_at AS "updatedAt", updated_by::text AS "updatedBy", status
      FROM crm.activities WHERE id = ${id} AND tenant_id = ${TENANT}`))[0]!;
    expect(after.status).toBe("completed");
    expect(after.version).toBe(2);
    expect(after.updatedBy).toBe(ACTOR);
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
  });
});
