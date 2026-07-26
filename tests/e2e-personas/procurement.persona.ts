/**
 * Persona E2E: Procurement Officer
 *
 * Journey: procurement hub → vendors → indents → tenders → GRN
 */
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth.js";
import { assertPageLoaded, assertHasData } from "./helpers/assertions.js";

test.describe("Procurement Officer persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "procurementofficer", baseURL!);
  });

  test("can access the procurement hub", async ({ page, baseURL }) => {
    await page.goto("/procurement");
    await assertPageLoaded(page, "/procurement");
  });

  test("can view vendors with seeded data", async ({ page, baseURL }) => {
    await page.goto("/procurement/vendors");
    await assertPageLoaded(page, "/procurement/vendors");
    await assertHasData(page, "procurement/vendors");
  });

  test("can view indents", async ({ page, baseURL }) => {
    await page.goto("/procurement/indents");
    await assertPageLoaded(page, "/procurement/indents");
  });

  test("can view tenders", async ({ page, baseURL }) => {
    await page.goto("/procurement/tenders");
    await assertPageLoaded(page, "/procurement/tenders");
  });

  test("can view GRN", async ({ page, baseURL }) => {
    await page.goto("/procurement/grn");
    await assertPageLoaded(page, "/procurement/grn");
  });

  test("can access the procurement dashboard", async ({ page, baseURL }) => {
    await page.goto("/procurement/dashboard");
    await assertPageLoaded(page, "/procurement/dashboard");
  });
});
