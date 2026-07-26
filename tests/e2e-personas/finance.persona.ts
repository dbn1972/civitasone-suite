/**
 * Persona E2E: Finance Officer + Finance Admin
 *
 * Journey: navigate finance hub → view budgets → view dashboard → view GL
 * Asserts: pages load, data renders, no dead-ends, no errors.
 */
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth.js";
import { assertPageLoaded, assertHasData, navigateAndAssert } from "./helpers/assertions.js";

test.describe("Finance Officer persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "financeofficer", baseURL!);
  });

  test("can access the finance hub", async ({ page, baseURL }) => {
    await page.goto("/finance");
    await assertPageLoaded(page, "/finance");
  });

  test("can view budgets list with seeded data", async ({ page, baseURL }) => {
    await page.goto("/finance/budget/formulation");
    await assertPageLoaded(page, "/finance/budget/formulation");
    // Budget data exists in the demo seed
    await assertHasData(page, "finance/budget/formulation");
  });

  test("can view the finance dashboard", async ({ page, baseURL }) => {
    await page.goto("/finance/dashboard");
    await assertPageLoaded(page, "/finance/dashboard");
    // Should NOT show "Infinity" (we fixed that bug)
    const bodyText = await page.textContent("body");
    expect(bodyText).not.toContain("Infinity");
  });

  test("can navigate to sanctions", async ({ page, baseURL }) => {
    await page.goto("/finance/budget/sanctions");
    await assertPageLoaded(page, "/finance/budget/sanctions");
  });

  test("can view expenditure bills", async ({ page, baseURL }) => {
    await page.goto("/finance/expenditure/bills");
    await assertPageLoaded(page, "/finance/expenditure/bills");
  });

  test("can view treasury/payments", async ({ page, baseURL }) => {
    await navigateAndAssert(page, "/finance/payments", "finance payments");
  });
});

test.describe("Finance Admin persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "financeadmin", baseURL!);
  });

  test("can access finance hub as admin", async ({ page, baseURL }) => {
    await page.goto("/finance");
    await assertPageLoaded(page, "/finance");
  });

  test("can view chart of accounts", async ({ page, baseURL }) => {
    await page.goto("/finance/chart-of-accounts");
    await assertPageLoaded(page, "/finance/chart-of-accounts");
  });
});
