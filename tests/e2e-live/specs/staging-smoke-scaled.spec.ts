import { test, expect } from "@playwright/test";

/**
 * Task 40 (Req: all) — staging full-data smoke run sign-off, SCALED DOWN per
 * explicit user instruction.
 *
 * The task as written calls for seeding >=500 estab files, >=1000 inventory
 * items and >=200 procurement POs directly into the shared staging
 * environment (civitasone.65-2-205-201.nip.io) and running the full
 * tests/e2e-live/ suite against it. Two blockers made that infeasible as
 * literally specified, both confirmed by inspection rather than assumed:
 *
 *   1. No seed script capable of that scale exists (`pnpm seed:uat`,
 *      referenced by the uat-playbook steering doc, is not a real script in
 *      package.json).
 *   2. The rest of tests/e2e-live/ authenticates via an injected HS256
 *      `access_token` cookie (helpers/auth.ts's injectAuthCookie) — that
 *      only works against the LOCAL dev stack, which accepts
 *      JWT_ALGORITHM=HS256. Production/staging's gateway verifies real
 *      Keycloak-issued RS256 tokens (confirmed via every service's
 *      .env.example: `JWT_ALGORITHM=RS256` in prod, HS256 only for local
 *      test override) — an injected HS256 cookie is simply rejected there.
 *      A real login has to go through Keycloak's actual hosted login page.
 *
 * User explicitly authorized scaling DOWN rather than skipping: this spec
 * creates a SMALL, clearly-labeled dataset (5 estab files, 5 inventory
 * items, 3 procurement POs — enough to smoke-test each module's write path
 * and list rendering without bulk-polluting a shared environment other
 * agents/users are actively using for UAT) and drives a REAL browser through
 * the Keycloak login page with the documented Super Admin demo account,
 * rather than any auth bypass.
 *
 * Every created record's identifying field is prefixed `E2E-SMOKE-` so it is
 * trivially distinguishable from genuine UAT data and safe to bulk-delete
 * later if needed.
 */

const STAGING_BASE = "https://civitasone.65-2-205-201.nip.io";
const SUPERADMIN = { username: "admin@civitasone.dev", password: "CivitasOne#2026!" };

const SMOKE_TAG = `E2E-SMOKE-${Date.now()}`;

async function loginViaKeycloak(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`${STAGING_BASE}/auth/login`);
  // The app immediately 302s to /api/auth/login -> Keycloak's own hosted
  // authorize endpoint. Wait for the real Keycloak login form to render.
  await page.waitForURL(/\/auth\/realms\/civitasone\/protocol\/openid-connect\/auth/, { timeout: 20_000 });

  const usernameField = page.getByRole("textbox", { name: "Username or email" });
  const passwordField = page.getByRole("textbox", { name: "Password" });
  await expect(usernameField).toBeVisible({ timeout: 15_000 });
  await usernameField.fill(SUPERADMIN.username);
  await passwordField.fill(SUPERADMIN.password);
  await page.getByRole("button", { name: "Sign In" }).click();

  // Keycloak is served on the SAME domain as the app (path-based routing via
  // nginx, not a subdomain — confirmed via the OIDC discovery doc's issuer
  // URL), so a hostname-change check resolves immediately without actually
  // waiting for the redirect. Wait for the URL path to leave the Keycloak
  // realm path instead — that only happens once /api/auth/callback has
  // exchanged the code and redirected back into the app.
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/realms/"), { timeout: 20_000 });
}

test.describe("Staging smoke run — scaled dataset (Req: all, task 40)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaKeycloak(page);
  });

  test("create 5 estab files, verify list renders them", async ({ page }) => {
    for (let i = 1; i <= 5; i++) {
      await page.goto(`${STAGING_BASE}/estab/files/new`);
      await page.waitForLoadState("networkidle");

      const subjectField = page.getByLabel(/Subject/i).first();
      await expect(subjectField).toBeVisible({ timeout: 15_000 });
      await subjectField.fill(`${SMOKE_TAG} File ${i}`);

      const departmentField = page.getByLabel(/Department/i).first();
      if (await departmentField.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await departmentField.fill("Administration");
      }

      const submitButton = page.getByRole("button", { name: /Create|Submit|Save/i }).first();
      await submitButton.click();
      await page.waitForLoadState("networkidle");
    }

    await page.goto(`${STAGING_BASE}/estab/list`);
    await page.waitForLoadState("networkidle");
    const filterBox = page.getByPlaceholder(/Filter/i).first();
    if (await filterBox.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filterBox.fill(SMOKE_TAG);
    }
    await expect(page.getByText(new RegExp(`${SMOKE_TAG} File`))).toBeVisible({ timeout: 15_000 });
  });

  test("create 5 inventory items, verify item master renders them", async ({ page }) => {
    for (let i = 1; i <= 5; i++) {
      const createResponse = await page.request.post(`${STAGING_BASE}/api/proxy/v1/inventory/items`, {
        data: {
          name: `${SMOKE_TAG} Item ${i}`,
          sku: `${SMOKE_TAG}-SKU-${i}`,
          itemType: "consumable",
          reorderLevel: 10,
          reorderQty: 50,
          unitCostMinor: "10000",
        },
      });
      expect(createResponse.ok()).toBeTruthy();
    }

    await page.goto(`${STAGING_BASE}/inventory/items`);
    await page.waitForLoadState("networkidle");
    const filterBox = page.getByPlaceholder(/Filter/i).first();
    if (await filterBox.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filterBox.fill(SMOKE_TAG);
    }
    await expect(page.getByText(new RegExp(`${SMOKE_TAG} Item`))).toBeVisible({ timeout: 15_000 });
  });

  test("create 3 procurement POs, verify orders list renders them", async ({ page }) => {
    const vendorsResponse = await page.request.get(`${STAGING_BASE}/api/proxy/v1/procurement/vendors?limit=1`);
    expect(vendorsResponse.ok()).toBeTruthy();
    const vendorsBody = (await vendorsResponse.json()) as { data?: Array<{ id: string }> } | Array<{ id: string }>;
    const vendors = Array.isArray(vendorsBody) ? vendorsBody : (vendorsBody.data ?? []);
    test.skip(vendors.length === 0, "No vendors seeded on staging to attach a smoke-test PO to.");
    const vendorId = vendors[0].id;

    const indentsResponse = await page.request.post(`${STAGING_BASE}/api/proxy/v1/procurement/indents`, {
      data: {
        indentNo: `${SMOKE_TAG}-IND`,
        department: "Administration",
        indentDate: new Date().toISOString().slice(0, 10),
        items: [{ itemCode: `${SMOKE_TAG}-ITEM`, description: `${SMOKE_TAG} smoke item`, quantity: 1, unit: "nos", unitPriceMinor: 10000 }],
      },
    });
    expect(indentsResponse.ok()).toBeTruthy();

    const indentsListResponse = await page.request.get(`${STAGING_BASE}/api/proxy/v1/procurement/indents?limit=50`);
    const indentsBody = (await indentsListResponse.json()) as { data?: Array<{ id: string; indentNo?: string }> } | Array<{ id: string; indentNo?: string }>;
    const indents = Array.isArray(indentsBody) ? indentsBody : (indentsBody.data ?? []);
    const ourIndent = indents.find((i) => i.indentNo === `${SMOKE_TAG}-IND`);
    expect(ourIndent).toBeTruthy();

    for (let i = 1; i <= 3; i++) {
      const poResponse = await page.request.post(`${STAGING_BASE}/api/proxy/v1/procurement/pos`, {
        data: {
          poNo: `${SMOKE_TAG}-PO-${i}`,
          vendorId,
          indentRef: `procurement_indent:${ourIndent!.id}`,
          items: [{ itemCode: `${SMOKE_TAG}-ITEM`, description: `${SMOKE_TAG} smoke item`, quantity: 1, unit: "nos", unitPriceMinor: 10000 }],
        },
      });
      expect(poResponse.ok()).toBeTruthy();
    }

    await page.goto(`${STAGING_BASE}/procurement/orders`);
    await page.waitForLoadState("networkidle");
    const filterBox = page.getByPlaceholder(/Filter/i).first();
    if (await filterBox.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filterBox.fill(SMOKE_TAG);
    }
    await expect(page.getByText(new RegExp(`${SMOKE_TAG}-PO`))).toBeVisible({ timeout: 15_000 });
  });
});
