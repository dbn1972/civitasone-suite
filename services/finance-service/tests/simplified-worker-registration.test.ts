/**
 * Regression coverage for: src/worker.ts never registered the simplified
 * (MSME) module's consumer.
 *
 * What happened: modules/simplified/consumer.ts's registerSimplifiedConsumers
 * was written, exported, and even unit-tested (see simplified-consumer.test.ts)
 * — but nobody ever added the `import { registerSimplifiedConsumers } from
 * "./modules/simplified/consumer.js"` + `registerSimplifiedConsumers(queue);`
 * pair to worker.ts, unlike every one of the other 30 finance-service
 * modules. The HTTP routes publish commands onto the shared queue exactly
 * like every other module (commands.ts -> queue.publish), so every write
 * returned a clean 202 — but since the worker process (the only process that
 * ever calls queue.subscribe for this topic) never subscribed, MemoryQueue's
 * publish() resolves handlers for the topic at publish time (see
 * services/queue-service/src/bus.ts publish()); with zero subscribers the
 * message is simply discarded. No error, no DLQ entry, nothing — just silent
 * data loss. `GET summary` and every list endpoint read straight from
 * Postgres tables (gl.finance_journal_lines / simplified.transactions) that
 * only the consumer ever writes to, so they stayed at zero/empty forever.
 *
 * Why existing tests didn't catch it: every test that exercises
 * registerSimplifiedConsumers (simplified-consumer.test.ts, and the
 * appropriate-for-a-different-purpose finance.test.ts CQRS pattern this file
 * partly mirrors) calls it directly on a queue it owns — which proves the
 * CONSUMER LOGIC is correct, but structurally cannot prove worker.ts (the
 * actual production entrypoint) ever calls it. A bug in the wiring, not the
 * logic, needs a test that inspects the wiring itself.
 *
 * This file adds two independent regression tests for that gap:
 *
 *  - "worker.ts consumer wiring" (below): a static, source-level check that
 *    discovers every register*Consumers export across every consumer file
 *    under modules/ directly from the filesystem — NOT from a
 *    second hand-maintained list, which would carry the exact same risk of
 *    omission that let this bug through in the first place — and asserts
 *    worker.ts's own source both imports and calls each one. Run against the
 *    pre-fix source, this test fails specifically on
 *    "registerSimplifiedConsumers (from .../modules/simplified/consumer.ts)"
 *    — i.e. it names the exact thing that was missing.
 *
 *  - "simplified module — HTTP write -> queue -> consumer -> DB round trip"
 *    (below): registers the consumer on the SAME `queue` singleton
 *    shared/infra.js hands to the HTTP layer (commands.ts), then drives all 8
 *    routes through the real Fastify app via .inject() — proving the
 *    end-to-end behavior worker.ts's fix is supposed to produce, including
 *    that nothing else in this module is hiding behind the same class of
 *    bug. (Actually importing worker.ts as a module for this would pull in
 *    its production-only side effects — outbox relay/purge intervals,
 *    partition maintenance, graceful-shutdown signal handlers — none of
 *    which belong in a test process and none of which this codebase's
 *    existing tests ever do; registering on the shared queue singleton gets
 *    the same wiring proof without them.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerSimplifiedConsumers } from "../src/modules/simplified/consumer.js";
import { simplifiedAccounts, simplifiedTransactions } from "../src/modules/simplified/schema.js";
import { MSME_CHART_OF_ACCOUNTS } from "../src/modules/simplified/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../src");
const WORKER_SRC = readFileSync(path.join(SRC_DIR, "worker.ts"), "utf8");
const MODULES_DIR = path.join(SRC_DIR, "modules");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Discover every exported register*Consumers function from the actual
// modules/*/*consumer.ts files on disk.
// ---------------------------------------------------------------------------
type Registration = { fnName: string; file: string; relImportPath: string };

function discoverConsumerRegistrations(): Registration[] {
  const found: Registration[] = [];
  for (const moduleDir of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!moduleDir.isDirectory()) continue;
    const dir = path.join(MODULES_DIR, moduleDir.name);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith("consumer.ts")) continue;
      const filePath = path.join(dir, entry.name);
      const src = readFileSync(filePath, "utf8");
      for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(register\w*Consumers)\s*\(/g)) {
        const relImportPath = "./" + path.relative(SRC_DIR, filePath).replace(/\.ts$/, ".js").split(path.sep).join("/");
        found.push({ fnName: m[1], file: path.relative(SRC_DIR, filePath), relImportPath });
      }
    }
  }
  return found;
}

describe("worker.ts consumer wiring (static, integration-level)", () => {
  const registrations = discoverConsumerRegistrations();

  it("discovery itself works (sanity check on the scan, not on worker.ts)", () => {
    // 31 modules/*/*consumer.ts files exist today (30 wired + simplified);
    // asserting ">= 25" keeps this from silently doing nothing if the
    // modules/ layout changes, without hard-coding the exact count.
    expect(registrations.length).toBeGreaterThanOrEqual(25);
    expect(registrations.map((r) => r.fnName)).toContain("registerSimplifiedConsumers");
  });

  it.each(registrations)(
    "worker.ts imports and calls $fnName (from $file)",
    ({ fnName, relImportPath }) => {
      const importRe = new RegExp(
        `import\\s*\\{\\s*${fnName}\\s*\\}\\s*from\\s*["']${escapeRe(relImportPath)}["']`,
      );
      const callRe = new RegExp(`\\b${fnName}\\s*\\(\\s*queue\\s*\\)`);
      expect(WORKER_SRC, `worker.ts must "import { ${fnName} } from \\"${relImportPath}\\""`).toMatch(importRe);
      expect(WORKER_SRC, `worker.ts must call ${fnName}(queue)`).toMatch(callRe);
    },
  );
});

// ---------------------------------------------------------------------------
// Functional round trip — all 8 routes, combined HTTP + consumer process.
// ---------------------------------------------------------------------------
describe("simplified module — HTTP write -> queue -> consumer -> DB round trip (integration)", () => {
  // Freshly generated per test run (not a fixed constant): gl.finance_journals
  // is immutable (see wipeFixtures below), so a fixed tenant id would
  // accumulate postings — and inflate summary/cashflow totals — across
  // repeated local runs against the same long-lived dev DB instead of
  // cleanly starting over each time.
  const TENANT = randomUUID();
  const ACTOR = randomUUID();
  const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
  const PERIOD = "2026-06";
  const POSTING_DATE = "2026-06-15";

  function headers(roles: string[] = ["finance_officer"]) {
    const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-simplified-wiring" }, SECRET);
    return { authorization: `Bearer ${token}`, "x-tenant-edition": "small_office" };
  }

  // Deliberately does NOT delete gl.finance_journals / finance_journal_lines:
  // posted journals are immutable (a BEFORE DELETE trigger from migration
  // 0014_gl_immutability_reversal.sql rejects it outright — "cannot be
  // deleted"), by design, exactly like every other posting through this GL.
  // Leaving them behind is harmless: they're scoped to this file's own
  // dedicated, never-reused TENANT id, so nothing else ever reads them.
  async function wipeFixtures() {
    await scoped(TENANT, (tx) => tx.delete(simplifiedTransactions).where(eq(simplifiedTransactions.tenantId, TENANT)));
    await scoped(TENANT, (tx) => tx.delete(simplifiedAccounts).where(eq(simplifiedAccounts.tenantId, TENANT)));
  }

  beforeAll(async () => {
    await wipeFixtures();
    await scoped(TENANT, (tx) =>
      tx.insert(simplifiedAccounts).values(
        MSME_CHART_OF_ACCOUNTS.map((a) => ({
          tenantId: TENANT,
          code: a.code,
          name: a.name,
          category: a.category,
          parentCode: a.parentCode,
          isGroup: a.isGroup,
          createdBy: ACTOR,
          updatedBy: ACTOR,
        })),
      ),
    );

    // This is the behavior worker.ts's fix is responsible for in production:
    // the consumer registered on the exact queue singleton the HTTP layer
    // (commands.ts) publishes through. The static describe block above is
    // what proves worker.ts itself actually does this at process start; this
    // block proves that, once it does, the module works end to end.
    registerSimplifiedConsumers(queue);
  });

  afterAll(async () => {
    await wipeFixtures();
    await sqlClient.end();
  });

  it("all 4 write commands persist correctly and all 4 read routes reflect them", async () => {
    const app = await buildApp();

    const income = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-income",
      headers: headers(),
      payload: { amount: 5_000_000, customerName: "Acme Traders", incomeType: "sales", postingDate: POSTING_DATE },
    });
    expect(income.statusCode, income.body).toBe(202);

    const expense = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-expense",
      headers: headers(),
      payload: { amount: 1_200_000, category: "office_supplies", vendorName: "Stationery Hub", postingDate: POSTING_DATE },
    });
    expect(expense.statusCode, expense.body).toBe(202);

    const paymentReceived = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-payment-received",
      headers: headers(),
      payload: { amount: 2_000_000, customerName: "Acme Traders", postingDate: POSTING_DATE },
    });
    expect(paymentReceived.statusCode, paymentReceived.body).toBe(202);

    const paymentMade = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-payment-made",
      headers: headers(),
      payload: { amount: 700_000, vendorName: "Stationery Hub", postingDate: POSTING_DATE },
    });
    expect(paymentMade.statusCode, paymentMade.body).toBe(202);

    // Drain MemoryQueue's async fan-out (publish() delivers via setTimeout(0))
    // instead of racing a fixed sleep — see bus.ts's MemoryQueue.drain() doc.
    await (queue as unknown as MemoryQueue).drain();

    // --- GET summary ---------------------------------------------------
    const summaryRes = await app.inject({
      method: "GET",
      url: `/v1/finance/simplified/summary?period=${PERIOD}`,
      headers: headers(["viewer"]),
    });
    expect(summaryRes.statusCode, summaryRes.body).toBe(200);
    const summary = summaryRes.json();
    expect(summary.totalIncome).toBe(50000);
    expect(summary.totalExpense).toBe(12000);
    expect(summary.profit).toBe(38000);
    // cash (1001): +20000 (payment received) -12000 (expense paid from cash)
    // -7000 (payment made) = 1000. Income alone never touches cash — it debits
    // receivable, not cash — so a wired-but-broken consumer that "forgets" the
    // payment legs would show a different number here too.
    expect(summary.cashBalance).toBe(1000);

    // --- GET income ------------------------------------------------------
    const incomeList = await app.inject({
      method: "GET",
      url: "/v1/finance/simplified/income",
      headers: headers(["viewer"]),
    });
    expect(incomeList.statusCode, incomeList.body).toBe(200);
    const incomeRows = incomeList.json().data as Array<Record<string, unknown>>;
    expect(incomeRows).toHaveLength(1);
    expect(incomeRows[0]?.customer).toBe("Acme Traders");
    expect(incomeRows[0]?.amount).toBe(50000);
    expect(incomeRows[0]?.total).toBe(50000);

    // --- GET expenses ------------------------------------------------------
    const expenseList = await app.inject({
      method: "GET",
      url: "/v1/finance/simplified/expenses",
      headers: headers(["viewer"]),
    });
    expect(expenseList.statusCode, expenseList.body).toBe(200);
    const expenseRows = expenseList.json().data as Array<Record<string, unknown>>;
    expect(expenseRows).toHaveLength(1);
    expect(expenseRows[0]?.vendor).toBe("Stationery Hub");
    expect(expenseRows[0]?.amount).toBe(12000);

    // --- GET cashflow --------------------------------------------------
    const cashflow = await app.inject({
      method: "GET",
      url: `/v1/finance/simplified/cashflow?from=${POSTING_DATE}&to=${POSTING_DATE}`,
      headers: headers(["viewer"]),
    });
    expect(cashflow.statusCode, cashflow.body).toBe(200);
    const weeks = cashflow.json().data as Array<Record<string, unknown>>;
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.moneyIn).toBe(20000);
    expect(weeks[0]?.moneyOut).toBe(19000); // 12000 expense + 7000 payment made
    expect(weeks[0]?.net).toBe(1000);

    // --- payment-received / payment-made don't surface via any GET list
    // endpoint (by design — see queries.ts), so confirm directly in
    // simplified.transactions that they too actually persisted, with the
    // right amounts — the whole point of this file is that "returned 202"
    // must not be mistaken for "persisted".
    const txRows = await scoped(TENANT, (tx) =>
      tx.select().from(simplifiedTransactions).where(eq(simplifiedTransactions.tenantId, TENANT)),
    );
    expect(txRows).toHaveLength(4);
    const received = txRows.find((r) => r.type === "payment_received");
    const made = txRows.find((r) => r.type === "payment_made");
    expect(received?.counterParty).toBe("Acme Traders");
    expect(received?.amountMinor).toBe(2_000_000n);
    expect(made?.counterParty).toBe("Stationery Hub");
    expect(made?.amountMinor).toBe(700_000n);

    await app.close();
  });
});
