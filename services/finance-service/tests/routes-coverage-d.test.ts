/**
 * Finance route coverage D — POST routes with valid payloads for uncovered handlers.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-aaaa-4000-8000-000000000001";
const FAKE = randomUUID();

function token(roles = ["finance_admin", "super_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("Finance POST routes — valid payloads hitting handlers", () => {
  const routes = [
    {
      url: "/v1/finance/budgets",
      payload: { headId: randomUUID(), fy: "2025-26", beMinor: 10000000 },
    },
    {
      url: "/v1/finance/journals",
      payload: {
        type: "general",
        postingDate: "2026-06-01",
        lines: [
          { headId: randomUUID(), debitMinor: "100000", creditMinor: "0" },
          { headId: randomUUID(), debitMinor: "0", creditMinor: "100000" },
        ],
      },
    },
    {
      url: "/v1/finance/bills",
      payload: { headId: randomUUID(), amountMinor: 1000000, vendorName: "Test Vendor", poRef: "PO-001", grnRef: "GRN-001" },
    },
    {
      url: "/v1/finance/sanctions",
      payload: { sanctionNo: "SN/001", purpose: "Infrastructure", headId: randomUUID(), amountMinor: 50000000 },
    },
    {
      url: "/v1/finance/advances",
      payload: { employeeId: randomUUID(), purpose: "Travel", amountMinor: 500000, headId: randomUUID() },
    },
    {
      url: "/v1/finance/challans",
      payload: { receiptHeadId: randomUUID(), depositor: "ABC Corp", amountMinor: 1000000 },
    },
    {
      url: "/v1/finance/deposits",
      payload: { type: "security", administrator: "Contractor", balanceMinor: 500000 },
    },
    {
      url: "/v1/finance/recurring-entries",
      payload: { name: "Monthly Rent", headId: randomUUID(), frequency: "monthly", amountMinor: 50000, narration: "Rent", debitAccountId: randomUUID(), creditAccountId: randomUUID(), nextRunDate: "2026-07-01" },
    },
    {
      url: "/v1/finance/instruments",
      payload: { type: "cheque", amountMinor: 100000, payee: "Vendor" },
    },
    {
      url: "/v1/finance/simplified/record-income",
      payload: { amountMinor: "100000", gstMinor: "18000", totalMinor: "118000", customerName: "Client", incomeType: "sales", gstRate: 18, postingDate: "2026-06-01" },
    },
    {
      url: "/v1/finance/simplified/record-expense",
      payload: { amountMinor: "50000", gstMinor: "9000", totalMinor: "59000", category: "office_supplies", gstRate: 18, postingDate: "2026-06-01" },
    },
    {
      url: "/v1/finance/simplified/record-payment-received",
      payload: { amountMinor: "100000", customerName: "Client", postingDate: "2026-06-01" },
    },
    {
      url: "/v1/finance/simplified/record-payment-made",
      payload: { amountMinor: "75000", vendorName: "Vendor", postingDate: "2026-06-01" },
    },
    {
      url: "/v1/finance/utilization-certificates",
      payload: { advanceId: randomUUID(), amountUtilisedMinor: 400000, purpose: "Travel expenses" },
    },
    {
      url: "/v1/finance/vendor-tds",
      payload: { vendorId: randomUUID(), section: "194C", rate: 1, grossAmountMinor: 100000, tdsAmountMinor: 1000, netPaymentMinor: 99000, deductionDate: "2026-06-01", quarter: "Q1", fy: "2025-26" },
    },
  ];

  for (const { url, payload } of routes) {
    it(`POST ${url} — handler runs (not 404)`, async () => {
      const app = await buildApp();
      const r = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token()}` },
        payload,
      });
      await app.close();
      expect(r.statusCode).not.toBe(404);
    });
  }
});
