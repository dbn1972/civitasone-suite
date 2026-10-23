/**
 * Stabilisation of the integrated CRM branch -- contacts and activities link only to a LIVE account.
 *
 * The account lists, the picker search and the by-id lookup serve accounts with status = 'active'
 * only, so a merged / soft-deleted account is not offered anywhere. Deals and service requests
 * already refuse to link to one; the contact and activity consumers (contacts/repo.ts
 * accountExistsTx, shared by activities/consumer.ts) must too, otherwise a direct API caller can
 * attach a row to a dead account, and account-merge never re-points rows linked after the merge.
 *
 * Real route -> queue -> consumer -> DB round trips (needs the disposable Postgres). Since CRM F5 the
 * ROUTE refuses a dead / unknown account synchronously (422 ACCOUNT_INACTIVE / ACCOUNT_NOT_FOUND, see
 * f5-account-link-422.test.ts). These tests keep proving the CONSUMER guard stays in force for a command
 * that bypasses the route (queued while the account was still live, or published directly): the write is
 * refused and audited as a rejected command, exactly as it is for an account of another tenant.
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
import { accountExists } from "../src/modules/contacts/repo.js";
import * as contactCommands from "../src/modules/contacts/commands.js";
import * as activityCommands from "../src/modules/activities/commands.js";
import { createContactBody, updateContactBody } from "../src/modules/contacts/validators.js";
import { createActivityBody } from "../src/modules/activities/validators.js";
import type { RequestContext } from "@civitasone/types";
import { drainQueue } from "./consumer-harness.js";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const auth = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["crm_admin"], sid: "sess-stab-links" }, SECRET)}`,
  "x-tenant-id": TENANT,
});

let app: FastifyInstance;

/** A request context for publishing a command straight onto the queue, i.e. bypassing the route's 422 check. */
const cmdCtx = () => ({ tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), roles: ["crm_admin"] }) as unknown as RequestContext;

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>, tenantId = TENANT): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function createAccount(name: string, headers = auth()): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/crm/accounts", headers, payload: { name } });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return res.json().id as string;
}
async function setAccountStatus(id: string, status: string): Promise<void> {
  await scoped((tx) => tx`UPDATE crm.accounts SET status = ${status} WHERE id = ${id} AND tenant_id = ${TENANT}`);
}
async function mergeAway(): Promise<{ primaryId: string; duplicateId: string }> {
  const primaryId = await createAccount(`Stab link primary ${randomUUID()}`);
  const duplicateId = await createAccount(`Stab link duplicate ${randomUUID()}`);
  const merged = await app.inject({ method: "POST", url: "/v1/crm/accounts/merge", headers: auth(), payload: { primaryId, duplicateId } });
  expect(merged.statusCode).toBe(202);
  await drainQueue();
  // the real merge soft-deletes the duplicate: it is no longer a live account
  const rows = await scoped((tx) => tx<Array<{ id: string; status: string }>>`
    SELECT id, status FROM crm.accounts WHERE tenant_id = ${TENANT} AND id IN (${primaryId}, ${duplicateId})`);
  expect(rows.find((r) => r.id === duplicateId)?.status).toBe("inactive");
  expect(rows.find((r) => r.id === primaryId)?.status).toBe("active");
  return { primaryId, duplicateId };
}

interface ContactRow { accountId: string | null; name: string; city: string | null }
async function contactRow(id: string): Promise<ContactRow | undefined> {
  const rows = await scoped((tx) => tx<ContactRow[]>`
    SELECT account_id AS "accountId", name, city FROM crm.contacts WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return rows[0];
}
async function contactCountByName(name: string): Promise<number> {
  const rows = await scoped((tx) => tx<Array<{ n: number }>>`SELECT count(*)::int AS n FROM crm.contacts WHERE tenant_id = ${TENANT} AND name = ${name}`);
  return rows[0]?.n ?? 0;
}
async function createContactVia(payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/crm/contacts", headers: auth(), payload });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return res.json().id as string;
}
async function activityAccount(id: string): Promise<{ accountId: string | null } | undefined> {
  const rows = await scoped((tx) => tx<Array<{ accountId: string | null }>>`
    SELECT account_id AS "accountId" FROM crm.activities WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return rows[0];
}
async function activityCountByText(text: string): Promise<number> {
  const rows = await scoped((tx) => tx<Array<{ n: number }>>`SELECT count(*)::int AS n FROM crm.activities WHERE tenant_id = ${TENANT} AND text = ${text}`);
  return rows[0]?.n ?? 0;
}

/** The audit outcomes recorded for one row, oldest first (a refused command is audited, never silently dropped). */
async function auditOutcomes(resourceType: "contact" | "activity", id: string): Promise<Array<{ action: string; outcome: string }>> {
  const rows = await scoped((tx) => tx<Array<{ payload: { action: string; outcome: string } }>>`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
      AND payload->>'resourceType' = ${resourceType} AND payload->>'resourceId' = ${id}
    ORDER BY created_at ASC`);
  return rows.map((r) => ({ action: r.payload.action, outcome: r.payload.outcome }));
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {}));
  await scoped((tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {}));
  await scoped((tx) => tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {}));
  await scoped((tx) => tx`DELETE FROM crm.accounts WHERE tenant_id = ${OTHER_TENANT}`.catch(() => {}), OTHER_TENANT);
  await scoped((tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {}));
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

describe("accountExists / accountExistsTx (contacts repo) count only live accounts of the caller's tenant", () => {
  it("true for an active account; false once inactive, again true once reactivated; false for another tenant's account", async () => {
    const id = await createAccount(`Stab exists ${randomUUID()}`);
    expect(await runWithTenant(TENANT, () => accountExists(TENANT, id))).toBe(true);
    await setAccountStatus(id, "inactive");
    expect(await runWithTenant(TENANT, () => accountExists(TENANT, id))).toBe(false);
    await setAccountStatus(id, "active");
    expect(await runWithTenant(TENANT, () => accountExists(TENANT, id))).toBe(true);
    // never another tenant's account, active or not
    expect(await runWithTenant(OTHER_TENANT, () => accountExists(OTHER_TENANT, id))).toBe(false);
  });
});

describe("a contact can be linked only to a live (active) account", () => {
  it("create: an account merged away is refused (no contact row), the surviving account links", async () => {
    const { primaryId, duplicateId } = await mergeAway();

    // F5: the route refuses synchronously...
    const sync = await app.inject({ method: "POST", url: "/v1/crm/contacts", headers: auth(), payload: { name: "Stab contact to merged", accountId: duplicateId } });
    expect(sync.statusCode).toBe(422);
    expect(sync.json().code).toBe("ACCOUNT_INACTIVE");
    // ...and the consumer still gates a command that bypasses the route
    const queued = await contactCommands.createContact(cmdCtx(), createContactBody.parse({ name: "Stab contact to merged", accountId: duplicateId }));
    const refused = { json: () => ({ id: queued.id }) };
    await drainQueue();
    expect(await contactCountByName("Stab contact to merged")).toBe(0);
    expect(await contactRow(refused.json().id as string)).toBeUndefined();
    // the merged-away account is a same-tenant account that is no longer live: audited as such, not as cross-tenant
    expect(await auditOutcomes("contact", refused.json().id as string)).toEqual([{ action: "create", outcome: "rejected_inactive_account" }]);

    const ok = await createContactVia({ name: "Stab contact to survivor", accountId: primaryId });
    expect((await contactRow(ok))?.accountId).toBe(primaryId);
  });

  it("update: re-assigning to an inactive account is refused whole (nothing else in the patch lands); active links; null unlinks", async () => {
    const accountId = await createAccount(`Stab contact account ${randomUUID()}`);
    const contactId = await createContactVia({ name: "Stab contact patch", city: "Delhi" });
    await setAccountStatus(accountId, "inactive");

    const sync = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${contactId}`, headers: auth(), payload: { accountId, city: "Pune" } });
    expect(sync.statusCode).toBe(422); // F5: refused at the route; the consumer guard is exercised by a direct command
    expect(sync.json().code).toBe("ACCOUNT_INACTIVE");
    await contactCommands.updateContact(cmdCtx(), contactId, updateContactBody.parse({ accountId, city: "Pune" }));
    await drainQueue();
    expect(await contactRow(contactId)).toMatchObject({ accountId: null, city: "Delhi" });
    expect((await auditOutcomes("contact", contactId)).filter((a) => a.action === "update")).toEqual([
      { action: "update", outcome: "rejected_inactive_account" },
    ]);

    // reactivated: linkable again (the check follows the account's live status; nothing is cached)
    await setAccountStatus(accountId, "active");
    const again = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${contactId}`, headers: auth(), payload: { accountId } });
    expect(again.statusCode).toBe(202);
    await drainQueue();
    expect((await contactRow(contactId))?.accountId).toBe(accountId);

    // the account goes inactive AFTER the link: an edit that does not touch the link still lands (the edit
    // form sends accountId only when it changed) and unlinking still works
    await setAccountStatus(accountId, "inactive");
    const edit = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${contactId}`, headers: auth(), payload: { city: "Mumbai" } });
    expect(edit.statusCode).toBe(202);
    await drainQueue();
    expect(await contactRow(contactId)).toMatchObject({ accountId, city: "Mumbai" });
    const unlink = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${contactId}`, headers: auth(), payload: { accountId: null } });
    expect(unlink.statusCode).toBe(202);
    await drainQueue();
    expect((await contactRow(contactId))?.accountId).toBeNull();
  });
});

describe("an account that is not in this tenant at all is still audited as rejected_cross_tenant_account", () => {
  it("contact create / update and activity create against an unknown account id", async () => {
    const unknown = randomUUID();

    // F5: the routes answer 422 ACCOUNT_NOT_FOUND; the consumer guard is driven by direct commands
    const contactId = await createContactVia({ name: "Stab contact for unknown patch" });
    for (const [method, url, payload] of [
      ["POST", "/v1/crm/contacts", { name: "Stab contact unknown account", accountId: unknown }],
      ["PATCH", `/v1/crm/contacts/${contactId}`, { accountId: unknown }],
      ["POST", "/v1/crm/activities", { text: "Stab note unknown account", type: "note", accountId: unknown }],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(), payload });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("ACCOUNT_NOT_FOUND");
    }
    const createdId = (await contactCommands.createContact(cmdCtx(), createContactBody.parse({ name: "Stab contact unknown account", accountId: unknown }))).id;
    const created = { json: () => ({ id: createdId }) };
    await contactCommands.updateContact(cmdCtx(), contactId, updateContactBody.parse({ accountId: unknown }));
    const noteId = (await activityCommands.createActivity(cmdCtx(), createActivityBody.parse({ text: "Stab note unknown account", type: "note", accountId: unknown }))).id;
    const note = { json: () => ({ id: noteId }) };
    await drainQueue();

    expect(await auditOutcomes("contact", created.json().id as string)).toEqual([{ action: "create", outcome: "rejected_cross_tenant_account" }]);
    expect((await auditOutcomes("contact", contactId)).filter((a) => a.action === "update")).toEqual([
      { action: "update", outcome: "rejected_cross_tenant_account" },
    ]);
    expect(await auditOutcomes("activity", note.json().id as string)).toEqual([{ action: "create", outcome: "rejected_cross_tenant_account" }]);
  });
});

describe("an activity can be logged against a live (active) account only", () => {
  it("create: an account merged away is refused (no activity row), the surviving account takes it", async () => {
    const { primaryId, duplicateId } = await mergeAway();

    const sync = await app.inject({
      method: "POST", url: "/v1/crm/activities", headers: auth(),
      payload: { text: "Stab note on merged account", type: "note", accountId: duplicateId },
    });
    expect(sync.statusCode).toBe(422); // F5: refused at the route; the consumer guard is exercised by a direct command
    expect(sync.json().code).toBe("ACCOUNT_INACTIVE");
    const queued = await activityCommands.createActivity(cmdCtx(), createActivityBody.parse({ text: "Stab note on merged account", type: "note", accountId: duplicateId }));
    const refused = { json: () => ({ id: queued.id }) };
    await drainQueue();
    expect(await activityCountByText("Stab note on merged account")).toBe(0);
    expect(await activityAccount(refused.json().id as string)).toBeUndefined();
    expect(await auditOutcomes("activity", refused.json().id as string)).toEqual([{ action: "create", outcome: "rejected_inactive_account" }]);

    const ok = await app.inject({
      method: "POST", url: "/v1/crm/activities", headers: auth(),
      payload: { text: "Stab note on survivor", type: "note", accountId: primaryId },
    });
    expect(ok.statusCode).toBe(202);
    await drainQueue();
    expect(await activityAccount(ok.json().id as string)).toEqual({ accountId: primaryId });
  });

  it("create: an account that goes inactive is refused until it is reactivated", async () => {
    const accountId = await createAccount(`Stab activity account ${randomUUID()}`);
    await setAccountStatus(accountId, "inactive");
    const sync = await app.inject({
      method: "POST", url: "/v1/crm/activities", headers: auth(),
      payload: { text: "Stab note on inactive account", type: "note", accountId },
    });
    expect(sync.statusCode).toBe(422); // F5: refused at the route; the consumer guard is exercised by a direct command
    expect(sync.json().code).toBe("ACCOUNT_INACTIVE");
    const queued = await activityCommands.createActivity(cmdCtx(), createActivityBody.parse({ text: "Stab note on inactive account", type: "note", accountId }));
    const refused = { json: () => ({ id: queued.id }) };
    await drainQueue();
    expect(await activityCountByText("Stab note on inactive account")).toBe(0);
    expect(await auditOutcomes("activity", refused.json().id as string)).toEqual([{ action: "create", outcome: "rejected_inactive_account" }]);

    await setAccountStatus(accountId, "active");
    const ok = await app.inject({
      method: "POST", url: "/v1/crm/activities", headers: auth(),
      payload: { text: "Stab note on reactivated account", type: "note", accountId },
    });
    expect(ok.statusCode).toBe(202);
    await drainQueue();
    expect(await activityAccount(ok.json().id as string)).toEqual({ accountId });
  });
});
