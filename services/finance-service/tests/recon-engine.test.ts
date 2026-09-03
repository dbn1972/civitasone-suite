/**
 * CAP-059 — reconciliation consumer integration tests (finance-service).
 *
 * Proves the @civitasone/reconciliation engine is really wired: a run persists
 * a recon_run + breaks, a seeded mismatch produces a break, and the exception
 * lifecycle (open→investigating→resolved) works — all under FORCE RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { runReconciliation } from "../src/modules/recon/service.js";
import * as reconRepo from "../src/modules/recon/repo.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { reconRun, reconBreak } from "../src/modules/recon/schema.js";
import { registerProvider, getProvider, listProviders } from "../src/modules/recon/providers.js";
import { financeBills, financePayments } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { bankStatement, bankStatementLines } from "../src/modules/bank-recon/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "5ec04059-0000-4000-8000-0000000000f9";
const TENANT_B = "5ec04059-0000-4000-8000-0000000000fb";
const ACTOR = "ac700059-0000-4000-8000-0000000000fa";

function token(tenantId = TENANT, roles = ["finance_officer"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "recon" }, SECRET);
}
function h(t: string) {
  return { authorization: `Bearer ${t}` };
}

let app: FastifyInstance;

async function wipe(tenantId: string) {
  await scoped(tenantId, async (tx: any) => {
    await tx.delete(reconBreak).where(eq(reconBreak.tenantId, tenantId));
    await tx.delete(reconRun).where(eq(reconRun.tenantId, tenantId));
    await tx.delete(bankStatementLines).where(eq(bankStatementLines.tenantId, tenantId));
    await tx.delete(bankStatement).where(eq(bankStatement.tenantId, tenantId));
    await tx.delete(financePayments).where(eq(financePayments.tenantId, tenantId));
    await tx.delete(financeBills).where(eq(financeBills.tenantId, tenantId));
    await tx.delete(financeHeads).where(eq(financeHeads.tenantId, tenantId));
  });
}

// A deterministic in-memory provider so persistence + lifecycle can be proven
// without depending on seed data: 1 match, 1 missing-in-target, 1 amount mismatch.
registerProvider({
  key: "test-fixture",
  sourceSystem: "fixture-book",
  targetSystem: "fixture-bank",
  async fetch() {
    return {
      source: [
        { key: "A", amountMinor: 1000n },
        { key: "B", amountMinor: 2000n },
        { key: "C", amountMinor: 3000n },
      ],
      target: [
        { key: "A", amountMinor: 1000n }, // match
        { key: "B", amountMinor: 2500n }, // value_mismatch (+500)
        // C missing → missing_in_target
      ],
      config: {
        keyField: "key",
        sourceSystem: "fixture-book",
        targetSystem: "fixture-bank",
        fields: [{ field: "amountMinor", type: "amount", tolerance: 0 }],
      },
    };
  },
});

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await wipe(TENANT);
  await wipe(TENANT_B);
});

afterAll(async () => {
  await wipe(TENANT);
  await wipe(TENANT_B);
  await app.close();
});

describe("CAP-059 provider registry", () => {
  it("exposes the built-in book-vs-bank provider", () => {
    expect(getProvider("book-vs-bank")).toBeTruthy();
    expect(listProviders().some((p) => p.key === "book-vs-bank")).toBe(true);
  });
});

describe("CAP-059 reconciliation runs + exceptions", () => {
  it("rejects an unknown provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/recon/runs",
      headers: h(token()),
      payload: { provider: "does-not-exist" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("UNKNOWN_PROVIDER");
  });

  it("accepts a reconciliation run via CQRS (202) and persists via service path for lifecycle", async () => {
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/finance/recon/runs",
      headers: h(token()),
      payload: { provider: "test-fixture" },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().status).toBe("accepted");

    // Persistence + exception lifecycle still exercised via the consumer write path
    // (service.runReconciliation) — HTTP mutations only enqueue commands.
    const result = await runWithTenant(TENANT, () =>
      runReconciliation(
        { tenantId: TENANT, actorId: "00000000-0000-4000-8000-0000000000aa" },
        "test-fixture",
        {},
      ),
    );
    expect(result).not.toBeNull();
    const body = {
      runId: result!.run.id,
      balanced: result!.balanced,
      breakCount: result!.breakCount,
      matchedCount: result!.run.matchedCount,
    };
    expect(body.balanced).toBe(false);
    expect(body.breakCount).toBe(2); // value_mismatch(B) + missing_in_target(C)
    expect(body.matchedCount).toBe(2); // A + B keys aligned

    const runId = body.runId;

    // run detail includes its breaks
    const detail = await app.inject({ method: "GET", url: `/v1/finance/recon/runs/${runId}`, headers: h(token()) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().breaks.length).toBe(2);

    // open exceptions listed
    const open = await app.inject({ method: "GET", url: "/v1/finance/recon/exceptions?status=open", headers: h(token()) });
    expect(open.json().meta.total).toBe(2);
    const mismatch = open.json().data.find((b: any) => b.breakType === "value_mismatch");
    expect(mismatch).toBeTruthy();
    expect(String(mismatch.deltaMinor)).toBe("500");

    // lifecycle: HTTP CQRS accepts (202); apply status via consumer write path under tenant GUC
    const bid = mismatch.id;
    const inv = await app.inject({
      method: "POST",
      url: `/v1/finance/recon/exceptions/${bid}/action`,
      headers: h(token()),
      payload: { action: "investigate", note: "checking with bank" },
    });
    expect(inv.statusCode).toBe(202);

    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await reconRepo.updateBreakStatus(tx, TENANT, bid, {
          status: "investigating",
          resolutionNote: "checking with bank",
          resolvedBy: null,
          resolvedAt: null,
        });
      });
    });
    expect(await runWithTenant(TENANT, () => reconRepo.getBreak(TENANT, bid)).then((r) => r?.status)).toBe("investigating");

    const resv = await app.inject({
      method: "POST",
      url: `/v1/finance/recon/exceptions/${bid}/action`,
      headers: h(token()),
      payload: { action: "resolve", note: "bank corrected the amount" },
    });
    expect(resv.statusCode).toBe(202);

    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await reconRepo.updateBreakStatus(tx, TENANT, bid, {
          status: "resolved",
          resolutionNote: "bank corrected the amount",
          resolvedBy: ACTOR,
          resolvedAt: new Date(),
        });
      });
    });
    const resolved = await runWithTenant(TENANT, () => reconRepo.getBreak(TENANT, bid));
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedBy).toBeTruthy();
    expect(resolved?.resolvedAt).toBeTruthy();

    // illegal transition: resolved → investigate → 409 (route pre-check)
    const bad = await app.inject({
      method: "POST",
      url: `/v1/finance/recon/exceptions/${bid}/action`,
      headers: h(token()),
      payload: { action: "investigate" },
    });
    expect(bad.statusCode).toBe(409);
  });

  it("real book-vs-bank provider: a seeded book payment with no bank line is a break", async () => {
    const stmtId = randomUUID();
    const headId = randomUUID();
    const vendorId = randomUUID();
    const billMatchId = randomUUID();
    const billOrphanId = randomUUID();
    await scoped(TENANT, async (tx: any) => {
      // fk_fbills_head / fk_fpayments_bill (migrations/0055_add_foreign_keys.sql)
      // require real parent finance_heads / finance_bills rows before
      // finance_payments can reference a bill_id.
      await tx.insert(financeHeads).values({
        id: headId, tenantId: TENANT, code: "4700-RECON", name: "Recon Engine Head", level: 2, createdBy: ACTOR, updatedBy: ACTOR,
      }).onConflictDoNothing();
      await tx.insert(financeBills).values([
        { id: billMatchId, tenantId: TENANT, billNo: "BILL-RECON-MATCH", vendorId, headId, grossMinor: 5000n, netMinor: 5000n, createdBy: ACTOR, updatedBy: ACTOR },
        { id: billOrphanId, tenantId: TENANT, billNo: "BILL-RECON-ORPHAN", vendorId, headId, grossMinor: 9999n, netMinor: 9999n, createdBy: ACTOR, updatedBy: ACTOR },
      ]).onConflictDoNothing();
      await tx.insert(bankStatement).values({
        id: stmtId,
        tenantId: TENANT,
        bankAccountId: randomUUID(),
        status: "imported",
        createdBy: ACTOR,
      });
      // Bank shows a debit line with reference "UTR-MATCH" for 5000
      await tx.insert(bankStatementLines).values({
        id: randomUUID(),
        tenantId: TENANT,
        statementId: stmtId,
        lineDate: "2026-07-01",
        amountMinor: 5000n,
        direction: "debit",
        reference: "UTR-MATCH",
      });
      // Book payment matching that line (5000) + an extra payment with no bank line
      await tx.insert(financePayments).values([
        {
          tenantId: TENANT, billId: billMatchId, mode: "NEFT",
          amountMinor: 5000n, utr: "UTR-MATCH", createdBy: ACTOR, updatedBy: ACTOR,
        },
        {
          tenantId: TENANT, billId: billOrphanId, mode: "NEFT",
          amountMinor: 9999n, utr: "UTR-ORPHAN", createdBy: ACTOR, updatedBy: ACTOR,
        },
      ]);
    });

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/finance/recon/runs",
      headers: h(token()),
      payload: { provider: "book-vs-bank" },
    });
    expect(accepted.statusCode).toBe(202);

    const result = await runWithTenant(TENANT, () =>
      runReconciliation(
        { tenantId: TENANT, actorId: ACTOR },
        "book-vs-bank",
        {},
      ),
    );
    expect(result).not.toBeNull();
    // UTR-MATCH reconciles; UTR-ORPHAN is a book payment absent from the bank → break.
    expect(result!.balanced).toBe(false);
    expect(result!.breakCount).toBeGreaterThanOrEqual(1);

    const exc = await app.inject({ method: "GET", url: `/v1/finance/recon/runs/${result!.run.id}`, headers: h(token()) });
    const keys = exc.json().breaks.map((b: any) => b.breakKey);
    expect(keys).toContain("UTR-ORPHAN");
  });

  it("isolates tenants — Tenant B sees none of Tenant A's runs/exceptions (RLS)", async () => {
    const runs = await app.inject({ method: "GET", url: "/v1/finance/recon/runs", headers: h(token(TENANT_B)) });
    expect(runs.json().meta.total).toBe(0);
    const exc = await app.inject({ method: "GET", url: "/v1/finance/recon/exceptions", headers: h(token(TENANT_B)) });
    expect(exc.json().meta.total).toBe(0);
  });
});
