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
    for (const t of ["service_requests", "account_relationships", "activities", "contacts", "accounts"]) {
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

// ── The rest of the account footprint follows the primary ─────────────────────
// The merge used to move only contacts / plans / QBRs / tenders / onboarding, so child
// accounts (accounts.parent_id), account-subject activities (activities.account_id)
// and account_relationships edges kept pointing at the tombstoned duplicate.

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function patchParent(id: string, parentId: string | null): Promise<void> {
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/crm/accounts/${id}/parent`,
    headers: headers(["crm_admin"]),
    payload: { parentId },
  });
  await app.close();
  expect(res.statusCode).toBe(202);
  await drainQueue();
}

async function newAccount(name: string): Promise<string> {
  const res = await post("/v1/crm/accounts", { name }, ["crm_admin"]);
  expect(res.statusCode).toBe(202);
  return res.json().id as string;
}

async function parentOf(id: string): Promise<string | null> {
  const rows = await scoped((tx) => tx<Array<{ parentId: string | null }>>`
    SELECT parent_id AS "parentId" FROM crm.accounts WHERE id = ${id}`);
  return rows[0]!.parentId;
}

async function mergeAccounts(primaryId: string, duplicateId: string): Promise<void> {
  const res = await post("/v1/crm/accounts/merge", { primaryId, duplicateId }, ["crm_admin"]);
  expect(res.statusCode).toBe(202);
}

describe("GAP-CRM-ACCOUNTS-05 merge re-points child accounts, activities and relationships", () => {
  it("moves child accounts, account activities and relationship edges onto the primary", async () => {
    const [primary, duplicate, child, other, third] = [
      await newAccount("Merge Primary"),
      await newAccount("Merge Duplicate"),
      await newAccount("Merge Child"),
      await newAccount("Merge Other"),
      await newAccount("Merge Third"),
    ] as [string, string, string, string, string];
    await patchParent(child, duplicate);
    expect(await parentOf(child)).toBe(duplicate);

    await scoped(async (tx) => {
      await tx`INSERT INTO crm.activities (tenant_id, actor_name, text, account_id, created_by)
               VALUES (${TENANT}, 'Tester', 'Called the duplicate', ${duplicate}, ${ACTOR})`;
      // duplicate -> other (partner) and other -> duplicate (group): both must follow.
      // duplicate <-> primary: would become a self-loop, so it is dropped.
      // primary -> third (affiliate) already exists, duplicate -> third (affiliate) collides
      // with it and is dropped; duplicate -> third (partner) does not collide and moves.
      await tx`INSERT INTO crm.account_relationships (tenant_id, from_account_id, to_account_id, rel_type, created_by) VALUES
        (${TENANT}, ${duplicate}, ${other}, 'partner', ${ACTOR}),
        (${TENANT}, ${other}, ${duplicate}, 'group', ${ACTOR}),
        (${TENANT}, ${duplicate}, ${primary}, 'partner', ${ACTOR}),
        (${TENANT}, ${primary}, ${duplicate}, 'subsidiary', ${ACTOR}),
        (${TENANT}, ${primary}, ${third}, 'affiliate', ${ACTOR}),
        (${TENANT}, ${duplicate}, ${third}, 'affiliate', ${ACTOR}),
        (${TENANT}, ${duplicate}, ${third}, 'partner', ${ACTOR})`;
    });

    await mergeAccounts(primary, duplicate);

    // Child account now hangs off the primary.
    expect(await parentOf(child)).toBe(primary);
    const kids = (await get(`/v1/crm/accounts/${primary}/children`, ["crm_admin"])).json().data as Array<{ id: string }>;
    expect(kids.map((k) => k.id)).toContain(child);

    // The account-subject activity follows the primary.
    const acts = await scoped((tx) => tx<Array<{ accountId: string }>>`
      SELECT account_id AS "accountId" FROM crm.activities WHERE tenant_id = ${TENANT}`);
    expect(acts.map((a) => a.accountId)).toEqual([primary]);

    // Relationship edges: nothing references the duplicate, no self-loop, no duplicate edge.
    const edges = await scoped((tx) => tx<Array<{ from: string; to: string; type: string }>>`
      SELECT from_account_id AS "from", to_account_id AS "to", rel_type AS "type"
      FROM crm.account_relationships WHERE tenant_id = ${TENANT}`);
    expect(edges.some((e) => e.from === duplicate || e.to === duplicate)).toBe(false);
    expect(edges.some((e) => e.from === e.to)).toBe(false);
    const key = (e: { from: string; to: string; type: string }) => `${e.from}>${e.to}:${e.type}`;
    expect(edges.map(key).sort()).toEqual(
      [
        `${primary}>${other}:partner`,
        `${other}>${primary}:group`,
        `${primary}>${third}:affiliate`,
        `${primary}>${third}:partner`,
      ].sort(),
    );
  });

  it("re-points account follow-up service requests, so 'View related account' lands on the primary", async () => {
    const primary = await newAccount("SR Primary");
    const duplicate = await newAccount("SR Duplicate");
    const unrelated = await newAccount("SR Unrelated");
    const followUp = async (relatedAccountId: string): Promise<string> => {
      const res = await post(
        "/v1/crm/service-requests",
        { citizenName: "Suresh Rao", serviceType: "Account Health Follow-up", subject: "Account health follow-up", relatedAccountId },
        ["crm_admin"],
      );
      expect(res.statusCode).toBe(201);
      return res.json().data.id as string;
    };
    const onDuplicate = await followUp(duplicate);
    const onUnrelated = await followUp(unrelated);

    await mergeAccounts(primary, duplicate);

    // Real-DB read (not a mock): nothing references the tombstoned duplicate any more.
    const rows = await scoped((tx) => tx<Array<{ id: string; relatedAccountId: string | null }>>`
      SELECT id, related_account_id AS "relatedAccountId" FROM crm.service_requests
      WHERE tenant_id = ${TENANT} AND id IN (${onDuplicate}, ${onUnrelated})`);
    const byId = new Map(rows.map((r) => [r.id, r.relatedAccountId]));
    expect(byId.get(onDuplicate)).toBe(primary);
    expect(byId.get(onUnrelated)).toBe(unrelated);

    // The detail read the "View related account" link is built from points at a live account.
    const detail = await get(`/v1/crm/service-requests/${onDuplicate}`, ["crm_admin"]);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.relatedAccountId).toBe(primary);
    const target = await get(`/v1/crm/accounts/${primary}`, ["crm_admin"]);
    expect(target.statusCode).toBe(200);
  });

  it("records the merged-away account id in the audit row, not only the survivor", async () => {
    const primary = await newAccount("Audit Primary");
    const duplicate = await newAccount("Audit Duplicate");
    await mergeAccounts(primary, duplicate);
    const audits = await scoped((tx) => tx<Array<{ payload: { action: string; resourceId: string; metadata?: { mergedFrom?: string } } }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'resourceType' = 'account' AND payload->>'action' = 'merge'
        AND payload->>'resourceId' = ${primary}`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload.metadata?.mergedFrom).toBe(duplicate);
  });

  it("never closes a hierarchy loop when the primary sits inside the duplicate's subtree", async () => {
    // duplicate -> mid -> primary, plus a sibling branch duplicate -> sibling.
    const [grand, duplicate, mid, primary, sibling] = [
      await newAccount("Loop Grandparent"),
      await newAccount("Loop Duplicate"),
      await newAccount("Loop Mid"),
      await newAccount("Loop Primary"),
      await newAccount("Loop Sibling"),
    ] as [string, string, string, string, string];
    await patchParent(duplicate, grand);
    await patchParent(mid, duplicate);
    await patchParent(primary, mid);
    await patchParent(sibling, duplicate);

    await mergeAccounts(primary, duplicate);

    // The duplicate's own child on the path to the primary is lifted to the duplicate's
    // parent (otherwise mid -> primary -> mid would loop); everything else moves under
    // the primary.
    expect(await parentOf(mid)).toBe(grand);
    expect(await parentOf(sibling)).toBe(primary);
    expect(await parentOf(primary)).toBe(mid);
    // Walking up from the primary terminates at the top.
    const chain: string[] = [];
    for (let cur: string | null = primary; cur && chain.length < 10; cur = await parentOf(cur)) chain.push(cur);
    expect(chain).toEqual([primary, mid, grand]);
  });

  it("lifts the primary itself to the duplicate's parent when the primary was the duplicate's child", async () => {
    const [grand, duplicate, primary, sibling] = [
      await newAccount("Lift Grandparent"),
      await newAccount("Lift Duplicate"),
      await newAccount("Lift Primary"),
      await newAccount("Lift Sibling"),
    ] as [string, string, string, string];
    await patchParent(duplicate, grand);
    await patchParent(primary, duplicate);
    await patchParent(sibling, duplicate);

    await mergeAccounts(primary, duplicate);

    expect(await parentOf(primary)).toBe(grand);
    expect(await parentOf(sibling)).toBe(primary);
  });

  it("lifts the path node to top level when the duplicate itself had no parent", async () => {
    const [duplicate, mid, primary] = [
      await newAccount("Top Duplicate"),
      await newAccount("Top Mid"),
      await newAccount("Top Primary"),
    ] as [string, string, string];
    await patchParent(mid, duplicate);
    await patchParent(primary, mid);

    await mergeAccounts(primary, duplicate);

    expect(await parentOf(mid)).toBeNull(); // lifted to the duplicate's (absent) parent
    expect(await parentOf(primary)).toBe(mid);
  });

  it("does not adopt the duplicate's parent when that would put the primary under its own descendant", async () => {
    // primary (top) -> parent-of-dup -> duplicate. Adopting parent-of-dup as the
    // primary's parent would make primary -> parent-of-dup -> primary.
    const [primary, middle, duplicate] = [
      await newAccount("Adopt Primary"),
      await newAccount("Adopt Middle"),
      await newAccount("Adopt Duplicate"),
    ] as [string, string, string];
    await patchParent(middle, primary);
    await patchParent(duplicate, middle);

    await mergeAccounts(primary, duplicate);

    expect(await parentOf(primary)).toBeNull();
    expect(await parentOf(middle)).toBe(primary);
  });
});
