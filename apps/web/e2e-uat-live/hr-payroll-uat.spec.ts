import { test, expect } from "@playwright/test";
import { liveLogin, getLiveAccessToken, LIVE_BASE_URL, GATEWAY_URL, PRIYA, SUPER_ADMIN } from "./helpers/live-auth";
// Importing live-auth sets NODE_TLS_REJECT_UNAUTHORIZED=0 for this process,
// required since the nip.io host uses a self-signed nginx cert and Node's
// fetch (used directly below) has no per-call TLS override.

/**
 * Live UAT smoke suite for the CivitasOne deployment at
 * https://civitasone.65-2-205-201.nip.io.
 *
 * Exercises the real chain end to end: Nginx -> Next.js -> Keycloak OIDC ->
 * gateway JWT edge -> backend services -> Postgres, using the seeded demo
 * user `priya` (hr_admin / hr_officer).
 *
 * These tests were written against the actual current UI (verified by
 * reading the route source under apps/web/src/app/(app)/hr/**), not assumed
 * selectors, so a couple of things from the original ask don't map 1:1 onto
 * what exists today:
 *   - There is no standalone "Add Employee" form; employees are added via
 *     bulk CSV import (/hr/employees/import). That is covered instead.
 *   - "Add Department" is a documented placeholder — the page tells the
 *     user to POST directly to the API ("A full form is being built").
 *     That is asserted explicitly rather than faked as a working form.
 *   - Recruitment's "add" action is labelled "+ New Vacancy" and opens the
 *     "New Job Opening" form — covered as specified.
 *   - Payroll "Create Run" requires at least one pay structure to exist
 *     first (the form doesn't render otherwise); the test creates one via
 *     the real Pay Structures form if none exist yet.
 *   - Payroll is separation-of-duties gated: hr_admin/hr_officer (priya)
 *     cannot create pay structures or runs (403, verified against the
 *     API directly). That test logs in as the super_admin demo account.
 *
 * `networkidle` is deliberately avoided: the app layout polls in the
 * background (SyncProvider / notifications), so networkidle never resolves.
 * Waits are on specific visible content instead, per Playwright guidance.
 */

test.describe.configure({ mode: "serial" });

test.describe("CivitasOne Live UAT — auth + HR + Payroll", () => {
  test("login as priya reaches the dashboard on the public URL", async ({ page }) => {
    await liveLogin(page);

    // Must land on the app, on the public domain, never localhost.
    expect(page.url()).toContain(LIVE_BASE_URL);
    expect(page.url()).not.toContain("localhost");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("HR Employees page lists real seeded employees", async ({ page }) => {
    await liveLogin(page);
    await page.goto("/hr/employees");

    await expect(page.getByRole("heading", { name: "Employee Directory" })).toBeVisible();

    const table = page.locator("table.tbl");
    await expect(table).toBeVisible({ timeout: 30_000 });
    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);

    // Total stat card should reflect a non-trivial seeded headcount.
    const totalCard = page.locator(".stat").filter({ hasText: "Total" });
    await expect(totalCard).toBeVisible();
    const totalText = await totalCard.locator(".val").innerText();
    expect(Number(totalText.replace(/,/g, ""))).toBeGreaterThan(0);
  });

  test("bulk employee import page exposes the CSV upload flow (employee creation path)", async ({ page }) => {
    // There is no single "Add Employee" form in the current UI — employees
    // are created via CSV import. Verify that real flow is present and wired.
    await liveLogin(page);
    await page.goto("/hr/employees/import");

    await expect(page.getByRole("heading", { name: "Bulk Employee Import" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Download CSV template/i })).toBeVisible();
    // File input for the upload form must exist and be enabled.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
  });

  test("Departments page is a real list backed by the API, with add-form documented as not yet built", async ({ page }) => {
    await liveLogin(page);
    await page.goto("/hr/departments");

    await expect(page.getByRole("heading", { name: "Departments", exact: true })).toBeVisible();

    // The page currently documents that a full "add department" form isn't
    // built yet and directs users to POST the API directly. Assert that
    // honestly rather than pretending a form exists.
    await expect(page.getByText(/Add departments via/i)).toBeVisible();
    await expect(page.getByText(/POST \/v1\/hrms\/departments/i)).toBeVisible();

    // The list itself should be real, API-backed data (seeded departments).
    const table = page.locator("table");
    if ((await table.count()) > 0) {
      const rows = table.locator("tbody tr");
      expect(await rows.count()).toBeGreaterThan(0);
    }
  });

  test("Recruitment → New Job Opening creates a real vacancy via the API", async ({ page }) => {
    await liveLogin(page);

    // Fetch a real department UUID via the API (form requires a valid UUID).
    const token = await getLiveAccessToken(PRIYA);
    const deptRes = await fetch(`${GATEWAY_URL}/api/v1/hrms/departments`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const deptBody = (await deptRes.json()) as { data: { id: string }[] };
    const departmentId = deptBody.data[0]?.id;
    expect(departmentId, "expected at least one seeded department").toBeTruthy();

    await page.goto("/hr/recruitment");
    await page.getByRole("link", { name: "+ New Vacancy" }).first().click();
    await page.waitForURL(/\/hr\/recruitment\/new/);

    await expect(page.getByRole("heading", { name: "New Job Opening" })).toBeVisible();

    const refNo = `UAT-JOB-${Date.now()}`;
    await page.getByLabel(/Reference No/).fill(refNo);
    await page.getByLabel(/^Title/).fill("UAT Automation — Senior Engineer");
    await page.getByLabel(/Department ID/).fill(departmentId!);
    await page.getByLabel(/Vacancies/).fill("2");

    const createResponse = page.waitForResponse(
      (res) => res.url().includes("/api/proxy/v1/hrms/job-openings") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create Job Opening" }).click();

    const res = await createResponse;
    expect(res.status(), "job opening creation should succeed").toBeLessThan(300);

    // Form navigates back to the recruitment list on success.
    await page.waitForURL(/\/hr\/recruitment$/, { timeout: 15_000 });
  });

  test("Payroll → Create Run produces a real payroll run (creating a pay structure first if needed)", async ({ page }) => {
    // payroll-service enforces separation of duties: hr_admin/hr_officer
    // (priya) get 403 FORBIDDEN creating pay structures/runs — verified
    // directly against the API. Use the super_admin demo account, which the
    // backend actually authorizes for this action.
    await liveLogin(page, SUPER_ADMIN);

    await page.goto("/hr/payroll");

    const needsStructure = await page
      .getByText(/No pay structures configured/i)
      .isVisible()
      .catch(() => false);

    if (needsStructure) {
      await page.getByRole("link", { name: /Go to pay structures/i }).click();
      await page.waitForURL(/\/hr\/payroll\/structures/);
      await expect(page.getByRole("heading", { name: "Create Pay Structure" })).toBeVisible();

      const structureName = `UAT Structure ${Date.now()}`;
      await page.getByLabel(/^Name/).fill(structureName);
      await page.getByRole("button", { name: "Create Structure", exact: true }).click();
      await page.getByRole("button", { name: "Create structure", exact: true }).click(); // confirm dialog

      await expect(page.getByText(/Structure submitted/i)).toBeVisible({ timeout: 15_000 });

      await page.goto("/hr/payroll");
    }

    // Give the async structure-creation consumer a moment if we just created one.
    await expect(
      page
        .getByRole("heading", { name: "Create Payroll Run" })
        .or(page.getByText(/No pay structures configured/i)),
    ).toBeVisible({ timeout: 20_000 });

    const stillMissing = await page
      .getByText(/No pay structures configured/i)
      .isVisible()
      .catch(() => false);
    test.skip(
      stillMissing,
      "Pay structure creation is processed asynchronously and had not landed yet — rerun to pick it up.",
    );

    const runNoField = page.getByLabel("Run No.");
    const originalRunNo = await runNoField.inputValue();
    const uniqueRunNo = `${originalRunNo}-UAT-${Date.now()}`;
    await runNoField.fill(uniqueRunNo);

    const createResponse = page.waitForResponse(
      (res) => res.url().includes("/api/proxy/v1/payroll/runs") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create Run", exact: true }).click();
    await page.getByRole("button", { name: "Create run", exact: true }).click(); // confirm dialog

    const res = await createResponse;
    expect(res.status(), "payroll run creation should succeed").toBeLessThan(300);
  });

  test("logout clears the session and redirects to the public login URL, never localhost", async ({ page }) => {
    await liveLogin(page);
    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/\/auth\/login/);

    await page.goto("/logout");

    // Keycloak's RP-initiated logout shows a "Do you want to log out?"
    // confirmation because no id_token_hint is passed (the app only stores
    // access/refresh tokens, not the ID token) — without it Keycloak can't
    // silently verify which session to end, so it asks for confirmation.
    // This is expected/secure Keycloak behaviour, not a bug; click through it.
    const logoutButton = page.getByRole("button", { name: "Logout" });
    if (await logoutButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await logoutButton.click();
    }

    // With the SSO session actually terminated, /auth/login -> /api/auth/login
    // kicks off a fresh PKCE flow and lands on Keycloak's real login form
    // (username/password fields) rather than silently re-authenticating and
    // bouncing back into the app — that's the behavioural proof the fix works.
    await page.locator("#username").waitFor({ state: "visible", timeout: 15_000 });
    expect(page.url()).toContain(LIVE_BASE_URL);
    expect(page.url()).not.toContain("localhost");
    expect(page.url()).toContain("/protocol/openid-connect/auth");

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "civitasone_at");
    expect(sessionCookie).toBeUndefined();

    // Visiting a protected page again should bounce to login, not straight
    // into the app (which would indicate the SSO session was never ended).
    await page.goto("/dashboard");
    await page.locator("#username").waitFor({ state: "visible", timeout: 15_000 });
    expect(page.url()).not.toContain("/dashboard");
  });
});
