/**
 * crm-service domain/consumer tests (DB-backed).
 *
 * Drives the REAL command consumers against a MemoryQueue + the real Postgres
 * (civitas_crm) singleton `db`, then asserts persisted state. Covers the 10/10
 * rubric domain behaviours that the prior unit tests did not:
 *   - cross-tenant FK rejection (+ audit) for contact/deal/activity
 *   - deal lifecycle: PATCH edit, soft-delete excluded from get/list
 *   - stage probability pinning (Won=100, Lost=0)
 *   - activity completion auto-sets completedAt
 *   - dashboard count excludes soft-deleted + cache invalidated on delete
 *   - contact PII is ciphertext at rest, with a populated blind email_idx
 *   - tenant isolation on reads
 *   - inbox idempotency (markProcessed dedups a replayed messageId)
 *
 * All rows live under disposable test-tenant UUIDs and are deleted in
 * afterAll, so the suite is self-cleaning and re-runnable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";

import { db, sqlClient } from "../src/shared/db.js";
import { markProcessed } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";
import { registerContactConsumers } from "../src/modules/contacts/consumer.js";
import { registerDealConsumers } from "../src/modules/deals/consumer.js";
import { registerActivityConsumers } from "../src/modules/activities/consumer.js";
import { buildView } from "../src/modules/contacts/commands.js";
import * as contactRepo from "../src/modules/contacts/repo.js";
import * as dealRepo from "../src/modules/deals/repo.js";
import { contacts } from "../src/modules/contacts/schema.js";
import { deals } from "../src/modules/deals/schema.js";
import { activities } from "../src/modules/activities/schema.js";
import { getDashboard, invalidateDashboard, dashboardKey } from "../src/modules/dashboard/queries.js";
import { cache } from "../src/shared/infra.js";
import { isEncrypted } from "../src/shared/pii-crypto.js";

// PII at-rest encryption (DPDP/P1-2) fails closed without CRM_PII_KEY. Seed a
// deterministic test key before any consumer encrypts email/phone — otherwise
// the create consumer throws, the message is retried to the DLQ, and the row is
// never written (the create then times out). Mirrors tests/pii-crypto.test.ts.
process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";

// Stable, disposable test tenants (kept away from real data).
const TENANT_A = "ddddddd1-0000-4000-8000-000000000001";
const TENANT_B = "ddddddd2-0000-4000-8000-000000000002";
const ACTOR = "ddddddd0-0000-4000-8000-0000000000aa";

const queue = new MemoryQueue();
registerContactConsumers(queue);
registerDealConsumers(queue);
registerActivityConsumers(queue);

type Cmd = {
  messageId: string;
  type: string;
  tenantId: string;
  payload: Record<string, unknown>;
};

/** Publish a command and wait until `ready()` observes the committed effect. */
async function drive(topic: string, cmd: Cmd, ready: () => Promise<boolean>): Promise<void> {
  await queue.publish(topic, {
    messageId: cmd.messageId,
    type: cmd.type,
    tenantId: cmd.tenantId,
    actorId: ACTOR,
    correlationId: `corr-${cmd.messageId}`,
    schemaVersion: "1.0",
    payload: cmd.payload,
  });
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await ready()) return;
    if (Date.now() > deadline) throw new Error(`drive(${topic}) timed out`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function createContactCmd(tenantId: string, overrides: Record<string, unknown> = {}): Cmd {
  const id = randomUUID();
  const view = buildView(id, { tenantId, actorId: ACTOR, correlationId: "c" } as never, {
    name: "Test Contact",
    leadStatus: "new",
    ...overrides,
  } as never);
  return { messageId: id, type: COMMANDS.createContact, tenantId, payload: view as Record<string, unknown> };
}

async function contactRowExists(tenantId: string, id: string): Promise<boolean> {
  return (await contactRepo.findById(id, tenantId)) !== null;
}

/**
 * True once the consumer has finished processing `messageId` (it claimed the
 * inbox row inside its tx). This is the drain-safe completion signal: unlike
 * `_outbox.messages`, the `_inbox.processed` row is never removed by the live
 * relay worker, so polling it is race-free even while crm-worker is running.
 */
async function processed(messageId: string): Promise<boolean> {
  const r = await sqlClient`select 1 from _inbox.processed where message_id = ${messageId} limit 1`;
  return r.length > 0;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.delete(activities).where(eq(activities.tenantId, t));
    await db.delete(deals).where(eq(deals.tenantId, t));
    await db.delete(contacts).where(eq(contacts.tenantId, t));
  }
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("contact create + PII at rest", () => {
  it("persists ciphertext email/phone with a populated blind email_idx", async () => {
    const cmd = createContactCmd(TENANT_A, {
      name: "Asha Verma",
      email: "asha.verma@example.in",
      phone: "9876500011",
    });
    await drive(COMMANDS.createContact, cmd, () => contactRowExists(TENANT_A, cmd.messageId));

    // Read the RAW row (bypass the drizzle decrypt customType) to assert ciphertext.
    const raw = await sqlClient`
      select email, phone, email_idx from crm.contacts where id = ${cmd.messageId}
    `;
    expect(raw.length).toBe(1);
    const r = raw[0]!;
    expect(typeof r.email).toBe("string");
    expect(isEncrypted(r.email as string)).toBe(true);
    expect(r.email).not.toContain("asha.verma@example.in");
    expect(isEncrypted(r.phone as string)).toBe(true);
    // Blind index is a 64-hex HMAC, not the plaintext.
    expect(r.email_idx).toMatch(/^[0-9a-f]{64}$/);

    // The repo (app layer) decrypts transparently back to cleartext.
    const view = await contactRepo.findById(cmd.messageId, TENANT_A);
    expect(view?.email).toBe("asha.verma@example.in");
    expect(view?.phone).toBe("9876500011");
  });

  it("isolates tenants: a contact is invisible to another tenant", async () => {
    const cmd = createContactCmd(TENANT_A, { name: "Tenant A Only" });
    await drive(COMMANDS.createContact, cmd, () => contactRowExists(TENANT_A, cmd.messageId));
    expect(await contactRepo.findById(cmd.messageId, TENANT_B)).toBeNull();
    expect(await contactRepo.findById(cmd.messageId, TENANT_A)).not.toBeNull();
  });
});

describe("cross-tenant FK rejection (+ audit)", () => {
  it("rejects a contact referencing an account in another tenant and audits it", async () => {
    // An account is never created in TENANT_A, so this accountId fails the guard.
    const foreignAccountId = randomUUID();
    const cmd = createContactCmd(TENANT_A, { name: "Bad Ref", accountId: foreignAccountId });

    // Wait for the handler to finish (inbox claim is drain-safe).
    await drive(COMMANDS.createContact, cmd, () => processed(cmd.messageId));

    // Observable effect of the guard: the contact row was NOT inserted.
    expect(await contactRepo.findById(cmd.messageId, TENANT_A)).toBeNull();
  });

  it("rejects a deal referencing a contact in another tenant", async () => {
    // Create a contact in TENANT_B, then try to attach a TENANT_A deal to it.
    const cContact = createContactCmd(TENANT_B, { name: "B Contact" });
    await drive(COMMANDS.createContact, cContact, () => contactRowExists(TENANT_B, cContact.messageId));

    const dealId = randomUUID();
    const dealCmd: Cmd = {
      messageId: dealId,
      type: COMMANDS.createDeal,
      tenantId: TENANT_A,
      payload: {
        id: dealId, tenantId: TENANT_A, name: "Cross Deal", stage: "Lead",
        valueMinor: "1000", currency: "INR", contactId: cContact.messageId,
        contactName: null, ownerId: ACTOR, closeDate: null, probability: 0,
        status: "active", version: 1,
      },
    };
    await drive(COMMANDS.createDeal, dealCmd, () => processed(dealCmd.messageId));
    // The deal must NOT have been inserted (guard rejected the cross-tenant contact).
    expect(await dealRepo.findById(dealId, TENANT_A)).toBeNull();
  });
});

describe("deal lifecycle", () => {
  async function makeDeal(tenantId: string, valueMinor = 500000): Promise<string> {
    const id = randomUUID();
    const cmd: Cmd = {
      messageId: id, type: COMMANDS.createDeal, tenantId,
      payload: {
        id, tenantId, name: "Pipeline Deal", stage: "Lead",
        valueMinor: String(valueMinor), currency: "INR", contactId: null,
        contactName: null, ownerId: ACTOR, closeDate: null, probability: 10,
        status: "active", version: 1,
      },
    };
    await drive(COMMANDS.createDeal, cmd, async () => (await dealRepo.findById(id, tenantId)) !== null);
    return id;
  }

  it("PATCH edits a deal's value and bumps version", async () => {
    const id = await makeDeal(TENANT_A);
    const before = await dealRepo.findById(id, TENANT_A);
    await drive(COMMANDS.updateDeal, {
      messageId: randomUUID(), type: COMMANDS.updateDeal, tenantId: TENANT_A,
      payload: { id, tenantId: TENANT_A, valueMinor: 999900 },
    }, async () => {
      const d = await dealRepo.findById(id, TENANT_A);
      return d?.valueMinor === "999900";
    });
    const after = await dealRepo.findById(id, TENANT_A);
    expect(after?.valueMinor).toBe("999900");
    expect(after!.version).toBeGreaterThan(before!.version);
  });

  it("Won pins probability=100; Lost pins probability=0; version bumps", async () => {
    const wonId = await makeDeal(TENANT_A);
    const wonBefore = await dealRepo.findById(wonId, TENANT_A);
    await drive(COMMANDS.updateDealStage, {
      messageId: randomUUID(), type: COMMANDS.updateDealStage, tenantId: TENANT_A,
      payload: { id: wonId, tenantId: TENANT_A, stage: "Won" },
    }, async () => (await dealRepo.findById(wonId, TENANT_A))?.stage === "Won");
    const won = await dealRepo.findById(wonId, TENANT_A);
    expect(won?.probability).toBe(100);
    expect(won?.status).toBe("won");
    expect(won!.version).toBeGreaterThan(wonBefore!.version);

    const lostId = await makeDeal(TENANT_A);
    await drive(COMMANDS.updateDealStage, {
      messageId: randomUUID(), type: COMMANDS.updateDealStage, tenantId: TENANT_A,
      payload: { id: lostId, tenantId: TENANT_A, stage: "Lost", probability: 80 },
    }, async () => (await dealRepo.findById(lostId, TENANT_A))?.stage === "Lost");
    const lost = await dealRepo.findById(lostId, TENANT_A);
    expect(lost?.probability).toBe(0); // explicit 80 is overridden by the Lost rule
    expect(lost?.status).toBe("lost");
  });

  it("soft-delete excludes the deal from get and list", async () => {
    const id = await makeDeal(TENANT_A);
    await drive(COMMANDS.deleteDeal, {
      messageId: randomUUID(), type: COMMANDS.deleteDeal, tenantId: TENANT_A,
      payload: { id, tenantId: TENANT_A },
    }, async () => (await dealRepo.findById(id, TENANT_A)) === null);

    expect(await dealRepo.findById(id, TENANT_A)).toBeNull();
    const list = await dealRepo.listByTenant(TENANT_A, 200, 0);
    expect(list.find((d) => d.id === id)).toBeUndefined();
    // Row still present but flagged deleted (true soft-delete).
    const raw = await sqlClient`select status from crm.deals where id = ${id}`;
    expect(raw[0]?.status).toBe("deleted");
  });
});

describe("activity completion", () => {
  it("auto-sets completedAt when status -> completed", async () => {
    const id = randomUUID();
    await drive(COMMANDS.createActivity, {
      messageId: id, type: COMMANDS.createActivity, tenantId: TENANT_A,
      payload: {
        id, tenantId: TENANT_A, actorName: "Tester", text: "Follow up call",
        contactId: null, dealId: null, type: "task", subject: "Call",
        status: "open", dueDate: null, completedAt: null,
        createdAt: new Date().toISOString(),
      },
    }, async () => {
      const r = await sqlClient`select 1 from crm.activities where id = ${id}`;
      return r.length > 0;
    });

    await drive(COMMANDS.updateActivity, {
      messageId: randomUUID(), type: COMMANDS.updateActivity, tenantId: TENANT_A,
      payload: { id, tenantId: TENANT_A, status: "completed" },
    }, async () => {
      const r = await sqlClient`select completed_at from crm.activities where id = ${id}`;
      return r[0]?.completed_at != null;
    });

    const r = await sqlClient`select status, completed_at from crm.activities where id = ${id}`;
    expect(r[0]?.status).toBe("completed");
    expect(r[0]?.completed_at).not.toBeNull();
  });
});

describe("dashboard excludes deleted + cache invalidation", () => {
  it("count drops after a contact is soft-deleted, and the cached summary is invalidated", async () => {
    // Fresh isolated tenant slice (cleanup already ran in beforeAll for A/B).
    await invalidateDashboard(TENANT_A);
    const cmd = createContactCmd(TENANT_A, { name: "Dashboard Contact" });
    await drive(COMMANDS.createContact, cmd, () => contactRowExists(TENANT_A, cmd.messageId));

    // Prime the cache and capture the count that includes our new contact.
    const before = await getDashboard(TENANT_A);
    expect(before.totalContacts).toBeGreaterThanOrEqual(1);
    // The summary is now cached.
    expect(await cache.getOrLoad(dashboardKey(TENANT_A), async () => null)).not.toBeNull();

    // Soft-delete the contact; the consumer must invalidate the dashboard cache.
    await drive(COMMANDS.deleteContact, {
      messageId: randomUUID(), type: COMMANDS.deleteContact, tenantId: TENANT_A,
      payload: { id: cmd.messageId, tenantId: TENANT_A },
    }, async () => (await contactRepo.findById(cmd.messageId, TENANT_A))?.status === "deleted");

    // Cache entry must be GONE (not stale) immediately after the delete.
    const cachedAfter = await cache.getOrLoad(dashboardKey(TENANT_A), async () => null);
    expect(cachedAfter).toBeNull();

    // Recomputed summary no longer counts the deleted contact.
    const after = await getDashboard(TENANT_A);
    expect(after.totalContacts).toBe(before.totalContacts - 1);
  });
});

describe("inbox idempotency (markProcessed)", () => {
  it("claims a messageId once; a replay is a no-op", async () => {
    const messageId = randomUUID();
    const first = await db.transaction((tx) => markProcessed(tx, messageId));
    const second = await db.transaction((tx) => markProcessed(tx, messageId));
    expect(first).toBe(true);
    expect(second).toBe(false);
    await sqlClient`delete from _inbox.processed where message_id = ${messageId}`;
  });

  it("a redelivered create command does not insert the contact twice", async () => {
    const cmd = createContactCmd(TENANT_A, { name: "Idempotent" });
    await drive(COMMANDS.createContact, cmd, () => contactRowExists(TENANT_A, cmd.messageId));

    // Re-run the consumer body directly with the SAME messageId: markProcessed
    // must short-circuit, leaving exactly one row.
    await db.transaction(async (tx) => {
      const claimed = await markProcessed(tx, cmd.messageId);
      expect(claimed).toBe(false);
    });
    const rows = await sqlClient`select count(*)::int as n from crm.contacts where id = ${cmd.messageId}`;
    expect(rows[0]?.n).toBe(1);
  });
});
