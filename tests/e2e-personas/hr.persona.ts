/**
 * Persona E2E: HR Officer
 *
 * Journey: HR hub → employees list → leave applications → attendance → estab hub
 */
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth.js";
import { assertPageLoaded, assertHasData } from "./helpers/assertions.js";

test.describe("HR Officer persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "hrofficer", baseURL!);
  });

  test("can access the HR hub", async ({ page, baseURL }) => {
    await page.goto("/hr");
    await assertPageLoaded(page, "/hr");
  });

  test("can view employees list with seeded data", async ({ page, baseURL }) => {
    await page.goto("/hr/employees");
    await assertPageLoaded(page, "/hr/employees");
    await assertHasData(page, "hr/employees");
  });

  test("can view leave applications", async ({ page, baseURL }) => {
    await page.goto("/hr/leave");
    await assertPageLoaded(page, "/hr/leave");
  });

  test("can view attendance", async ({ page, baseURL }) => {
    await page.goto("/hr/attendance");
    await assertPageLoaded(page, "/hr/attendance");
  });

  test("can access establishment hub", async ({ page, baseURL }) => {
    await page.goto("/estab");
    await assertPageLoaded(page, "/estab");
  });

  test("can view establishment files", async ({ page, baseURL }) => {
    await page.goto("/estab/dak");
    await assertPageLoaded(page, "/estab/dak");
  });
});
