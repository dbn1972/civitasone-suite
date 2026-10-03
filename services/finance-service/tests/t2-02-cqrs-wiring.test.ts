/**
 * T2-02 — finance CQRS wiring + scanner-db presence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const publish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publish(...args) },
  cache: { invalidate: vi.fn(), getOrLoad: vi.fn(), put: vi.fn() },
}));

describe("T2-02 finance CQRS + scanner-db", () => {
  beforeEach(() => publish.mockClear());

  it("shared/scanner-db.ts exists and worker routes relay/purge through scannerDb", () => {
    const scanner = readFileSync(resolve(__dirname, "../src/shared/scanner-db.ts"), "utf8");
    expect(scanner).toContain("FINANCE_SCANNER_DATABASE_URL");
    expect(scanner).toContain("export const scannerDb");
    const worker = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(worker).toContain("startRelay(scannerDb");
    expect(worker).toContain("startOutboxPurge(scannerDb");
    expect(worker).toContain("registerReconConsumers");
  });

  it("bank-recon / period-close / pfms / org-structure / recon / approvals / uc / debt-guarantee / office / bank / fiscal-year routes have no db.(transaction|insert|update|delete)", () => {
    for (const rel of [
      "bank-recon/routes.ts",
      "org-structure/routes.ts",
      "period-close/routes.ts",
      "pfms/routes.ts",
      "recon/routes.ts",
      // fp-finance-01
      "approvals/routes.ts",
      "payments/uc-routes.ts",
      "treasury/register-routes.ts",
      "budget/office-routes.ts",
      "masters/bank-routes.ts",
      "masters/fy-routes.ts",
      // fp-finance-02 workflow routes: route -> command (fresh messageId) -> consumer
      "masters/vendor-workflow-routes.ts",
      "audit/routes.ts",
      "instruments/routes.ts",
    ]) {
      const src = readFileSync(resolve(__dirname, `../src/modules/${rel}`), "utf8");
      expect(src).not.toMatch(/\bdb\.(transaction|insert|update|delete)\s*\(/);
    }
  });

  it("fp-finance-02 workflow commands each have a topic and a worker-registered consumer", () => {
    const topics = readFileSync(resolve(__dirname, "../src/topics.ts"), "utf8");
    for (const t of [
      "finance.vendor.decide", "finance.vendor.bank_change_propose", "finance.vendor.bank_change_decide",
      "finance.policy.change", "finance.policy.change_decide", "finance.audit_para.transition",
      "finance.instrument.represent", "finance.instrument.mark_stale",
    ]) expect(topics).toContain(`"${t}"`);
    const worker = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    for (const r of ["registerVendorConsumers(queue)", "registerAuditConsumers(queue)", "registerInstrumentWorkflowConsumers(queue)"]) {
      expect(worker).toContain(r);
    }
    // the routes publish through publishCommand (fresh randomUUID messageId), never write
    const cmd = readFileSync(resolve(__dirname, "../src/shared/finance-command.ts"), "utf8");
    expect(cmd).toContain("messageId: randomUUID()");
  });

  it("commands publish expected topics", async () => {
    const ctx = {
      tenantId: "aaaaaaaa-1111-4000-8000-000000000001",
      actorId: "bbbbbbbb-2222-4000-8000-000000000001",
      correlationId: "corr-1",
      roles: ["finance_admin"],
    } as any;

    const bank = await import("../src/modules/bank-recon/commands.js");
    await bank.importStatement(ctx, {
      bankAccountId: "cccccccc-3333-4000-8000-000000000001",
      lines: [{ date: "2026-07-01", amountMinor: 100, direction: "debit" }],
    });
    expect(publish.mock.calls[0][0]).toBe("finance.bank_statement.import");

    const period = await import("../src/modules/period-close/commands.js");
    await period.closePeriod(ctx, "2026-07", "soft_close", "Month-end close after review");
    expect(publish.mock.calls.at(-1)![0]).toBe("finance.period.close");

    const recon = await import("../src/modules/recon/commands.js");
    await recon.startReconRun(ctx, { provider: "test-fixture" });
    expect(publish.mock.calls.at(-1)![0]).toBe("finance.recon.run");
  });
});
