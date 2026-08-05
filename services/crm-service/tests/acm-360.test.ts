/**
 * CM-004 360-degree view. Seeds CRM-local related records for a contact + account,
 * then asserts the aggregation and the honest external stubs.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000cd004";
const ACTOR = "cccccccc-3333-4000-8000-0000000cd004";
const ACCOUNT = "44444444-aaaa-4000-8000-0000000cd004";
const CONTACT = "22222222-bbbb-4000-8000-0000000cd004";
const DEAL = "33333333-cccc-4000-8000-0000000cd004";

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "x-tenant-id": TENANT };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.communications WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.addresses WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
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
    await tx`INSERT INTO crm.accounts (id, tenant_id, name, industry, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${ACCOUNT}, ${TENANT}, 'Acme Corp', 'manufacturing', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, account_id, lead_status, status, marketing_consent, consent_date, score, version, created_at, updated_at, created_by, updated_by)
             VALUES (${CONTACT}, ${TENANT}, 'Jane Buyer', ${ACCOUNT}, 'qualified', 'active', true, '2026-07-01', 72, 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO crm.deals (id, tenant_id, name, stage, contact_id, value_minor, currency, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${DEAL}, ${TENANT}, 'Acme Deal', 'Proposal', ${CONTACT}, 500000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, type, subject, status, version, created_at, created_by, updated_by, updated_at)
             VALUES (gen_random_uuid(), ${TENANT}, 'CRM User', 'called Jane', ${CONTACT}, 'call', 'call', 'open', 1, now(), ${ACTOR}, ${ACTOR}, now())`;
    await tx`INSERT INTO crm.communications (id, tenant_id, subject_type, subject_id, direction, channel, summary, occurred_at, logged_by)
             VALUES (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT}, 'outbound', 'email', 'quote sent', now(), ${ACTOR})`;
    await tx`INSERT INTO crm.addresses (id, tenant_id, owner_type, owner_id, address_type, line1, city, country, is_primary, created_by, updated_by)
             VALUES (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT}, 'billing', '9 Park St', 'Kolkata', 'IN', true, ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO crm.contact_roles (id, tenant_id, contact_id, deal_id, role, created_by)
             VALUES (gen_random_uuid(), ${TENANT}, ${CONTACT}, ${DEAL}, 'decision_maker', ${ACTOR})`;
  });
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function get360(kind: "contacts" | "accounts", id: string, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/crm/${kind}/${id}/360`, headers: headers(roles) });
  await app.close();
  return res;
}

describe("CM-004 contact 360", () => {
  it("aggregates every CRM-local related record", async () => {
    const res = await get360("contacts", CONTACT);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.contact.id).toBe(CONTACT);
    expect(d.contact.score).toBe(72);
    expect(d.consent.marketingConsent).toBe(true);
    expect(d.activities.length).toBe(1);
    expect(d.localCommunications.length).toBe(1);
    expect(d.deals.length).toBe(1);
    expect(d.addresses.length).toBe(1);
    expect(d.contactRoles.length).toBe(1);
  });

  it("returns honest external stubs (null, not 0) for cross-service data", async () => {
    const d = (await get360("contacts", CONTACT)).json().data;
    expect(d.external.helpdeskCases).toEqual({ count: null, source: "external" });
    expect(d.external.knowledgeDocuments).toEqual({ count: null, source: "external" });
  });

  it("404s an unknown contact", async () => {
    const res = await get360("contacts", "ffffffff-ffff-4000-8000-ffffffffffff");
    expect(res.statusCode).toBe(404);
  });

  it("403s a caller without a CRM role", async () => {
    const res = await get360("contacts", CONTACT, ["citizen"]);
    expect(res.statusCode).toBe(403);
  });
});

describe("CM-004 account 360", () => {
  it("aggregates contacts, deals (via contacts), addresses and stubs", async () => {
    const res = await get360("accounts", ACCOUNT);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.account.id).toBe(ACCOUNT);
    expect(d.contacts.length).toBe(1);
    expect(d.deals.length).toBe(1);
    expect(d.external.helpdeskCases.count).toBeNull();
  });

  it("404s an unknown account", async () => {
    const res = await get360("accounts", "ffffffff-ffff-4000-8000-ffffffffffff");
    expect(res.statusCode).toBe(404);
  });
});
