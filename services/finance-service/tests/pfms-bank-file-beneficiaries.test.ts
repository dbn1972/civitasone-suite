/**
 * GET /v1/finance/pfms/:id/bank-file — regression coverage for
 * listRealBeneficiaries() (pfms/repo.ts), covering two distinct bugs found
 * in sequence on the same function:
 *
 * 1. The original 500: the raw SQL selected p.vendor_ref / p.bank_account_ref,
 *    neither of which has ever existed on payments.finance_payments
 *    (confirmed via `\d payments.finance_payments` and every migration that
 *    ever touched the table -- real columns include bank_account_id, never
 *    vendor_ref / bank_account_ref). Every call 500'd with Postgres 42703
 *    ("column p.vendor_ref does not exist"), so a treasury batch's NEFT bank
 *    file could never be generated.
 *
 * 2. A follow-up review of that 500-fix (PR #1619) found the restored query
 *    resolved "Account Number"/"IFSC" via p.bank_account_id ->
 *    treasury.finance_banks -- a real FK (fk_fpayments_bank), but the WRONG
 *    table for a beneficiary: treasury.finance_banks holds the DEPARTMENT's
 *    own disbursing/treasury account (see bank-recon/repo.ts), not the
 *    vendor's. Proven empirically: a vendor seeded with its own
 *    bank_account_no came back with the DEPARTMENT's treasury account number
 *    in the generated bank file instead. The fixed query now sources
 *    account/IFSC from finance_vendors.bank_account_no/.ifsc instead -- the
 *    vendor's own payment-routing details (0065_vendor_master.sql; also what
 *    docs/user-manual/02-FINANCE.md documents for payment initiation: "These
 *    come from the vendor record.").
 *
 * This seeds a realistic vendor -> bill -> payment -> PFMS batch chain and
 * asserts the endpoint returns a real, *decrypted*, structurally sane NEFT
 * bank-file CSV, with three payments exercising:
 *   - PAYMENT_WITH_BANK    : a treasury bank_account_id IS set (and resolves
 *                            to a real treasury.finance_banks row) -- proves
 *                            that account's number (DEPT_ACCOUNT_NO) is NOT
 *                            what comes back. This is the exact regression
 *                            class the review caught: silently plausible,
 *                            wrong data, no error of any kind.
 *   - PAYMENT_NO_BANK      : no bank_account_id at all -- proves the vendor's
 *                            account/IFSC resolve anyway (they never actually
 *                            depended on bank_account_id).
 *   - PAYMENT_ORPHAN_VENDOR: bill_id -> a vendor_id with no matching
 *                            finance_vendors row (vendor_id carries no FK --
 *                            see 0065_vendor_master.sql) -- proves account/
 *                            IFSC blank out gracefully instead of crashing or
 *                            printing stale/ciphertext data. This is the only
 *                            way finance_vendors' NOT NULL bank_account_no/
 *                            ifsc can still come back empty here.
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
const ORPHAN_VENDOR_ID = "66666666-a000-9999-8000-0000000000fc"; // deliberately NOT inserted into finance_vendors
const HEAD = "66666666-bbbb-4000-8000-0000000000fc";
const BANK = "66666666-cccc-4000-8000-0000000000fc";
const BILL = "66666666-dddd-4000-8000-0000000000fc";
const BILL2 = "66666666-dddd-1111-8000-0000000000fc";
const BILL3 = "66666666-dddd-2222-8000-0000000000fc";
const PAYMENT_WITH_BANK = "66666666-eeee-4000-8000-0000000000fc";
const PAYMENT_NO_BANK = "66666666-e0e0-4000-8000-0000000000fc";
const PAYMENT_ORPHAN_VENDOR = "66666666-e0e1-4000-8000-0000000000fc";
const PFMS_BATCH = "66666666-ffff-4000-8000-0000000000fc";
const PFMS_BUSINESS_ID = "PFMS-TEST-BANKFILE-001";
// The vendor's OWN account -- what a beneficiary file must contain. Distinct
// from DEPT_ACCOUNT_NO below on purpose: the review's exact proof scenario.
const VENDOR_ACCOUNT_NO = "220099887766"; // seeded cleartext -- must round-trip through encryptedText
const VENDOR_IFSC = "VEND0009988";
// The DEPARTMENT's own treasury/disbursing account (treasury.finance_banks) --
// linked to PAYMENT_WITH_BANK via bank_account_id, and must NEVER appear
// anywhere in the generated bank file.
const DEPT_ACCOUNT_NO = "500011002200";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pfms-bankfile" }, SECRET);
}
const financeAdmin = () => ({ authorization: `Bearer ${token(["finance_admin"])}` });

async function cleanup() {
  await scoped(TENANT, (tx) => tx.delete(financePfms).where(eq(financePfms.id, PFMS_BATCH)));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM payments.finance_payments WHERE id IN (${PAYMENT_WITH_BANK}::uuid, ${PAYMENT_NO_BANK}::uuid, ${PAYMENT_ORPHAN_VENDOR}::uuid)`));
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, BILL)));
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, BILL2)));
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, BILL3)));
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
    bankAccountNo: VENDOR_ACCOUNT_NO, ifsc: VENDOR_IFSC,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // The table bank_account_id is actually FK'd to (fk_fpayments_bank) --
  // NOT payments.finance_bank_accounts. This is the DEPARTMENT's own
  // treasury account -- real and resolvable, but must never leak into the
  // beneficiary "Account Number"/"IFSC" fields. accountNo is `encryptedText`;
  // inserting through the drizzle table encrypts it transparently, the same
  // way the real bank-account-creation path does.
  await scoped(TENANT, (tx) => tx.insert(financeBanks).values({
    id: BANK, tenantId: TENANT, name: "Treasury Single Account",
    accountNo: DEPT_ACCOUNT_NO, createdBy: ACTOR, updatedBy: ACTOR,
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
  // A third bill pointing at a vendor_id with no backing finance_vendors row
  // (allowed: vendor_id carries no FK -- see 0065_vendor_master.sql). Models
  // an orphaned/legacy vendor_id -- the only way the vendor-sourced
  // account/IFSC can still come back blank.
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: BILL3, tenantId: TENANT, billNo: "BILL/BANKFILE/003", vendorId: ORPHAN_VENDOR_ID, headId: HEAD,
    grossMinor: 100000n, netMinor: 100000n, status: "paid",
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
  // vendor's own account/IFSC resolve regardless of whether a treasury
  // bank_account_id is set at all (they were never sourced from it).
  // created_at is 1s earlier so ORDER BY created_at DESC is deterministic.
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO payments.finance_payments
      (id, tenant_id, bill_id, bank_account_id, mode, amount_minor, utr, ddo_code, status, pfms_id, created_by, updated_by, created_at)
    VALUES
      (${PAYMENT_NO_BANK}::uuid, ${TENANT}::uuid, ${BILL2}::uuid, NULL, 'NEFT', 250000, 'UTR2026TEST0002', 'DDO12345', 'released', ${PFMS_BUSINESS_ID}, ${ACTOR}::uuid, ${ACTOR}::uuid, now() - interval '1 second')
  `));
  // Third payment: bill_id resolves, but its vendor_id doesn't -- proves the
  // fix's null-guard around decryptPii() (a raw tx.execute() read bypasses
  // drizzle's customType auto-decrypt, so repo.ts must call decryptPii()
  // itself -- and must not crash when the LEFT JOIN to finance_vendors finds
  // nothing). bank_account_id IS set here too, reinforcing that a resolvable
  // treasury account must still never substitute for an unresolved vendor.
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO payments.finance_payments
      (id, tenant_id, bill_id, bank_account_id, mode, amount_minor, utr, ddo_code, status, pfms_id, created_by, updated_by, created_at)
    VALUES
      (${PAYMENT_ORPHAN_VENDOR}::uuid, ${TENANT}::uuid, ${BILL3}::uuid, ${BANK}::uuid, 'NEFT', 100000, 'UTR2026TEST0003', 'DDO12345', 'released', ${PFMS_BUSINESS_ID}, ${ACTOR}::uuid, ${ACTOR}::uuid, now() - interval '2 seconds')
  `));
  await scoped(TENANT, (tx) => tx.insert(financePfms).values({
    id: PFMS_BATCH, tenantId: TENANT, pfmsId: PFMS_BUSINESS_ID, type: "grant",
    amountMinor: 850000n, submissionStatus: "signed", status: "submitted",
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
      expect(rows.length).toBe(3);

      const withBank = rows.find((r) => r["Payment Ref"] === "UTR2026TEST0001");
      expect(withBank).toBeDefined();
      // Resolved vendor name (via bill_id -> finance_bills.vendor_id ->
      // finance_vendors.name), not blank and not a raw vendor UUID.
      expect(withBank!["Beneficiary Name"]).toBe("M/s Real Beneficiary Pvt Ltd");
      // Decrypted, and the VENDOR's own account/IFSC -- not the department's
      // treasury account, even though a valid bank_account_id linking to it
      // is set on this exact payment. This is the regression the review
      // caught: it would previously have equaled DEPT_ACCOUNT_NO here.
      expect(withBank!["Account Number"]).toBe(VENDOR_ACCOUNT_NO);
      expect(withBank!["Account Number"]).not.toBe(DEPT_ACCOUNT_NO);
      expect(withBank!["Account Number"]).not.toContain("enc:");
      expect(withBank!["IFSC"]).toBe(VENDOR_IFSC);
      expect(withBank!["IFSC"]).not.toContain("enc:");
      expect(withBank!["Amount"]).toBe("5000.00"); // 500000 paise
      expect(withBank!["DDO"]).toBe("DDO12345");

      const noBank = rows.find((r) => r["Payment Ref"] === "UTR2026TEST0002");
      expect(noBank).toBeDefined();
      expect(noBank!["Beneficiary Name"]).toBe("M/s Real Beneficiary Pvt Ltd");
      // No bank_account_id on this payment at all -- the vendor's account/
      // IFSC still resolve, proving they were never actually sourced from it.
      expect(noBank!["Account Number"]).toBe(VENDOR_ACCOUNT_NO);
      expect(noBank!["IFSC"]).toBe(VENDOR_IFSC);
      expect(noBank!["Amount"]).toBe("2500.00"); // 250000 paise

      const orphanVendor = rows.find((r) => r["Payment Ref"] === "UTR2026TEST0003");
      expect(orphanVendor).toBeDefined();
      // bill_id resolves but vendor_id doesn't -- routes.ts falls back to
      // "Unknown beneficiary" for a blank resolved name.
      expect(orphanVendor!["Beneficiary Name"]).toBe("Unknown beneficiary");
      // No vendor row to source account/IFSC from -- blank, not a crash, and
      // NOT the department's treasury account even though bank_account_id is
      // set on this payment too.
      expect(orphanVendor!["Account Number"]).toBe("");
      expect(orphanVendor!["IFSC"]).toBe("");
      expect(orphanVendor!["Amount"]).toBe("1000.00"); // 100000 paise
    } finally {
      await app.close();
    }
  });
});
