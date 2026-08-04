/**
 * CM-002 account relationships/groups + CM-003 widened contact-role vocabulary.
 * HTTP -> consumer -> DB round-trips.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000cd002";
const ACTOR = "cccccccc-3333-4000-8000-0000000cd002";
const A = "44444444-aaaa-4000-8000-0000000cd002";
const B = "44444444-bbbb-4000-8000-0000000cd002";
const C = "44444444-cccc-4000-8000-0000000cd002";
const CONTACT = "22222222-bbbb-4000-8000-0000000cd002";
const DEAL = "33333333-cccc-4000-8000-0000000cd002";

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "x-tenant-id": TENANT };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.account_relationships WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contact_roles WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const [id, name] of [[A, "Parent Co"], [B, "Sub Co"], [C, "Partner Co"]] as const) {
      await tx`INSERT INTO crm.accounts (id, tenant_id, name, status, version, created_at, updated_at, created_by, updated_by)
               VALUES (${id}, ${TENANT}, ${name}, 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
    }
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${CONTACT}, ${TENANT}, 'Role Contact', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${DEAL}, ${TENANT}, 'Deal', 'Proposal', 100000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
  });
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function createRel(fromId: string, payload: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: `/v1/crm/accounts/${fromId}/relationships`, headers: headers(), payload });
  await app.close();
  await drainQueue();
  return res;
}

async function listRels(fromId: string) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/crm/accounts/${fromId}/relationships`, headers: headers() });
  await app.close();
  return res.json().data as Array<Record<string, unknown>>;
}

describe("CM-002 account relationships", () => {
  it("creates a relationship (202) and reads it back with the related name", async () => {
    const res = await createRel(A, { toAccountId: B, relType: "subsidiary" });
    expect(res.statusCode).toBe(202);
    const rows = await listRels(A);
    expect(rows.length).toBe(1);
    expect(rows[0].toAccountId).toBe(B);
    expect(rows[0].relType).toBe("subsidiary");
    expect(rows[0].toAccountName).toBe("Sub Co");
  });

  it("supports partner/group edges", async () => {
    await createRel(A, { toAccountId: C, relType: "partner" });
    const rows = await listRels(A);
    expect(rows.map((r) => r.relType).sort()).toEqual(["partner", "subsidiary"]);
  });

  it("rejects a self-relationship (400)", async () => {
    const res = await createRel(A, { toAccountId: A, relType: "group" });
    expect(res.statusCode).toBe(400);
  });

  it("404s when the target account is not in this tenant", async () => {
    const res = await createRel(A, { toAccountId: "44444444-9999-4000-8000-0000000cd002", relType: "branch" });
    expect(res.statusCode).toBe(404);
  });

  it("deletes a relationship (202)", async () => {
    const created = await createRel(B, { toAccountId: C, relType: "affiliate" });
    const relId = created.json().id;
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/v1/crm/accounts/${B}/relationships/${relId}`, headers: headers() });
    await app.close();
    await drainQueue();
    expect(res.statusCode).toBe(202);
    expect((await listRels(B)).map((r) => r.id)).not.toContain(relId);
  });

  it("404s a delete of a missing relationship", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/v1/crm/accounts/${A}/relationships/ffffffff-ffff-4000-8000-ffffffffffff`, headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("CM-003 widened contact-role vocabulary", () => {
  for (const role of ["beneficiary", "partner", "billing_contact"]) {
    it(`accepts the '${role}' role`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: `/v1/crm/contacts/${CONTACT}/roles`, headers: headers(), payload: { dealId: DEAL, role } });
      await app.close();
      await drainQueue();
      expect(res.statusCode).toBe(202);
      const listApp = await buildApp();
      const listed = await listApp.inject({ method: "GET", url: `/v1/crm/contacts/${CONTACT}/roles`, headers: headers() });
      await listApp.close();
      expect((listed.json().data as Array<Record<string, unknown>>).some((r) => r.role === role)).toBe(true);
    });
  }
});
