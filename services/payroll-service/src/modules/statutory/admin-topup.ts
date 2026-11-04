/**
 * Review SF3 (ERP-head decision 2026-11-05): the EPF administrative charges
 * (A/c 2) have a statutory minimum per establishment per wage month (Rs 500,
 * statutory_config.epf_admin_min_minor). Runs accrue the per-member 0.5%; when
 * the month's EPF challan is closed the shortfall max(0, minimum - admin
 * accrued) is accrued ONCE as its own line. Pure builders; the write side is
 * challan-close.ts. Consumer: finance-service gl/consumer.ts (journal command,
 * generic StandardJournal path); pinned by
 * tests/contract/payroll-epf-admin-topup.contract.test.ts.
 */
export const EMPLOYER_EXPENSE_HEAD = "5002";
export const EMPLOYER_PAYABLE_HEAD = "2103";

/** Pure: the month top-up -- nothing when the establishment had no EPF member that month. */
export function adminTopUpMinor(adminAccruedMinor: bigint, memberCount: number, minimumMinor: bigint): bigint {
  if (memberCount <= 0) return 0n;
  return adminAccruedMinor < minimumMinor ? minimumMinor - adminAccruedMinor : 0n;
}

export interface AdminTopUpJournal {
  id: string; tenantId: string; voucherNo: string; type: "payroll_accrual"; postingDate: string;
  lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string; narration: string }>;
}

/** Pure: the finance journal for a top-up (one Dr expense / Cr payable pair, same heads as the other employer contributions). */
export function adminTopUpJournal(i: { journalId: string; tenantId: string; period: string; topUpMinor: bigint; postingDate: string }): AdminTopUpJournal {
  const amt = i.topUpMinor.toString();
  return {
    id: i.journalId, tenantId: i.tenantId, voucherNo: `PAY/EPF-A2/${i.period}`, type: "payroll_accrual", postingDate: i.postingDate,
    lines: [
      { accountCode: EMPLOYER_EXPENSE_HEAD, debitMinor: amt, creditMinor: "0", narration: `EPF administrative charges minimum top-up (EPFO A/c 2) ${i.period}` },
      { accountCode: EMPLOYER_PAYABLE_HEAD, debitMinor: "0", creditMinor: amt, narration: `EPF administrative charges payable to EPFO (A/c 2 minimum) ${i.period}` },
    ],
  };
}
