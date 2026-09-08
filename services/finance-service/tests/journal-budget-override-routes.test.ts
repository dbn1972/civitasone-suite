/**
 * DOM-007 — HTTP-level role gate for the budget-override path.
 *
 * gl/consumer.ts's postJournal() trusts journal.budgetOverride at face value
 * (see tests/gl-budget-check.test.ts for the posting-path behaviour itself);
 * the authorization happens upstream, synchronously, in gl/routes.ts, BEFORE
 * the command is ever enqueued — a plain finance_officer cannot set
 * budgetOverride=true, only finance_admin/super_admin (BUDGET_OVERRIDE_ROLES,
 * the same elevated tier period-close's hard-close "reopen" already uses for
 * an admin-only bypass-with-reason of another GL-core control).
 *
 * Real Postgres integration test (no mocks), same shape as
 * tests/distribution-routes.test.ts.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { eq, and } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { scoped } from "./_tenant.js";
import { financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// GL is append-only — finance_svc has no DELETE grant on gl.finance_journals
// (see cleanup(), below), so a fixed tenant id here would accumulate journals
// across repeated runs against the same Postgres instance and make the
// journals.length assertions below flaky/wrong on a second run. A fresh
// random tenant per process guarantees a clean slate every time, matching
// how a real per-tenant install never sees another tenant's rows anyway.
const TENANT = randomUUID();
const ACTOR  = randomUUID();
const ADMIN  = randomUUID();
const EXPENSE_HEAD = randomUUID();
const BANK_HEAD    = randomUUID();
const FY = "2027-28";

function token(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-dom007" }, SECRET);
}
const officer = () => ({ authorization: `Bearer ${token(["finance_officer"], ACTOR)}` });
const admin   = () => ({ authorization: `Bearer ${token(["finance_admin"], ADMIN)}` });

async function drain() {
  await (queue as MemoryQueue).drain();
}

async function seed() {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: EXPENSE_HEAD, tenantId: TENANT, code: "DOM007-EXP", name: "DOM-007 test expense head", level: 1, createdBy: ACTOR, updatedBy: ACTOR },
    { id: BANK_HEAD, tenantId: TENANT, code: "DOM007-BANK", name: "DOM-007 test bank head", level: 1, createdBy: ACTOR, updatedBy: ACTOR },
  ]).onConflictDoNothing());
  await scoped(TENANT, (tx) => tx.insert(financeBudgets).values({
    tenantId: TENANT, headId: EXPENSE_HEAD, fy: FY,
    beMinor: 100_000n, reMinor: 100_000n, allocatedMinor: 100_000n, utilisedMinor: 0n,
    createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing());
}

async function cleanup() {
  // GL is intentionally append-only (skill 01: "Posting is append-only... only
  // reversed") — finance_svc has no DELETE grant on gl.finance_journals (see
  // information_schema.role_table_grants), so this never tries to delete
  // posted journals. A fresh isolated Postgres container per CI/test run
  // makes that unnecessary anyway.
  await scoped(TENANT, (tx) => tx.delete(financeBudgets).where(and(eq(financeBudgets.tenantId, TENANT), eq(financeBudgets.headId, EXPENSE_HEAD))));
}

beforeAll(async () => {
  registerGlConsumers(queue);
  await seed();
});
afterAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT))).catch(() => {});
  await sqlClient.end();
});

function journalPayload(overrides: Record<string, unknown> = {}) {
  return {
    voucherNo: "AUTO",
    type: "journal",
    postingDate: `${FY.slice(0, 4)}-08-15`,
    lines: [
      { accountCode: EXPENSE_HEAD, debitMinor: 150000, creditMinor: 0 },
      { accountCode: BANK_HEAD, debitMinor: 0, creditMinor: 150000 },
    ],
    ...overrides,
  };
}

describe("DOM-007 — budget-override role gate", () => {
  it("400s when budgetOverride is set without a reason", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/journals", headers: admin(),
        payload: journalPayload({ budgetOverride: true }),
      });
      expect(res.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it("REGRESSION: a finance_officer cannot self-authorize an over-budget post — 403 before the command is ever enqueued", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/journals", headers: officer(),
        payload: journalPayload({ budgetOverride: true, overrideReason: "trying to self-authorize" }),
      });
      expect(res.statusCode).toBe(403);
      await drain();
      const journals = await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.tenantId, TENANT)));
      expect(journals.length).toBe(0);
    } finally { await app.close(); }
  });

  it("a finance_officer's plain over-budget post (no override) is accepted at 202 but rejected by the async consumer — nothing lands", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/journals", headers: officer(),
        payload: journalPayload(),
      });
      expect(res.statusCode).toBe(202);
      await drain();
      const journals = await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.tenantId, TENANT)));
      expect(journals.length).toBe(0);
      const budget = await scoped(TENANT, (tx) => tx.select().from(financeBudgets)
        .where(and(eq(financeBudgets.tenantId, TENANT), eq(financeBudgets.headId, EXPENSE_HEAD))));
      expect(budget[0]?.utilisedMinor).toBe(0n);
    } finally { await app.close(); }
  });

  it("an authorized finance_admin override posts over budget and is audited", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/journals", headers: admin(),
        payload: journalPayload({ budgetOverride: true, overrideReason: "emergency flood-relief sanction" }),
      });
      expect(res.statusCode).toBe(202);
      // commands.postJournal returns {id, status, correlationId} — the
      // optional nested `data` envelope (acceptedResponseSchema) is only
      // populated by routes migrated under fix/admin-f3-response-envelope;
      // gl/routes.ts predates that, so the id is top-level.
      const journalId = res.json().id as string;
      await drain();

      const journals = await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, journalId)));
      expect(journals.length).toBe(1);
      expect(journals[0].status).toBe("posted");

      const budget = await scoped(TENANT, (tx) => tx.select().from(financeBudgets)
        .where(and(eq(financeBudgets.tenantId, TENANT), eq(financeBudgets.headId, EXPENSE_HEAD))));
      // 150,000 posted against a 100,000 budget — utilised now exceeds re_minor,
      // the visible, intended effect of an authorized override.
      expect(budget[0]?.utilisedMinor).toBe(150_000n);
      expect(budget[0]!.utilisedMinor > budget[0]!.reMinor).toBe(true);

      const events = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
      const overrideAudit = events.find((e) =>
        e.eventType === "audit.event.record"
        && (e.payload as { action?: string }).action === "post_journal_budget_override");
      expect(overrideAudit).toBeDefined();
      expect((overrideAudit!.payload as { reason?: string }).reason).toBe("emergency flood-relief sanction");
    } finally { await app.close(); }
  });
});
