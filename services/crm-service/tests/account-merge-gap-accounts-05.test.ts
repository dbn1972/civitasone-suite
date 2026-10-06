/**
 * GAP-CRM-ACCOUNTS-05 — account merge is a server-side, admin-gated, audited,
 * irreversible operation (not a client-only control).
 *
 * Verifies POST /v1/crm/accounts/merge:
 *   - requires an admin role (403 for a plain crm_user),
 *   - re-parents the duplicate's contacts onto the primary,
 *   - tombstones (soft-deletes) the duplicate so it leaves the active list,
 *   - writes an audit row for action=merge, resourceType=account carrying the
 *     acting user's id and outcome=success.
 *
 * Writes are CQRS (route 202 → consumer applies), so each mutation drains the
 * queue and state is asserted through the read path / outbox.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-00000000a005";
const ACTOR = "cccccccc-3333-4000-8000-00000000a005";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-a05" }, SECRET);
}
function headers(roles: string[]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT, "content-type": "application/json" };
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of ["activities", "contacts", "accounts"]) {
      await tx.unsafe(`DELETE FROM crm.${t} WHERE tenant_id = '${TENANT}'`).catch(() => {});
    }
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

async function post(url: string, payload: unknown, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url, headers: headers(roles), payload: payload as object });
  await app.close();
  await drainQueue();
  return res;
}
async function get(url: string, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url, headers: headers(roles) });
  await app.close();
  return res;
}

describe("GAP-CRM-ACCOUNTS-05 account merge (server-side, gated, audited)", () => {
  it("rejects a non-admin (crm_user) with 403", async () => {
    const res = await post(
      "/v1/crm/accounts/merge",
      { primaryId: randomUUID(), duplicateId: randomUUID() },
      ["crm_user"],
    );
    expect(res.statusCode).toBe(403);
  });

  it("re-parents contacts, tombstones the duplicate and writes an audit row with the actor", async () => {
    const accA = await post("/v1/crm/accounts", { name: "Primary Org", industry: "Gov" }, ["crm_admin"]);
    const accB = await post("/v1/crm/accounts", { name: "Duplicate Org", website: "https://dup.example" }, ["crm_admin"]);
    const primaryId = accA.json().id as string;
    const duplicateId = accB.json().id as string;

    // A contact under the duplicate must follow to the primary after the merge.
    const contact = await post("/v1/crm/contacts", { name: "Linked Contact", accountId: duplicateId }, ["crm_admin"]);
    const contactId = contact.json().id as string;

    const merged = await post("/v1/crm/accounts/merge", { primaryId, duplicateId }, ["crm_admin"]);
    expect(merged.statusCode).toBe(202);

    // Duplicate tombstoned → absent from the active list; primary remains.
    const list = await get("/v1/crm/accounts", ["crm_admin"]);
    const ids = list.json().data.map((a: { id: string }) => a.id);
    expect(ids).toContain(primaryId);
    expect(ids).not.toContain(duplicateId);

    // Contact re-parented onto the primary.
    const contactAfter = await get(`/v1/crm/contacts/${contactId}`, ["crm_admin"]);
    expect(contactAfter.json().accountId).toBe(primaryId);

    // Audit trail: a merge/account audit row for the primary, carrying the
    // acting user id and a success outcome.
    const audits = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ actorId: string; payload: { action: string; resourceType: string; resourceId: string; outcome: string } }>>`
        SELECT actor_id AS "actorId", payload FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
          AND payload->>'resourceType' = 'account'
          AND payload->>'resourceId' = ${primaryId}
      `;
    });
    const mergeAudit = audits.find((a) => a.payload.action === "merge");
    expect(mergeAudit, "expected a merge audit row for the primary account").toBeDefined();
    expect(mergeAudit!.payload.outcome).toBe("success");
    expect(mergeAudit!.actorId).toBe(ACTOR);
  });
});
