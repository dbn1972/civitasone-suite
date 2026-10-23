/**
 * CRM follow-up F5 (owner-approved on #2130): POST/PATCH /v1/crm/contacts and POST /v1/crm/activities
 * answer a SYNCHRONOUS 422 when the linked account was merged away / deactivated (ACCOUNT_INACTIVE)
 * or is unknown (ACCOUNT_NOT_FOUND), instead of 202 + a silent consumer-side rejection. The consumer
 * keeps its own in-transaction guard so a command queued while the account was live cannot bypass it.
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
import * as contactCommands from "../src/modules/contacts/commands.js";
import * as activityCommands from "../src/modules/activities/commands.js";
import { createContactBody } from "../src/modules/contacts/validators.js";
import { createActivityBody } from "../src/modules/activities/validators.js";
import type { RequestContext } from "@civitasone/types";

const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const auth = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["crm_admin"], sid: "sess-f5" }, SECRET)}`,
  "x-tenant-id": tenantId,
});

let app: FastifyInstance;
const cmdCtx = () => ({ tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), roles: ["crm_admin"] }) as unknown as RequestContext;

async function createAccount(name: string, tenantId = TENANT): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/crm/accounts", headers: auth(tenantId), payload: { name } });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return res.json().id as string;
}

/** A merge soft-deletes the duplicate to status = inactive; do the same directly. */
async function deactivate(accountId: string): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`UPDATE crm.accounts SET status = 'inactive' WHERE id = ${accountId} AND tenant_id = ${TENANT}`;
  });
}

async function count(table: "contacts" | "activities", id: string): Promise<number> {
  const rows = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx.unsafe(`SELECT 1 FROM crm.${table} WHERE id = '${id}'`);
  });
  return rows.length;
}

const newContact = (accountId?: string) => ({ name: "F5 Contact", ...(accountId ? { accountId } : {}) });
const newActivity = (accountId?: string) => ({ type: "call", subject: "F5 call", text: "follow-up", status: "open", ...(accountId ? { accountId } : {}) });

beforeAll(async () => {
  app = await buildApp();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("F5: contacts against a merged / inactive account", () => {
  it("POST: an active account is accepted and the contact lands", async () => {
    const accountId = await createAccount("Live Co");
    const res = await app.inject({ method: "POST", url: "/v1/crm/contacts", headers: auth(), payload: newContact(accountId) });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect(await count("contacts", res.json().id)).toBe(1);
  });

  it("POST: a merged / inactive account is 422 ACCOUNT_INACTIVE and nothing is queued", async () => {
    const accountId = await createAccount("Merged Co");
    await deactivate(accountId);
    const res = await app.inject({ method: "POST", url: "/v1/crm/contacts", headers: auth(), payload: newContact(accountId) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ACCOUNT_INACTIVE");
  });

  it("POST: an unknown or other-tenant account is 422 ACCOUNT_NOT_FOUND", async () => {
    const foreign = await createAccount("Foreign Co", OTHER_TENANT);
    for (const accountId of [foreign, randomUUID()]) {
      const res = await app.inject({ method: "POST", url: "/v1/crm/contacts", headers: auth(), payload: newContact(accountId) });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("ACCOUNT_NOT_FOUND");
    }
  });

  it("PATCH: re-pointing to a merged / inactive account is 422; an active account is 202; unlinking (null) is 202", async () => {
    const live = await createAccount("Patch Live");
    const dead = await createAccount("Patch Merged");
    const created = await app.inject({ method: "POST", url: "/v1/crm/contacts", headers: auth(), payload: newContact(live) });
    expect(created.statusCode).toBe(202);
    await drainQueue();
    const id = created.json().id as string;
    await deactivate(dead);

    const bad = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${id}`, headers: auth(), payload: { accountId: dead } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("ACCOUNT_INACTIVE");

    const ok = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${id}`, headers: auth(), payload: { accountId: live } });
    expect(ok.statusCode).toBe(202);
    const unlink = await app.inject({ method: "PATCH", url: `/v1/crm/contacts/${id}`, headers: auth(), payload: { accountId: null } });
    expect(unlink.statusCode).toBe(202);
  });

  it("consumer guard: a create that bypasses the route is still refused for a merged-away account", async () => {
    const accountId = await createAccount("Race Co");
    // A command already on the queue (published while the account was live) is modelled by publishing it
    // directly, bypassing the route check, once the account is dead: the consumer must still refuse it.
    await deactivate(accountId);
    const queued = await contactCommands.createContact(cmdCtx(), createContactBody.parse(newContact(accountId)));
    await drainQueue();
    expect(await count("contacts", queued.id)).toBe(0);
  });
});

describe("F5: activities against a merged / inactive account", () => {
  it("POST: an active account is accepted and the activity lands", async () => {
    const accountId = await createAccount("Act Live");
    const res = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: auth(), payload: newActivity(accountId) });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect(await count("activities", res.json().id)).toBe(1);
  });

  it("POST: a merged / inactive account is 422 ACCOUNT_INACTIVE", async () => {
    const accountId = await createAccount("Act Merged");
    await deactivate(accountId);
    const res = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: auth(), payload: newActivity(accountId) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ACCOUNT_INACTIVE");
  });

  it("POST: an unknown account is 422 ACCOUNT_NOT_FOUND; no account at all is still accepted", async () => {
    const missing = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: auth(), payload: newActivity(randomUUID()) });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe("ACCOUNT_NOT_FOUND");
    const none = await app.inject({ method: "POST", url: "/v1/crm/activities", headers: auth(), payload: newActivity() });
    expect(none.statusCode).toBe(202);
  });

  it("consumer guard: a create that bypasses the route is still refused for a merged-away account", async () => {
    const accountId = await createAccount("Act Race");
    await deactivate(accountId);
    const queued = await activityCommands.createActivity(cmdCtx(), createActivityBody.parse(newActivity(accountId)));
    await drainQueue();
    expect(await count("activities", queued.id)).toBe(0);
  });
});
