/**
 * Dedup review - PII at the source, audited reveal, and the merge audit trail (DB-backed).
 *
 * GAP-CRM-DEDUP-CANDIDATES-01  GET /v1/crm/contacts/dedup-candidates masks email/phone for
 *                              EVERY caller; the clear value is reachable only through the
 *                              audited reveal, which a plain crm_user is refused.
 * GAP-CRM-DEDUP-CANDIDATES-02  POST /v1/crm/contacts/merge carries the reviewer's reason into
 *                              the audit trail, and the trail names BOTH contacts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const CONTACT_A = randomUUID();
const CONTACT_B = randomUUID();
const CONTACT_C = randomUUID();
const CONTACT_D = randomUUID();
const EMAIL_A = "priya.sharma@nimbus.example";
const EMAIL_B = "p.sharma@nimbus.example";
const PHONE_A = "9876543210";
const PHONE_B = "1112223210"; // different number, same last four digits => identical mask

function headers(roles: string[]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dq" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function call(method: "GET" | "POST", url: string, roles: string[], payload?: unknown) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(roles), ...(payload === undefined ? {} : { payload }) });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function auditRows(actions: string[]): Promise<Array<Record<string, unknown>>> {
  const rows = (await scoped((tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record' AND payload->>'action' = ANY(${actions})
  `)) as unknown as Array<{ payload: Record<string, unknown> }>;
  return rows.map((r) => r.payload);
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.dedup_dismissals WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.dedup_rules WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
  await scoped((tx) => tx`
    INSERT INTO crm.contacts (id, tenant_id, name, email, phone, company, lead_status, status, version, created_at, updated_at, created_by, updated_by)
    VALUES
      (${CONTACT_A}, ${TENANT}, 'Priya Sharma', ${EMAIL_A}, ${PHONE_A}, 'Nimbus Pvt Ltd', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
      (${CONTACT_B}, ${TENANT}, 'Priya Sharma', ${EMAIL_B}, ${PHONE_B}, 'Nimbus Pvt Ltd', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
      (${CONTACT_C}, ${TENANT}, 'Unrelated Person', NULL, NULL, 'Different Org', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
      (${CONTACT_D}, ${TENANT}, 'Another Person', NULL, NULL, 'Another Org', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
  `);
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

type ListedPair = {
  pairId: string;
  matchedFields: string[];
  diffFields: string[];
  left: { id: string; name: string; email: string | null; phone: string | null };
  right: { id: string; name: string; email: string | null; phone: string | null };
};

describe("GAP-CRM-DEDUP-CANDIDATES-01 — the list is masked at the source", () => {
  it.each([["crm_user"], ["crm_admin"]])("%s receives masked email/phone and never the clear values", async (role) => {
    const res = await call("GET", "/v1/crm/contacts/dedup-candidates", [role]);
    expect(res.statusCode).toBe(200);
    const pair = (res.json() as { data: ListedPair[] }).data.find(
      (p) => [p.left.id, p.right.id].sort().join(":") === [CONTACT_A, CONTACT_B].sort().join(":"),
    );
    expect(pair).toBeDefined();

    const body = res.body;
    for (const clear of [EMAIL_A, EMAIL_B, PHONE_A, PHONE_B]) expect(body).not.toContain(clear);

    const sides = [pair!.left, pair!.right];
    for (const side of sides) {
      expect(side.email).toMatch(/^p\*\*\*@nimbus\.example$/);
      expect(side.phone).toMatch(/^\*{6}3210$/);
      expect(side.name).toBe("Priya Sharma"); // name stays clear so the pair is recognisable
    }
  });

  it("computes diffFields on the clear values: the phones mask identically yet are flagged as differing", async () => {
    const res = await call("GET", "/v1/crm/contacts/dedup-candidates", ["crm_user"]);
    const pair = (res.json() as { data: ListedPair[] }).data.find((p) => p.pairId.includes(CONTACT_A))!;
    expect(pair.left.phone).toBe(pair.right.phone);
    expect(pair.diffFields).toEqual(expect.arrayContaining(["email", "phone"]));
    expect(pair.diffFields).not.toContain("name");
    expect(pair.diffFields).not.toContain("company");
    expect(pair.matchedFields).toContain("name");
  });
});

describe("GAP-CRM-DEDUP-CANDIDATES-01 — the audited reveal", () => {
  const body = { resourceType: "contact", resourceId: CONTACT_A, field: "email", reason: "Confirming the duplicate by email" };

  it("refuses a plain crm_user (403) and returns no value", async () => {
    const res = await call("POST", "/v1/crm/pii/reveal", ["crm_user"], body);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(EMAIL_A);
  });

  it("refuses a reveal without a substantive reason (400)", async () => {
    const res = await call("POST", "/v1/crm/pii/reveal", ["crm_admin"], { ...body, reason: "short" });
    expect(res.statusCode).toBe(400);
  });

  it("returns the clear value to crm_admin and writes a pii_reveal audit event that carries no PII value", async () => {
    const res = await call("POST", "/v1/crm/pii/reveal", ["crm_admin"], body);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { value: string } }).data.value).toBe(EMAIL_A);

    const rows = await auditRows(["pii_reveal"]);
    const mine = rows.filter((r) => r.resourceId === CONTACT_A);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0]!.resourceType).toBe("contact");
    expect(mine[0]!.outcome).toBe("success");

    // The reason rides the same-transaction crm.pii.revealed event; neither row holds the value.
    const events = (await scoped((tx) => tx`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'crm.pii.revealed' AND payload->>'resourceId' = ${CONTACT_A}
    `)) as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.field).toBe("email");
    expect(events[0]!.payload.reason).toBe("Confirming the duplicate by email");
    expect(JSON.stringify([...rows, ...events])).not.toContain(EMAIL_A);
  });
});

describe("GAP-CRM-DEDUP-CANDIDATES-02 — merge reason and both ids reach the audit trail", () => {
  it("rejects a reason shorter than 10 characters (400) and does not merge", async () => {
    const res = await call("POST", "/v1/crm/contacts/merge", ["crm_admin"], { primaryId: CONTACT_C, duplicateId: CONTACT_D, reason: "too short" });
    expect(res.statusCode).toBe(400);
    const still = (await scoped((tx) => tx`SELECT status FROM crm.contacts WHERE id = ${CONTACT_D}`)) as unknown as Array<{ status: string }>;
    expect(still[0]!.status).toBe("active");
  });

  it("keeps the reason and names both contacts on the merge audit record and on the absorbed duplicate", async () => {
    const reason = "Same person: confirmed on a call with the vendor";
    const res = await call("POST", "/v1/crm/contacts/merge", ["crm_admin"], { primaryId: CONTACT_A, duplicateId: CONTACT_B, reason });
    expect(res.statusCode).toBe(202);

    const merged = (await scoped((tx) => tx`SELECT status FROM crm.contacts WHERE id = ${CONTACT_B}`)) as unknown as Array<{ status: string }>;
    expect(merged[0]!.status).not.toBe("active");

    const rows = await auditRows(["merge", "merge_into"]);
    const onPrimary = rows.find((r) => r.action === "merge" && r.resourceId === CONTACT_A);
    const onDuplicate = rows.find((r) => r.action === "merge_into" && r.resourceId === CONTACT_B);
    expect(onPrimary, "merge audit on the primary").toBeDefined();
    expect(onDuplicate, "merge_into audit on the duplicate").toBeDefined();
    for (const row of [onPrimary!, onDuplicate!]) {
      expect(row.outcome).toBe("success");
      expect(row.reason).toBe(reason);
      expect(row.metadata).toEqual({ primaryId: CONTACT_A, duplicateId: CONTACT_B });
    }
  });

  it("still accepts a merge with no reason (older callers) and audits both ids without one", async () => {
    const res = await call("POST", "/v1/crm/contacts/merge", ["crm_admin"], { primaryId: CONTACT_C, duplicateId: CONTACT_D });
    expect(res.statusCode).toBe(202);
    const rows = await auditRows(["merge", "merge_into"]);
    const onDuplicate = rows.find((r) => r.action === "merge_into" && r.resourceId === CONTACT_D);
    expect(onDuplicate).toBeDefined();
    expect(onDuplicate!.reason).toBeUndefined();
    expect(onDuplicate!.metadata).toEqual({ primaryId: CONTACT_C, duplicateId: CONTACT_D });
  });
});

describe("GAP-CRM-DEDUP-CANDIDATES-02 — a merge that backfills the primary's missing email actually completes", () => {
  // Contacts are created through the real create route so email_idx (the unique blind index)
  // is populated; a raw-SQL seed would leave it NULL and hide the collision.
  async function createContact(name: string, email?: string): Promise<string> {
    const res = await call("POST", "/v1/crm/contacts", ["crm_admin"], { name, ...(email ? { email } : {}) });
    expect(res.statusCode).toBe(202);
    return (res.json() as { id: string }).id;
  }

  it("moves the duplicate's email to an email-less primary, soft-deletes the duplicate and audits both ids", async () => {
    const primary = await createContact("Merge Primary NoEmail");
    const duplicate = await createContact("Merge Duplicate WithEmail", "dup.carry@nimbus.example");

    const res = await call("POST", "/v1/crm/contacts/merge", ["crm_admin"], {
      primaryId: primary,
      duplicateId: duplicate,
      reason: "Same vendor contact entered twice",
    });
    expect(res.statusCode).toBe(202);

    const rows = (await scoped((tx) => tx`
      SELECT id, status, email_idx FROM crm.contacts WHERE id = ANY(${[primary, duplicate]})
    `)) as unknown as Array<{ id: string; status: string; email_idx: string | null }>;
    const p = rows.find((r) => r.id === primary)!;
    const d = rows.find((r) => r.id === duplicate)!;
    expect(d.status).toBe("inactive");
    expect(d.email_idx).toBeNull();
    expect(p.status).toBe("active");
    expect(p.email_idx).not.toBeNull(); // the primary now holds the email

    const audit = (await auditRows(["merge"])).find((r) => r.resourceId === primary);
    expect(audit?.metadata).toEqual({ primaryId: primary, duplicateId: duplicate });
  });
});
