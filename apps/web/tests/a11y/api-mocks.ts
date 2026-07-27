/**
 * API mock fixtures for accessibility testing.
 *
 * These routes return minimal but structurally valid data so the page renders
 * its DataTable, sort controls, filter inputs, pagination, and export buttons —
 * the data-bearing UI where accessibility defects actually live.
 *
 * Without mocks, these routes show the "Showing saved information" empty state
 * because the gateway is unreachable in the test environment, and the a11y gate
 * correctly marks them as UNCERTIFIED (not audited, not passed).
 */
import type { Page } from "@playwright/test";

const MOCK_APPROVAL_TASKS = {
  data: [
    { id: "t-001", name: "Budget Sanction Approval", ref_type: "finance_sanction", ref_id: "s-001", status: "pending", created_at: "2026-07-20T10:00:00Z", due_at: "2026-07-27T10:00:00Z" },
    { id: "t-002", name: "Transfer Order Review", ref_type: "hr_transfer", ref_id: "tr-001", status: "pending", created_at: "2026-07-21T10:00:00Z", due_at: "2026-07-28T10:00:00Z" },
    { id: "t-003", name: "PO Release", ref_type: "procurement_po", ref_id: "po-001", status: "pending", created_at: "2026-07-22T10:00:00Z", due_at: null },
  ],
  meta: { page: 1, pageSize: 15, total: 3 },
};

const MOCK_PAYMENTS = {
  data: [
    { id: "p-001", billNo: "BILL-2026-001", vendorName: "ABC Corp", amountMinor: "1500000", currency: "INR", mode: "neft", status: "released", createdAt: "2026-07-15T09:00:00Z" },
    { id: "p-002", billNo: "BILL-2026-002", vendorName: "XYZ Ltd", amountMinor: "2300000", currency: "INR", mode: "rtgs", status: "initiated", createdAt: "2026-07-16T09:00:00Z" },
    { id: "p-003", billNo: "BILL-2026-003", vendorName: "Gov Supplies", amountMinor: "750000", currency: "INR", mode: "neft", status: "pending_approval", createdAt: "2026-07-17T09:00:00Z" },
  ],
  meta: { page: 1, pageSize: 15, total: 3 },
};

const MOCK_BUDGET_ALLOCATION = {
  data: [
    { id: "a-001", headCode: "2055-01-001", headName: "Police Housing", allocatedMinor: "50000000", utilisedMinor: "12000000", balanceMinor: "38000000", fy: "2026-27" },
    { id: "a-002", headCode: "2210-03-001", headName: "Medical Supplies", allocatedMinor: "30000000", utilisedMinor: "8500000", balanceMinor: "21500000", fy: "2026-27" },
    { id: "a-003", headCode: "2202-01-001", headName: "Education Grants", allocatedMinor: "75000000", utilisedMinor: "42000000", balanceMinor: "33000000", fy: "2026-27" },
  ],
  meta: { page: 1, pageSize: 15, total: 3 },
};

const MOCK_GL = {
  data: [
    { id: "j-001", voucherNo: "JV-2026-0001", type: "receipt", postingDate: "2026-07-15", narration: "Salary disbursement", debitMinor: "1500000", creditMinor: "1500000", status: "posted" },
    { id: "j-002", voucherNo: "JV-2026-0002", type: "payment", postingDate: "2026-07-16", narration: "Vendor payment ABC Corp", debitMinor: "2300000", creditMinor: "2300000", status: "posted" },
    { id: "j-003", voucherNo: "JV-2026-0003", type: "journal", postingDate: "2026-07-17", narration: "Depreciation entry", debitMinor: "500000", creditMinor: "500000", status: "draft" },
  ],
  meta: { page: 1, pageSize: 15, total: 3 },
};

/**
 * Install API route mocks on the given Playwright page. Call before navigating
 * to ensure the loader receives data instead of a network error.
 */
export async function installApiMocks(page: Page): Promise<void> {
  await page.route("**/api/v1/workflow/tasks*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_APPROVAL_TASKS) }),
  );

  await page.route("**/api/v1/finance/payments*", (route) => {
    // Don't intercept single-payment detail requests
    if (route.request().url().match(/\/payments\/[a-f0-9-]+$/)) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_PAYMENTS) });
  });

  await page.route("**/api/v1/finance/budget/allocations*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_BUDGET_ALLOCATION) }),
  );

  await page.route("**/api/v1/finance/gl/journals*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_GL) }),
  );
}

/** Routes that need API mocks to render their data-bearing UI. */
export const MOCK_REQUIRED_ROUTES = new Set([
  "/approvals",
  "/finance/payments",
  "/finance/budget/allocation",
  "/finance/accounting/general-ledger",
]);
