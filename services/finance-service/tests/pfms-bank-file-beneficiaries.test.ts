/**
 * GET /v1/finance/pfms/:id/bank-file — regression coverage for the
 * listRealBeneficiaries() column-name bug (pfms/repo.ts).
 *
 * The raw SQL selected p.vendor_ref / p.bank_account_ref, neither of which
 * has ever existed on payments.finance_payments (confirmed via `\d
 * payments.finance_payments` and every migration that ever touched the
 * table -- real columns include bank_account_id, never vendor_ref /
 * bank_account_ref). Every call 500'd with Postgres 42703 ("column
 * p.vendor_ref does not exist"), so a treasury batch's NEFT bank file could
 * never be generated -- the only reachable state for this route always
 * failed.
 *
 * This seeds a realistic vendor -> bill -> payment -> PFMS batch chain
 * (including a real, `encryptedText` bank_account_id row in
 * treasury.finance_banks, the table bank_account_id is actually FK'd to --
 * see fk_fpayments_bank) and asserts the endpoint returns a real,
 * *decrypted*, structurally sane NEFT bank-file CSV. A second payment with
 * no bank_account_id proves the fix's null-guard around decryptPii() (a raw
 * tx.execute() read bypasses drizzle's customType auto-decrypt, so repo.ts
 * must call decryptPii() itself -- and must not crash when the LEFT JOIN
 * finds nothing to decrypt).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeVendors } from "../src/modules/masters/schema.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financePfms } from "../src/modules/payments/schema.js";
import { financeBanks } from "../src/modules/treasury/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000fc";
const ACTOR = "00000000-aaaa-4000-8000-0000000000fc";
const VENDOR = "66666666-aaaa-4000-8000-0000000000fc";
const HEAD = "66666666-bbbb-4000-8000-0000000000fc";
const BANK = "66666666-cccc-4000-8000-0000000000fc";
const BILL = "66666666-dddd-4000-8000-0000000000fc";
const BILL2 = "66666666-dddd-1111-8000-0000000000fc";
const PAYMENT_WITH_BANK = "66666666-eeee-4000-8000-0000000000fc";
const PAYMENT_NO_BANK = "66666666-e0e0-4000-8000-0000000000fc";
const PFMS_BATCH = "66666666-ffff-4000-8000-0000000000fc";
const PFMS_BUSINESS_ID = "PFMS-TEST-BANKFILE-001";
const REAL_ACCOUNT_NO = "112233445566"; // seeded cleartext -- must round-trip through encryptedText

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pfms-bankfile" }, SECRET);
}
const financeAdmin = () => ({ authorization: `Bearer ${token(["finance_admin"])}` });

async function cleanup() {
  await scoped(TENANT, (tx) => tx.delete(financePfms).where(eq(financePfms.id, PFMS_BATCH)));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM payments.finance_payments WHERE id IN (${PAYMENT_WITH_BANK}::uuid, ${PAYMENT_NO_BANK}::uuid)`));
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, BILL)));
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, BILL2)));
  await scoped(TENANT, (tx) => tx.delete(financeBanks).where(eq(financeBanks.id, BANK)));
  await scoped(TENANT, (tx) => tx.delete(financeVendors).where(eq(financeVendors.id, VENDOR)));
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD)));
}

beforeAll(async () => {
  await cleanup();
  // finance_bills.head_id carries a real FK to budget.finance_heads(id).
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "5100-BANKFILE", name: "Bank File Test Head", level: 2,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(TENANT, (tx) => tx.insert(financeVendors).values({
    id: VENDOR, tenantId: TENANT, name: "M/s Real Beneficiary Pvt Ltd", category: "supplies",
    pan: "ABCDE1234F", address: "1 Test Road", bankName: "Vendor's Own Bank",
    bankAccountNo: "999888777666", ifsc: "VEND0009988",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // The table bank_account_id is actually FK'd to (fk_fpayments_bank) --
  // NOT payments.finance_bank_accounts. accountNo is `encryptedText`;
  // inserting through the drizzle table encrypts it transparently, the same
  // way the real bank-account-creation path does.
  await scoped(TENANT, (tx) => tx.insert(financeBanks).values({
    id: BANK, tenantId: TENANT, name: "Treasury Single Account",
    accountNo: REAL_ACCOUNT_NO, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: BILL, tenantId: TENANT, billNo: "BILL/BANKFILE/001", vendorId: VENDOR, headId: HEAD,
    grossMinor: 500000n, netMinor: 500000n, status: "paid",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // A second bill for the second payment: finance_payments carries
  // UNIQUE(tenant_id, bill_id) (uq_finance_payments_tenant_bill), so two
  // payments in the same test can't share one bill_id.
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: BILL2, tenantId: TENANT, billNo: "BILL/BANKFILE/002", vendorId: VENDOR, headId: HEAD,
    grossMinor: 250000n, netMinor: 250000n, status: "paid",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // finance_payments.pfms_id (migration 0016) and the rest of this row are
  // written via raw SQL: pfms_id is schema drift absent from
  // payments/schema.ts's drizzle table (same gap listRealBeneficiaries
  // itself works around with tx.execute()), so a typed insert can't set it.
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO payments.finance_payments
      (id, tenant_id, bill_id, bank_account_id, mode, amount_minor, utr, ddo_code, status, pfms_id, created_by, updated_by, created_at)
    VALUES
      (${PAYMENT_WITH_BANK}::uuid, ${TENANT}::uuid, ${BILL}::uuid, ${BANK}::uuid, 'NEFT', 500000, 'UTR2026TEST0001', 'DDO12345', 'initiated', ${PFMS_BUSINESS_ID}, ${ACTOR}::uuid, ${ACTOR}::uuid, now())
  `));
  // Second payment in the same batch with NO bank_account_id -- proves the
  // fix's null-guard (`r.account ? decryptPii(r.account) : ""`) doesn't
  // throw when the LEFT JOIN to treasury.finance_banks finds nothing.
  // created_at is 1s earlier so ORDER BY created_at DESC is deterministic.
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO payments.finance_payments
      (id, tenant_id, bill_id, bank_account_id, mode, amount_minor, utr, ddo_code, status, pfms_id, created_by, updated_by, created_at)
    VALUES
      (${PAYMENT_NO_BANK}::uuid, ${TENANT}::uuid, ${BILL2}::uuid, NULL, 'NEFT', 250000, 'UTR2026TEST0002', 'DDO12345', 'released', ${PFMS_BUSINESS_ID}, ${ACTOR}::uuid, ${ACTOR}::uuid, now() - interval '1 second')
  `));
  await scoped(TENANT, (tx) => tx.insert(financePfms).values({
    id: PFMS_BATCH, tenantId: TENANT, pfmsId: PFMS_BUSINESS_ID, type: "grant",
    amountMinor: 750000n, submissionStatus: "signed", status: "submitted",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

/** Split a bank-file CSV (no embedded commas in this fixture's values) into row objects. */
function parseRows(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split("\r\n");
  const header = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

describe("GET /v1/finance/pfms/:id/bank-file", () => {
  it("generates a real NEFT bank file instead of 500ing (regression: vendor_ref/bank_account_ref did not exist)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: `/v1/finance/pfms/${PFMS_BATCH}/bank-file`, headers: financeAdmin(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain(`pfms_${PFMS_BUSINESS_ID}.csv`);

      const rows = parseRows(res.body);
      expect(rows.length).toBe(2);

      const withBank = rows.find((r) => r["Payment Ref"] === "UTR2026TEST0001");
      expect(withBank).toBeDefined();
      // Resolved vendor name (via bill_id -> finance_bills.vendor_id ->
      // finance_vendors.name), not blank and not a raw vendor UUID.
      expect(withBank!["Beneficiary Name"]).toBe("M/s Real Beneficiary Pvt Ltd");
      // Decrypted account_no -- proves it round-tripped through
      // encryptedText correctly rather than coming back as ciphertext.
      expect(withBank!["Account Number"]).toBe(REAL_ACCOUNT_NO);
      expect(withBank!["Account Number"]).not.toContain("enc:");
      expect(withBank!["Amount"]).toBe("5000.00"); // 500000 paise
      expect(withBank!["DDO"]).toBe("DDO12345");

      const noBank = rows.find((r) => r["Payment Ref"] === "UTR2026TEST0002");
      expect(noBank).toBeDefined();
      expect(noBank!["Beneficiary Name"]).toBe("M/s Real Beneficiary Pvt Ltd");
      expect(noBank!["Account Number"]).toBe(""); // no bank_account_id -- blank, not a crash
      expect(noBank!["Amount"]).toBe("2500.00"); // 250000 paise
    } finally {
      await app.close();
    }
  });
});
