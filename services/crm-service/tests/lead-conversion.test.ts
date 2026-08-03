/**
 * Lead conversion tests (OP-001).
 * Tests POST /v1/crm/leads/:id/convert — happy path, invalid status, missing fields,
 * and the conversion consumer that actually applies the account/deal/lead writes.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { captureHandlers, drainQueue, envelope } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000030";
const ACTOR = "cccccccc-3333-4000-8000-000000000030";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-conversion" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const QUALIFIED_LEAD_ID = "44444444-dddd-4000-8000-000000000001";
const NEW_LEAD_ID = "44444444-dddd-4000-8000-000000000002";
const CONVERTED_LEAD_ID = "44444444-dddd-4000-8000-000000000003";
const INACTIVE_LEAD_ID = "44444444-dddd-4000-8000-000000000004";
const NONEXIST_ID = "ffffffff-ffff-4000-8000-000000000099";
/** Leads used only by the consumer-applies-the-write tests, so the route-level
 * cases above cannot pollute the row counts they assert on. */
const APPLY_LEAD_ID = "44444444-dddd-4000-8000-000000000011";
const APPLY_NO_ACCOUNT_LEAD_ID = "44444444-dddd-4000-8000-000000000012";
const STALE_LEAD_ID = "44444444-dddd-4000-8000-000000000013";

async function seedLeads(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${QUALIFIED_LEAD_ID}, ${TENANT}, 'Qualified Lead', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${NEW_LEAD_ID}, ${TENANT}, 'New Lead', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${CONVERTED_LEAD_ID}, ${TENANT}, 'Converted Lead', 'converted', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${INACTIVE_LEAD_ID}, ${TENANT}, 'Inactive Lead', 'qualified', 'inactive', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${APPLY_LEAD_ID}, ${TENANT}, 'Apply Lead', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${APPLY_NO_ACCOUNT_LEAD_ID}, ${TENANT}, 'Apply No Account Lead', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${STALE_LEAD_ID}, ${TENANT}, 'Stale Lead', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    // Children before contacts — crm.deals.contact_id references crm.contacts.
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.lead_transitions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

function cmd(payload: unknown, messageId?: string) {
  return envelope(COMMANDS.leadConvert, payload, {
    tenantId: TENANT,
    actorId: ACTOR,
    ...(messageId !== undefined ? { messageId } : {}),
  });
}

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

beforeAll(async () => {
  await cleanup();
  await seedLeads();
  registerAllConsumers(queue);
  await queue.start();
});

describe("POST /v1/crm/leads/:id/convert", () => {
  describe("happy path", () => {
    it("converts qualified lead with account creation → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: {
          createAccount: true,
          accountName: "New Account Corp",
          dealName: "New Deal",
          dealValue: "500000",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
      expect(body.correlationId).toBeDefined();
    });

    it("converts qualified lead without account creation → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("converts 'converted' status lead → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${CONVERTED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("converts with deal name but no value → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false, dealName: "Side Deal" },
      });
      await app.close();
      expect(res.statusCode).toBe(202);
    });
  });

  describe("invalid status (422)", () => {
    it("rejects conversion of 'new' lead → 422", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${NEW_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe("INVALID_STATUS");
    });
  });

  describe("not found (404)", () => {
    it("returns 404 for non-existent lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${NONEXIST_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for inactive lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${INACTIVE_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });
  });

  describe("validation errors (400)", () => {
    it("rejects createAccount=true without accountName → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: true },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects missing createAccount field → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: {},
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid UUID in path → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/not-a-uuid/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  });

  describe("auth", () => {
    it("returns 401 without token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });
  });
});

/**
 * The route answering 202 proves nothing on its own — before the conversion
 * consumer existed, every one of the cases above passed while the account, the
 * opportunity and the lead status change were silently dropped.
 */
describe("crm.lead.convert consumer applies the conversion", () => {
  it("creates the account + opportunity and flips the lead to converted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/leads/${APPLY_LEAD_ID}/convert`,
      headers: headers(),
      payload: {
        createAccount: true,
        accountName: "Converted Account Ltd",
        dealName: "Converted Opportunity",
        dealValue: "500000",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    const body = res.json() as { accountId: string; dealId: string };
    expect(body.accountId).toBeDefined();
    expect(body.dealId).toBeDefined();

    await drainQueue();

    const accounts = await scoped((tx) => tx<Array<{ name: string; status: string }>>`
      SELECT name, status FROM crm.accounts WHERE id = ${body.accountId} AND tenant_id = ${TENANT}
    `);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.name).toBe("Converted Account Ltd");
    expect(accounts[0]!.status).toBe("active");

    const deals = await scoped((tx) => tx<Array<{
      name: string; stage: string; valueMinor: string; contactId: string; status: string;
    }>>`
      SELECT name, stage, value_minor AS "valueMinor", contact_id AS "contactId", status
      FROM crm.deals WHERE id = ${body.dealId} AND tenant_id = ${TENANT}
    `);
    expect(deals).toHaveLength(1);
    expect(deals[0]!.name).toBe("Converted Opportunity");
    expect(deals[0]!.stage).toBe("Lead");
    expect(String(deals[0]!.valueMinor)).toBe("500000");
    expect(deals[0]!.contactId).toBe(APPLY_LEAD_ID);

    const leads = await scoped((tx) => tx<Array<{
      leadStatus: string; accountId: string | null; version: number;
    }>>`
      SELECT lead_status AS "leadStatus", account_id AS "accountId", version
      FROM crm.contacts WHERE id = ${APPLY_LEAD_ID} AND tenant_id = ${TENANT}
    `);
    expect(leads[0]!.leadStatus).toBe("converted");
    expect(leads[0]!.accountId).toBe(body.accountId);
    expect(leads[0]!.version).toBe(2);
  });

  it("emits crm.lead.converted and its audit event through the outbox", async () => {
    const events = await scoped((tx) => tx<Array<{ eventType: string }>>`
      SELECT event_type AS "eventType" FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type IN ('crm.lead.converted', 'audit.event.record')
    `);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("crm.lead.converted");
    expect(types).toContain("audit.event.record");
  });

  it("converts without an account when createAccount is false", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/leads/${APPLY_NO_ACCOUNT_LEAD_ID}/convert`,
      headers: headers(),
      payload: { createAccount: false },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().accountId).toBeNull();
    expect(res.json().dealId).toBeNull();

    await drainQueue();

    const leads = await scoped((tx) => tx<Array<{ leadStatus: string; accountId: string | null }>>`
      SELECT lead_status AS "leadStatus", account_id AS "accountId"
      FROM crm.contacts WHERE id = ${APPLY_NO_ACCOUNT_LEAD_ID} AND tenant_id = ${TENANT}
    `);
    expect(leads[0]!.leadStatus).toBe("converted");
    expect(leads[0]!.accountId).toBeNull();

    const deals = await scoped((tx) => tx<Array<{ count: string }>>`
      SELECT count(*) AS count FROM crm.deals
      WHERE contact_id = ${APPLY_NO_ACCOUNT_LEAD_ID} AND tenant_id = ${TENANT}
    `);
    expect(deals[0]!.count).toBe("0");
  });

  it("is idempotent — a redelivered command does not create a second account or deal", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.leadConvert);
    const accountId = "88888888-dddd-4000-8000-000000000001";
    const dealId = "99999999-dddd-4000-8000-000000000001";
    const msg = cmd({
      leadId: APPLY_LEAD_ID,
      leadName: "Apply Lead",
      createAccount: true,
      accountName: "Redelivered Account",
      dealName: "Redelivered Deal",
      dealValue: "1000",
      accountId,
      dealId,
    });

    await runWithTenant(TENANT, () => handler(msg));
    await runWithTenant(TENANT, () => handler(msg));

    const accounts = await scoped((tx) => tx<Array<{ count: string }>>`
      SELECT count(*) AS count FROM crm.accounts WHERE id = ${accountId} AND tenant_id = ${TENANT}
    `);
    expect(accounts[0]!.count).toBe("1");

    const deals = await scoped((tx) => tx<Array<{ count: string }>>`
      SELECT count(*) AS count FROM crm.deals WHERE id = ${dealId} AND tenant_id = ${TENANT}
    `);
    expect(deals[0]!.count).toBe("1");
  });

  it("rejects a lead that left a convertible status before the command was applied", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.leadConvert);
    const accountId = "88888888-dddd-4000-8000-000000000002";
    const msg = cmd({
      leadId: STALE_LEAD_ID,
      leadName: "Stale Lead",
      createAccount: true,
      accountName: "Should Not Exist",
      dealName: null,
      dealValue: null,
      accountId,
      dealId: null,
    });

    await runWithTenant(TENANT, () => handler(msg));

    const accounts = await scoped((tx) => tx<Array<{ count: string }>>`
      SELECT count(*) AS count FROM crm.accounts WHERE id = ${accountId} AND tenant_id = ${TENANT}
    `);
    expect(accounts[0]!.count).toBe("0");

    const leads = await scoped((tx) => tx<Array<{ leadStatus: string }>>`
      SELECT lead_status AS "leadStatus" FROM crm.contacts
      WHERE id = ${STALE_LEAD_ID} AND tenant_id = ${TENANT}
    `);
    expect(leads[0]!.leadStatus).toBe("new");
  });
});
