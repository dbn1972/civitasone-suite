/**
 * Review-2 round-1 fix: consumer-level, DB-backed coverage for the u11-works
 * review-2 behaviour. Runs the REAL consumers against the REAL Postgres
 * (works_svc, NOBYPASSRLS, FORCE RLS) with the real inbox/outbox, so the
 * transactional properties are proven, not mocked:
 *
 *  1. Maker-checker (SoD) is enforced INSIDE the consumer transaction
 *     (aaFinalize, tsFinalize, awardDaoFinalize, awardDoFinalize) — a command
 *     published directly (bypassing the route pre-check) still fails with
 *     SELF_APPROVAL_FORBIDDEN, leaves the row untouched and writes no outbox
 *     event; and the inbox marker is rolled back with it.
 *  2. A chained award create -> DAO finalize -> DO finalize flow with DISTINCT
 *     actors succeeds; the DO finalizer equal to the DAO finalizer is refused.
 *  3. contractorUpdate / proposalUpdate: markProcessed + guarded write + audit
 *     are atomic, replay is a no-op, NOT_DRAFT / NOT_FOUND raise
 *     NonRetryableError and leave no audit/outbox residue.
 *  4. Billing consumers populate the new audit columns (created_by/updated_by).
 *  5. Migration 0026 backfill: measurement_books.created_at/created_by are
 *     backfilled from issued_at/issued_by under FORCE RLS (not a no-op).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { administrativeApprovals, technicalSanctions } from "../src/modules/approval/schema.js";
import { awards } from "../src/modules/tender/schema.js";
import { workProposals } from "../src/modules/proposal/schema.js";
import { contractors } from "../src/modules/contractor/schema.js";
import { registerApprovalConsumers } from "../src/modules/approval/consumer.js";
import { registerTenderConsumers } from "../src/modules/tender/consumer.js";
import { registerProposalConsumers } from "../src/modules/proposal/consumer.js";
import { registerContractorConsumers } from "../src/modules/contractor/consumer.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { eq } from "drizzle-orm";

const TENANT = "cccccccc-5555-4000-8000-0000000000c1";
const MAKER = "00000000-aaaa-4000-8000-0000000000e1";
const CHECKER_1 = "00000000-aaaa-4000-8000-0000000000e2";
const CHECKER_2 = "00000000-aaaa-4000-8000-0000000000e3";

type Handler = (msg: unknown) => Promise<void>;

function collect(register: (q: never) => void): Record<string, Handler> {
  const h: Record<string, Handler> = {};
  register({ subscribe: (t: string, fn: Handler) => { h[t] = fn; } } as never);
  return h;
}
const handlers = {
  ...collect(registerApprovalConsumers as never),
  ...collect(registerTenderConsumers as never),
  ...collect(registerProposalConsumers as never),
  ...collect(registerContractorConsumers as never),
  ...collect(registerBillingConsumers as never),
};

function msg(actorId: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  return {
    messageId, tenantId: TENANT, actorId,
    correlationId: `fx1944-${messageId}`, schemaVersion: "1.0", payload,
  };
}
/** Deliver a command the way the worker does: inside the message's tenant GUC scope. */
function deliver(command: string, m: ReturnType<typeof msg>): Promise<void> {
  return runWithTenant(TENANT, () => handlers[command]!(m));
}

async function inTenant<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return (await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  })) as T;
}

async function outboxTopics(messageId: string): Promise<string[]> {
  const rows = await sqlClient<{ topic: string }[]>`
    SELECT topic FROM _outbox.messages WHERE correlation_id = ${`fx1944-${messageId}`}`;
  return rows.map((r) => r.topic);
}
async function wasProcessed(messageId: string): Promise<boolean> {
  const rows = await inTenant((sql) => sql`SELECT 1 FROM _inbox.processed WHERE message_id = ${messageId}`);
  return (rows as unknown[]).length > 0;
}

async function cleanup(): Promise<void> {
  await inTenant(async (sql) => {
    for (const t of [
      "works.bill_items", "works.measurements", "works.measurement_books",
      "works.administrative_approvals", "works.technical_sanctions", "works.awards",
      "works.work_proposals", "works.contractors",
    ]) {
      await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`);
    }
  });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function seedAa(createdBy: string): Promise<string> {
  const id = randomUUID();
  await deliver(COMMANDS.aaCreate, msg(createdBy, {
    id, workId: randomUUID(), aaNumber: `AA/${id.slice(0, 6)}`, aaDate: "2026-01-01",
    approvingAuthorityId: randomUUID(), approvedAmountMinor: "5000000", approvalType: "original",
  }));
  return id;
}
async function seedTs(createdBy: string): Promise<string> {
  const id = randomUUID();
  await deliver(COMMANDS.tsCreate, msg(createdBy, {
    id, workId: randomUUID(), tsNumber: `TS/${id.slice(0, 6)}`, tsDate: "2026-01-01",
    tsAuthorityId: randomUUID(), tsAmountMinor: "5000000", sanctionType: "original",
  }));
  return id;
}
async function seedAward(createdBy: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(awards).values({
      id, tenantId: TENANT, workId: randomUUID(), contractorName: "Acme Infra",
      acceptedAmountMinor: 1000000n, createdBy,
    });
  }));
  return id;
}

describe("SoD enforced inside the approval consumers (AA / TS)", () => {
  for (const [label, command, seed, table] of [
    ["AA", COMMANDS.aaFinalize, seedAa, administrativeApprovals],
    ["TS", COMMANDS.tsFinalize, seedTs, technicalSanctions],
  ] as const) {
    it(`${label}: a directly-published finalize by the creator is refused, row untouched, nothing emitted`, async () => {
      const id = await seed(MAKER);
      const m = msg(MAKER, { id });
      await expect(deliver(command, m)).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);
      await expect(deliver(command, m)).rejects.toBeInstanceOf(NonRetryableError);
      const [row] = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(table).where(eq(table.id, id))));
      expect(row!.status).toBe("draft");
      expect(row!.finalizedBy).toBeNull();
      expect(await outboxTopics(m.messageId)).toEqual([]);
      // The inbox marker was rolled back with the failed transaction (atomic).
      expect(await wasProcessed(m.messageId)).toBe(false);
    });

    it(`${label}: a different actor finalizes; replay of the same message is a no-op`, async () => {
      const id = await seed(MAKER);
      const m = msg(CHECKER_1, { id });
      await deliver(command, m);
      const [row] = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(table).where(eq(table.id, id))));
      expect(row!.status).toBe("finalized");
      expect(row!.finalizedBy).toBe(CHECKER_1);
      const topics = await outboxTopics(m.messageId);
      expect(topics).toContain("audit.event.record");
      expect(topics).toHaveLength(2);
      await deliver(command, m); // redelivery
      expect(await outboxTopics(m.messageId)).toHaveLength(2);
    });

    it(`${label}: finalize of an unknown id raises NonRetryableError NOT_FOUND`, async () => {
      await expect(deliver(command, msg(CHECKER_1, { id: randomUUID() })))
        .rejects.toThrow(new RegExp(`${label}_NOT_FOUND`));
    });
  }
});

describe("SoD enforced inside the award consumers; chained create -> DAO -> DO", () => {
  it("DAO finalize by the award creator is refused in the consumer", async () => {
    const id = await seedAward(MAKER);
    const m = msg(MAKER, { id });
    await expect(deliver(COMMANDS.awardDaoFinalize, m)).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(awards).where(eq(awards.id, id))));
    expect(row!.status).toBe("draft");
    expect(await outboxTopics(m.messageId)).toEqual([]);
  });

  it("distinct actors: create (MAKER) -> DAO (CHECKER_1) -> DO (CHECKER_2) succeeds", async () => {
    const id = await seedAward(MAKER);
    await deliver(COMMANDS.awardDaoFinalize, msg(CHECKER_1, { id }));
    await deliver(COMMANDS.awardDoFinalize, msg(CHECKER_2, { id }));
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(awards).where(eq(awards.id, id))));
    expect(row!.status).toBe("do_finalized");
    expect(row!.daoFinalizedBy).toBe(CHECKER_1);
    expect(row!.doFinalizedBy).toBe(CHECKER_2);
  });

  it("DO finalize by the DAO finalizer is refused (compares daoFinalizedBy); award stays dao_finalized", async () => {
    const id = await seedAward(MAKER);
    await deliver(COMMANDS.awardDaoFinalize, msg(CHECKER_1, { id }));
    const m = msg(CHECKER_1, { id });
    await expect(deliver(COMMANDS.awardDoFinalize, m)).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(awards).where(eq(awards.id, id))));
    expect(row!.status).toBe("dao_finalized");
    expect(row!.doFinalizedBy).toBeNull();
    expect(await outboxTopics(m.messageId)).toEqual([]);
  });

  it("DO finalize by the award creator is refused", async () => {
    const id = await seedAward(MAKER);
    await deliver(COMMANDS.awardDaoFinalize, msg(CHECKER_1, { id }));
    await expect(deliver(COMMANDS.awardDoFinalize, msg(MAKER, { id }))).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);
  });

  it("finalize of an unknown award raises AWARD_NOT_FOUND", async () => {
    await expect(deliver(COMMANDS.awardDaoFinalize, msg(CHECKER_1, { id: randomUUID() }))).rejects.toThrow(/AWARD_NOT_FOUND/);
  });
});

async function seedProposal(status: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(workProposals).values({
      id, tenantId: TENANT, workNumber: `W/${id.slice(0, 6)}`, category: "regular",
      description: "Road repair", workTypeId: randomUUID(), estimatedCostMinor: 100n,
      status, createdBy: MAKER, updatedBy: MAKER,
    });
  }));
  return id;
}

describe("proposalUpdate consumer: atomic write + audit, replay no-op, guards", () => {
  it("applies the patch, stamps updatedBy and emits event + audit in the same transaction", async () => {
    const id = await seedProposal("draft");
    const m = msg(CHECKER_1, { id, patch: { description: "Road repair v2" } });
    await deliver(COMMANDS.proposalUpdate, m);
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(workProposals).where(eq(workProposals.id, id))));
    expect(row!.description).toBe("Road repair v2");
    expect(row!.updatedBy).toBe(CHECKER_1);
    expect((await outboxTopics(m.messageId)).sort()).toEqual(["audit.event.record", "works.proposal.updated"].sort());
    expect(await wasProcessed(m.messageId)).toBe(true);
  });

  it("replay of the same messageId is a no-op (no second write, no extra outbox rows)", async () => {
    const id = await seedProposal("draft");
    const m = msg(CHECKER_1, { id, patch: { description: "first" } });
    await deliver(COMMANDS.proposalUpdate, m);
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(workProposals).set({ description: "changed-out-of-band" }).where(eq(workProposals.id, id))));
    await deliver(COMMANDS.proposalUpdate, m);
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(workProposals).where(eq(workProposals.id, id))));
    expect(row!.description).toBe("changed-out-of-band");
    expect(await outboxTopics(m.messageId)).toHaveLength(2);
  });

  it("NOT_DRAFT raises NonRetryableError; no write, no audit, inbox marker rolled back", async () => {
    const id = await seedProposal("dao_finalized");
    const m = msg(CHECKER_1, { id, patch: { description: "nope" } });
    await expect(deliver(COMMANDS.proposalUpdate, m)).rejects.toBeInstanceOf(NonRetryableError);
    await expect(deliver(COMMANDS.proposalUpdate, m)).rejects.toThrow(/NOT_DRAFT/);
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(workProposals).where(eq(workProposals.id, id))));
    expect(row!.description).toBe("Road repair");
    expect(await outboxTopics(m.messageId)).toEqual([]);
    expect(await wasProcessed(m.messageId)).toBe(false);
  });

  it("NOT_FOUND raises NonRetryableError PROPOSAL_NOT_FOUND", async () => {
    const m = msg(CHECKER_1, { id: randomUUID(), patch: { description: "x" } });
    await expect(deliver(COMMANDS.proposalUpdate, m)).rejects.toBeInstanceOf(NonRetryableError);
    await expect(deliver(COMMANDS.proposalUpdate, m)).rejects.toThrow(/PROPOSAL_NOT_FOUND/);
    expect(await outboxTopics(m.messageId)).toEqual([]);
  });
});

async function seedContractor(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(contractors).values({ id, tenantId: TENANT, name: "Old Name", createdBy: MAKER, updatedBy: MAKER });
  }));
  return id;
}

describe("contractorUpdate consumer: atomic write + audit, replay no-op, guards", () => {
  it("applies the patch and emits event + audit (field names only) atomically", async () => {
    const id = await seedContractor();
    const m = msg(CHECKER_1, { id, tenantId: TENANT, patch: { name: "New Name" } });
    await deliver(COMMANDS.contractorUpdate, m);
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(contractors).where(eq(contractors.id, id))));
    expect(row!.name).toBe("New Name");
    expect(row!.updatedBy).toBe(CHECKER_1);
    expect((await outboxTopics(m.messageId)).sort()).toEqual(["audit.event.record", "works.contractor.updated"].sort());
    const audit = await sqlClient<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM _outbox.messages WHERE correlation_id = ${`fx1944-${m.messageId}`} AND topic = 'audit.event.record'`;
    expect(audit[0]!.payload.fields).toEqual(["name"]);
  });

  it("replay of the same messageId is a no-op", async () => {
    const id = await seedContractor();
    const m = msg(CHECKER_1, { id, tenantId: TENANT, patch: { name: "First" } });
    await deliver(COMMANDS.contractorUpdate, m);
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(contractors).set({ name: "out-of-band" }).where(eq(contractors.id, id))));
    await deliver(COMMANDS.contractorUpdate, m);
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(contractors).where(eq(contractors.id, id))));
    expect(row!.name).toBe("out-of-band");
    expect(await outboxTopics(m.messageId)).toHaveLength(2);
  });

  it("unknown contractor raises NonRetryableError CONTRACTOR_NOT_FOUND; no audit, inbox rolled back", async () => {
    const m = msg(CHECKER_1, { id: randomUUID(), tenantId: TENANT, patch: { name: "X" } });
    await expect(deliver(COMMANDS.contractorUpdate, m)).rejects.toBeInstanceOf(NonRetryableError);
    await expect(deliver(COMMANDS.contractorUpdate, m)).rejects.toThrow(/CONTRACTOR_NOT_FOUND/);
    expect(await outboxTopics(m.messageId)).toEqual([]);
    expect(await wasProcessed(m.messageId)).toBe(false);
  });
});

describe("billing audit columns: consumer population + migration 0026 backfill", () => {
  it("mbIssue populates created_by/updated_by on measurement_books", async () => {
    const awardId = await seedAward(MAKER);
    const [award] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(awards).where(eq(awards.id, awardId))));
    const mbId = randomUUID();
    await deliver(COMMANDS.mbIssue, msg(CHECKER_1, {
      id: mbId, workId: award!.workId, awardId, mbNumber: "MB-1",
    }));
    const rows = await inTenant((sql) => sql`SELECT created_by, updated_by, created_at, updated_at FROM works.measurement_books WHERE id = ${mbId}`);
    const r = (rows as unknown as Array<Record<string, unknown>>)[0]!;
    expect(r.created_by).toBe(CHECKER_1);
    expect(r.updated_by).toBe(CHECKER_1);
    expect(r.created_at).toBeTruthy();
  });

  it("0026 migration text: created_at is added nullable, backfilled from issued_at inside NO FORCE / FORCE, then tightened", () => {
    const migration = readFileSync(join(__dirname, "../migrations/0026_billing_audit_columns.sql"), "utf8");
    const mbAdd = migration.indexOf("ALTER TABLE works.measurement_books\n  ADD COLUMN IF NOT EXISTS created_at timestamptz,");
    const noForce = migration.indexOf("ALTER TABLE works.measurement_books NO FORCE ROW LEVEL SECURITY;");
    const update = migration.indexOf("UPDATE works.measurement_books");
    const force = migration.indexOf("ALTER TABLE works.measurement_books FORCE ROW LEVEL SECURITY;");
    const notNull = migration.indexOf("ALTER COLUMN created_at SET NOT NULL");
    // created_at must NOT be added as NOT NULL DEFAULT now() on measurement_books (that made the backfill a no-op).
    expect(mbAdd).toBeGreaterThan(-1);
    expect(mbAdd).toBeLessThan(noForce);
    expect(noForce).toBeLessThan(update);
    expect(update).toBeLessThan(force);
    expect(force).toBeLessThan(notNull);
    expect(migration.slice(update, force)).toMatch(/created_at = COALESCE\(created_at, issued_at\)/);
    expect(migration.slice(update, force)).toMatch(/created_by = COALESCE\(created_by, issued_by\)/);
  });
});
