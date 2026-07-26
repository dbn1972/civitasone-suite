/**
 * CAP-059 — reconciliation consumer integration tests (finance-service).
 *
 * Proves the @civitasone/reconciliation engine is really wired: a run persists
 * a recon_run + breaks, a seeded mismatch produces a break, and the exception
 * lifecycle (open→investigating→resolved) works — all under FORCE RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { reconRun, reconBreak } from "../src/modules/recon/schema.js";
import { registerProvider, getProvider, listProviders } from "../src/modules/recon/providers.js";
import { financePayments } from "../src/modules/payments/schema.js";
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

  it("runs a reconciliation, persists the run + breaks, and drives the exception lifecycle", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/v1/finance/recon/runs",
      headers: h(token()),
      payload: { provider: "test-fixture" },
    });
    expect(run.statusCode).toBe(201);
    const body = run.json().data;
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

    // lifecycle: open → investigating → resolved
    const bid = mismatch.id;
    const inv = await app.inject({
      method: "POST",
      url: `/v1/finance/recon/exceptions/${bid}/action`,
      headers: h(token()),
      payload: { action: "investigate", note: "checking with bank" },
    });
    expect(inv.json().data.status).toBe("investigating");

    const resv = await app.inject({
      method: "POST",
      url: `/v1/finance/recon/exceptions/${bid}/action`,
      headers: h(token()),
      payload: { action: "resolve", note: "bank corrected the amount" },
    });
    expect(resv.json().data.status).toBe("resolved");
    expect(resv.json().data.resolvedBy).toBeTruthy();
    expect(resv.json().data.resolvedAt).toBeTruthy();

    // illegal transition: resolved → investigate → 409
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
    await scoped(TENANT, async (tx: any) => {
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
          tenantId: TENANT, billId: randomUUID(), mode: "NEFT",
          amountMinor: 5000n, utr: "UTR-MATCH", createdBy: ACTOR, updatedBy: ACTOR,
        },
        {
          tenantId: TENANT, billId: randomUUID(), mode: "NEFT",
          amountMinor: 9999n, utr: "UTR-ORPHAN", createdBy: ACTOR, updatedBy: ACTOR,
        },
      ]);
    });

    const run = await app.inject({
      method: "POST",
      url: "/v1/finance/recon/runs",
      headers: h(token()),
      payload: { provider: "book-vs-bank" },
    });
    expect(run.statusCode).toBe(201);
    const body = run.json().data;
    // UTR-MATCH reconciles; UTR-ORPHAN is a book payment absent from the bank → break.
    expect(body.balanced).toBe(false);
    expect(body.breakCount).toBeGreaterThanOrEqual(1);

    const exc = await app.inject({ method: "GET", url: `/v1/finance/recon/runs/${body.runId}`, headers: h(token()) });
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
