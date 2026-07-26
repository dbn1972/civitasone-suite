/**
 * Persona E2E: Auditor + Legal Officer
 */
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth.js";
import { assertPageLoaded, assertHasData } from "./helpers/assertions.js";

test.describe("Auditor persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "auditor", baseURL!);
  });

  test("can access the audit hub", async ({ page, baseURL }) => {
    await page.goto("/audit");
    await assertPageLoaded(page, "/audit");
  });

  test("can view audit plans with seeded data", async ({ page, baseURL }) => {
    await page.goto("/audit/plan");
    await assertPageLoaded(page, "/audit/plan");
    await assertHasData(page, "audit/plans");
  });

  test("can view observations", async ({ page, baseURL }) => {
    await page.goto("/audit/dashboard");
    await assertPageLoaded(page, "/audit/dashboard");
  });
});

test.describe("Legal Officer persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "legalofficer", baseURL!);
  });

  test("can access the legal hub", async ({ page, baseURL }) => {
    await page.goto("/legal");
    await assertPageLoaded(page, "/legal");
  });

  test("can view legal cases/hearings", async ({ page, baseURL }) => {
    await page.goto("/legal/hearings");
    await assertPageLoaded(page, "/legal/hearings");
  });

  test("can view legal dashboard", async ({ page, baseURL }) => {
    await page.goto("/legal/dashboard");
    await assertPageLoaded(page, "/legal/dashboard");
  });

  test("can access court module", async ({ page, baseURL }) => {
    await page.goto("/court");
    await assertPageLoaded(page, "/court");
  });
});
