/**
 * Persona E2E: Super Admin + Commissioner + Partner Officer (cross-tenant)
 *
 * Tests:
 * - Super admin: can access everything
 * - Commissioner: tenant-level admin
 * - Partner officer (Tenant 2): CANNOT see Tenant 1 data (cross-tenant isolation)
 */
import { test, expect } from "@playwright/test";
import { loginAs, apiToken, PERSONAS } from "./helpers/auth.js";
import { assertPageLoaded, assertCrossTenantBlocked } from "./helpers/assertions.js";

test.describe("Super Admin persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "superadmin", baseURL!);
  });

  test("can access the main dashboard", async ({ page, baseURL }) => {
    await page.goto("/dashboard");
    await assertPageLoaded(page, "/dashboard");
  });

  test("can access admin panel", async ({ page, baseURL }) => {
    await page.goto("/admin");
    await assertPageLoaded(page, "/admin");
  });

  test("can access tenant admin", async ({ page, baseURL }) => {
    await page.goto("/tenant-admin");
    await assertPageLoaded(page, "/tenant-admin");
  });

  test("can access all module hubs", async ({ page, baseURL }) => {
    const hubs = [
      "/finance", "/hr", "/procurement", "/audit", "/legal",
      "/analytics", "/workflow", "/citizen",
    ];
    for (const hub of hubs) {
      await page.goto(hub);
      await assertPageLoaded(page, hub);
    }
  });
});

test.describe("Commissioner persona journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "commissioner", baseURL!);
  });

  test("can access the dashboard", async ({ page, baseURL }) => {
    await page.goto("/dashboard");
    await assertPageLoaded(page, "/dashboard");
  });

  test("can access tenant-admin (has tenant_admin role)", async ({ page, baseURL }) => {
    await page.goto("/tenant-admin");
    await assertPageLoaded(page, "/tenant-admin");
  });
});

test.describe("Partner Officer (Tenant 2) — cross-tenant isolation", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAs(page, "partnerofficer", baseURL!);
  });

  test("can access their own dashboard", async ({ page, baseURL }) => {
    await page.goto("/dashboard");
    await assertPageLoaded(page, "/dashboard");
  });

  test("CANNOT see Tenant 1 data via the web UI", async ({ page, baseURL }) => {
    // Partner officer is in Tenant 2, so navigating to shared modules
    // should show ONLY Tenant 2 data (or empty), never Tenant 1 data.
    await assertCrossTenantBlocked(page, "/citizen/grievances", "cross-tenant citizen");
  });

  test("API-level cross-tenant isolation (RLS)", async ({ request }) => {
    // Direct API call as partnerofficer (Tenant 2) — should NOT return
    // Tenant 1's seeded grievances
    const token = apiToken("partnerofficer");
    const resp = await request.get("http://localhost:8080/api/v1/citizen/grievances", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-id": PERSONAS.partnerofficer.tenant,
      },
    });
    expect(resp.status()).toBeLessThan(400);
    const body = await resp.json();
    const items = Array.isArray(body) ? body : body.data ?? [];
    // Tenant 1's seeded grievance IDs start with 33333333
    const t1Items = items.filter((g: any) =>
      g.id?.startsWith("33333333") || g.tenantId === "00000000-0000-0000-0000-000000000001",
    );
    expect(
      t1Items.length,
      "Partner officer (Tenant 2) should NEVER see Tenant 1 grievances — RLS violation!",
    ).toBe(0);
  });
});
