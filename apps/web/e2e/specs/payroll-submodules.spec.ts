/**
 * E2E: Payroll Sub-modules — S12 (Salary Structure, Statutory Compliance, Challans)
 *                            S13 (Full & Final Settlement, Form 16, TDS Returns)
 *
 * Covers:
 *   /hr/payroll/structures           — Pay Structures page, SalaryStructureCard renders
 *   /hr/payroll/statutory            — Statutory Consoles, StatutoryComplianceCard: PF/ESI/PT/LWF
 *   /hr/payroll/statutory/challans   — ChallanTracker: PeriodSelector month input + View Period btn
 *   /hr/payroll/fnf                  — Full & Final Settlement: employee selector + separation type
 *   /hr/payroll/form16               — Form-16 Generation: financial year selector visible
 *   /finance/statutory/tds-returns   — TDS Returns page renders
 *
 * Auth: JWT with payroll_admin + hr_admin roles (see ../helpers/auth.ts).
 */

import { test, expect } from "@playwright/test";
import { authenticate } from "../helpers/auth";

test.describe("Payroll Sub-modules (S12-S13)", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // 1. Salary Structure /hr/payroll/structures
  //    SalaryStructureCard renders inside "Salary Structure Cards" card section.

  test("salary structure page loads with Pay Structures heading", async ({ page }) => {
    await page.goto("/hr/payroll/structures");
    await expect(page.getByRole("heading", { name: "Pay Structures" }).first()).toBeVisible();
  });

  test("salary structure page renders SalaryStructureCard section", async ({ page }) => {
    await page.goto("/hr/payroll/structures");
    await expect(page.getByRole("heading", { name: "Salary Structure Cards" })).toBeVisible();
  });

  // 2. Statutory Compliance /hr/payroll/statutory
  //    StatutoryComplianceCard shows one card per statutory head.

  test("statutory consoles page loads with correct heading", async ({ page }) => {
    await page.goto("/hr/payroll/statutory");
    await expect(page.getByRole("heading", { name: "Statutory Consoles" })).toBeVisible();
  });

  test("StatutoryComplianceCard shows PF/ESI/PT/LWF section headers", async ({ page }) => {
    await page.goto("/hr/payroll/statutory");
    await expect(page.getByText("PF (EPF)")).toBeVisible();
    await expect(page.getByText("ESI")).toBeVisible();
    await expect(page.getByText("Professional Tax")).toBeVisible();
    await expect(page.getByText("Labour Welfare Fund")).toBeVisible();
  });

  test("statutory page navigation tiles link to PF and ESI sub-pages", async ({ page }) => {
    await page.goto("/hr/payroll/statutory");
    await expect(page.getByRole("link", { name: /PF & ECR/i })).toHaveAttribute(
      "href",
      "/hr/payroll/statutory/pf"
    );
    await expect(page.getByRole("link", { name: /ESI/i }).first()).toHaveAttribute(
      "href",
      "/hr/payroll/statutory/esi"
    );
  });

  // 3. Challans & Reconciliation /hr/payroll/statutory/challans
  //    PeriodSelector renders <input type="month"> labelled "Period" + "View Period" button.

  test("challans page renders with month period selector", async ({ page }) => {
    await page.goto("/hr/payroll/statutory/challans");
    await expect(page.locator("input[type=\"month\"]").first()).toBeVisible();
  });

  test("challans period input type is month and View Period button present", async ({ page }) => {
    await page.goto("/hr/payroll/statutory/challans");
    const monthInput = page.locator("input[type=\"month\"]").first();
    await expect(monthInput).toBeVisible();
    await expect(monthInput).toHaveAttribute("type", "month");
    await expect(page.getByRole("button", { name: "View Period" })).toBeVisible();
  });

  // 4. Full & Final Settlement /hr/payroll/fnf
  //    ComputeFnfForm: Employee ID (UUID) input + Separation Type select.

  test("F&F settlement page loads with correct heading", async ({ page }) => {
    await page.goto("/hr/payroll/fnf");
    await expect(page.getByRole("heading", { name: "Full & Final Settlement" })).toBeVisible();
  });

  test("F&F form renders employee selector and separation type", async ({ page }) => {
    await page.goto("/hr/payroll/fnf");
    await expect(page.getByLabel(/Employee ID/i)).toBeVisible();
    await expect(page.getByLabel(/Separation Type/i)).toBeVisible();
  });

  // 5. Form 16 /hr/payroll/form16
  //    FyLookupForm: "Financial Year" labelled input + "Check run" button.

  test("Form 16 page loads with correct heading", async ({ page }) => {
    await page.goto("/hr/payroll/form16");
    await expect(page.getByRole("heading", { name: "Form-16 Generation" })).toBeVisible();
  });

  test("Form 16 financial year selector is visible", async ({ page }) => {
    await page.goto("/hr/payroll/form16");
    await expect(page.locator("input[name=\"fy\"]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Check run/i })).toBeVisible();
  });

  // 6. TDS Returns /finance/statutory/tds-returns
  //    PageHeader: "TDS Returns"; StatGrid: Total Returns, Filed, Pending.

  test("TDS Returns page loads with correct heading", async ({ page }) => {
    await page.goto("/finance/statutory/tds-returns");
    await expect(page.getByRole("heading", { name: "TDS Returns" })).toBeVisible();
  });

  test("TDS Returns stat cards render Total Returns and Filed", async ({ page }) => {
    await page.goto("/finance/statutory/tds-returns");
    await expect(page.getByText("Total Returns")).toBeVisible();
    await expect(page.getByText("Filed")).toBeVisible();
  });
});
