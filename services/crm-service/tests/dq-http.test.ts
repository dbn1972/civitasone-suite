/**
 * Data Quality & Duplicate Management — HTTP round-trip tests (DQ-001..DQ-004).
 *
 * Writes are CQRS: routes return 202 and the consumer applies the row, so every
 * mutating helper drains the queue and state is asserted through the read path.
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
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000d1";
const ACTOR = "cccccccc-3333-4000-8000-0000000000d1";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-dq" }, SECRET);
}
function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT, "content-type": "application/json" };
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of ["activities", "dedup_rules", "account_plans", "contacts", "accounts"]) {
      await tx.unsafe(`DELETE FROM crm.${t} WHERE tenant_id = '${TENANT}'`).catch(() => {});
    }
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
async function put(url: string, payload: unknown, roles = ["crm_admin"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "PUT", url, headers: headers(roles), payload: payload as object });
  await app.close();
  return res;
}

async function createContact(fields: Record<string, unknown>, roles = ["crm_user"]) {
  const res = await post("/v1/crm/contacts", { name: "DQ Test", ...fields }, roles);
  return res;
}

// ── DQ-003: format validation ────────────────────────────────────────────────
describe("DQ-003 format validation", () => {
  it("rejects an invalid mobile with INVALID_MOBILE (400)", async () => {
    const res = await createContact({ phone: "12345" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("INVALID_MOBILE");
  });
  it("rejects an invalid pincode with INVALID_PINCODE (400)", async () => {
    const res = await createContact({ pincode: "01" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("INVALID_PINCODE");
  });
  it("rejects an invalid GSTIN with INVALID_GSTIN (400)", async () => {
    const res = await createContact({ gstin: "not-a-gstin" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("INVALID_GSTIN");
  });
  it("rejects an invalid PAN with INVALID_PAN (400)", async () => {
    const res = await createContact({ pan: "BAD" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("INVALID_PAN");
  });
  it("accepts a fully valid contact (202)", async () => {
    const res = await createContact({
      email: `valid-${randomUUID()}@acme.com`,
      phone: "9876543210",
      pincode: "560001",
      gstin: "29ABCDE1234F1Z5",
      pan: "ABCDE1234F",
    });
    expect(res.statusCode).toBe(202);
  });
  it("rejects an invalid PAN on account create (INVALID_PAN)", async () => {
    const res = await post("/v1/crm/accounts", { name: "Acme", pan: "BAD" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("INVALID_PAN");
  });
});

// ── DQ-001: dedup rules + duplicate-check ────────────────────────────────────
describe("DQ-001 dedup rules + duplicate-check", () => {
  it("GET /v1/crm/dedup-rules seeds defaults for a new tenant", async () => {
    const res = await get("/v1/crm/dedup-rules", ["crm_admin"]);
    expect(res.statusCode).toBe(200);
    const rules = res.json().data;
    expect(rules.length).toBeGreaterThanOrEqual(6);
    expect(rules.some((r: { field: string }) => r.field === "gstin")).toBe(true);
  });

  it("PUT /v1/crm/dedup-rules upserts a rule", async () => {
    const res = await put("/v1/crm/dedup-rules", {
      rules: [{ field: "name", matchType: "fuzzy", weight: 5, threshold: 80, enabled: false }],
    });
    expect(res.statusCode).toBe(200);
    const after = await get("/v1/crm/dedup-rules", ["crm_admin"]);
    const nameRule = after.json().data.find((r: { field: string }) => r.field === "name");
    expect(nameRule.weight).toBe(5);
    expect(nameRule.enabled).toBe(false);
  });

  it("requires admin for dedup-rules", async () => {
    const res = await get("/v1/crm/dedup-rules", ["crm_user"]);
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/crm/contacts/duplicate-check returns ranked candidates", async () => {
    // GSTIN is a plaintext business identifier (unlike email/phone which are
    // AES-GCM encrypted), so it is the reliable exact-match signal to assert on.
    const gstin = "29ABCDE1234F1Z5";
    const created = await createContact({ name: "Ravi Kumar", company: "Ravi Traders", gstin });
    expect(created.statusCode).toBe(202);
    const createdId = created.json().id;

    const res = await post("/v1/crm/contacts/duplicate-check", {
      name: "Ravi Kumar",
      company: "Ravi Traders",
      gstin,
    });
    expect(res.statusCode).toBe(200);
    const matches = res.json().data;
    const hit = matches.find((m: { id: string }) => m.id === createdId);
    expect(hit).toBeDefined();
    expect(hit.matchedFields).toEqual(expect.arrayContaining(["gstin"]));
    expect(hit.score).toBeGreaterThan(0);
  });
});

// ── DQ-002: merge leads + accounts ───────────────────────────────────────────
describe("DQ-002 merge generalization", () => {
  it("merges two leads, reassigning activities and soft-deleting the duplicate", async () => {
    // Use plaintext fields only (company/gstin) — email/phone are encrypted and
    // do not persist without a PII key in the test environment.
    const primary = await createContact({ name: "Primary Lead" });
    const duplicate = await createContact({
      name: "Dup Lead",
      company: "Dup Company",
      gstin: "29ABCDE1234F1Z5",
    });
    const primaryId = primary.json().id;
    const dupId = duplicate.json().id;

    // An activity filed against the duplicate must survive the merge.
    const act = await post("/v1/crm/activities", { contactId: dupId, text: "call notes", type: "call" });
    expect(act.statusCode).toBe(202);

    const merged = await post("/v1/crm/leads/merge", { primaryId, duplicateId: dupId }, ["crm_admin"]);
    expect(merged.statusCode).toBe(202);

    // Duplicate is soft-deleted.
    const dupAfter = await get(`/v1/crm/contacts/${dupId}`);
    expect(dupAfter.statusCode).toBe(404);

    // Primary survives and adopted the duplicate's company + GSTIN.
    const primAfter = await get(`/v1/crm/contacts/${primaryId}`);
    expect(primAfter.statusCode).toBe(200);
    expect(primAfter.json().company).toBe("Dup Company");
    expect(primAfter.json().gstin).toBe("29ABCDE1234F1Z5");

    // Activity was reassigned to the primary.
    const detail = await get(`/v1/crm/contacts/${primaryId}/detail`);
    const subjects = (detail.json().activityTimeline ?? []).map((a: { subject: string }) => a.subject);
    expect(subjects.join(" ")).toContain("call notes");
  });

  it("rejects same-id lead merge without corrupting the record", async () => {
    const c = await createContact({ name: "Solo" });
    const id = c.json().id;
    const res = await post("/v1/crm/leads/merge", { primaryId: id, duplicateId: id }, ["crm_admin"]);
    expect(res.statusCode).toBe(202); // accepted, then rejected in-consumer
    const after = await get(`/v1/crm/contacts/${id}`);
    expect(after.statusCode).toBe(200); // still active
  });

  it("merges two accounts, reassigning contacts and soft-deleting the duplicate", async () => {
    const accA = await post("/v1/crm/accounts", { name: "Account A", industry: "Gov" });
    const accB = await post("/v1/crm/accounts", { name: "Account B", website: "https://b.example" });
    const accAId = accA.json().id;
    const accBId = accB.json().id;

    // A contact under B must follow to A after the merge.
    const c = await createContact({ name: "Child Contact", accountId: accBId });
    const contactId = c.json().id;

    const merged = await post("/v1/crm/accounts/merge", { primaryId: accAId, duplicateId: accBId }, ["crm_admin"]);
    expect(merged.statusCode).toBe(202);

    // Duplicate account dropped from the active list.
    const list = await get("/v1/crm/accounts");
    const ids = list.json().data.map((a: { id: string }) => a.id);
    expect(ids).toContain(accAId);
    expect(ids).not.toContain(accBId);

    // Child contact reassigned to the primary account.
    const contactAfter = await get(`/v1/crm/contacts/${contactId}`);
    expect(contactAfter.json().accountId).toBe(accAId);
  });

  it("requires admin for lead merge", async () => {
    const res = await post("/v1/crm/leads/merge", { primaryId: randomUUID(), duplicateId: randomUUID() }, ["crm_user"]);
    expect(res.statusCode).toBe(403);
  });
});

// ── DQ-004: data-quality dashboard ───────────────────────────────────────────
describe("DQ-004 data-quality dashboard", () => {
  it("reports distribution + counts and filters by missing", async () => {
    // A deliberately incomplete contact.
    await createContact({ name: "Sparse Only" });

    const res = await get("/v1/crm/data-quality?entity=contacts&filter=missing");
    expect(res.statusCode).toBe(200);
    const rep = res.json().data;
    expect(rep.entity).toBe("contacts");
    expect(rep.total).toBeGreaterThan(0);
    expect(typeof rep.counts.missing).toBe("number");
    expect(typeof rep.counts.invalid).toBe("number");
    expect(typeof rep.counts.stale).toBe("number");
    expect(rep.counts.missing).toBeGreaterThan(0);
    expect(Array.isArray(rep.filteredIds)).toBe(true);
    const bucketTotal = Object.values(rep.distribution as Record<string, number>).reduce((s, n) => s + n, 0);
    expect(bucketTotal).toBe(rep.total);
  });

  it("supports the accounts entity", async () => {
    const res = await get("/v1/crm/data-quality?entity=accounts");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.entity).toBe("accounts");
  });

  it("rejects an unknown entity (400)", async () => {
    const res = await get("/v1/crm/data-quality?entity=widgets");
    expect(res.statusCode).toBe(400);
  });
});
