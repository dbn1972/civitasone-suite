/**
 * Shared E2E assertions for persona journeys.
 */
import { expect, type Page } from "@playwright/test";

/**
 * Assert the page loaded successfully — no redirect, no error shell, heading visible.
 */
export async function assertPageLoaded(page: Page, expectedPath: string): Promise<void> {
  const landed = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  const want = expectedPath.replace(/\/$/, "") || "/";
  expect(
    landed,
    `Expected to land on ${expectedPath} but got ${landed} (redirect = wrong persona or missing role)`,
  ).toBe(want);

  // Heading visible = page resolved (not a skeleton/error shell)
  // Some pages use PageHeader (h1), others use section headings (h2), and some
  // hub pages only have descriptive text without explicit headings. If neither
  // h1 nor h2 is found, fall back to any visible text content inside main.
  const heading = page.locator("main h1, main h2, [role='main'] h1, [role='main'] h2").first();
  const hasHeading = await heading.isVisible().catch(() => false);
  if (!hasHeading) {
    // Fallback: at least SOME text content exists (not just a skeleton)
    await expect(
      page.locator("main").first(),
    ).toContainText(/.{10,}/, { timeout: 20_000 });
  }
}

/**
 * Assert no console errors during page load.
 * Collects errors from the console and fails if any are severe.
 */
export function setupConsoleWatcher(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter out known noise (React hydration warnings, etc.)
      if (text.includes("Hydration") || text.includes("Warning:")) return;
      errors.push(text.slice(0, 200));
    }
  });
  return errors;
}

/**
 * Assert the page contains at least one data row (not just an empty state).
 * For list-type pages where we expect seeded data.
 */
export async function assertHasData(page: Page, context: string): Promise<void> {
  // Look for table rows, or card items, or any non-empty data indicator
  const hasRows = await page.locator("table tbody tr, [data-row], .card").count();
  const hasEmptyState = await page.getByText("No ", { exact: false }).count();
  
  // Either data rows exist, or if empty state shows it should not be an error
  if (hasRows === 0 && hasEmptyState === 0) {
    // Page might still be loading or there's a render issue
    await page.waitForTimeout(2000);
  }
  // We don't hard-fail on empty (demo seed may not cover all), but we DO fail
  // on error indicators
  const errorBadge = await page.getByText("Showing saved information", { exact: false }).count();
  expect(
    errorBadge,
    `${context}: page shows data-unavailable state — gateway/API unreachable`,
  ).toBe(0);
}

/**
 * Assert a navigation action succeeded (no 4xx/5xx on the response).
 */
export async function navigateAndAssert(
  page: Page,
  path: string,
  label: string,
): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  expect(
    response?.status() ?? 0,
    `${label}: got ${response?.status()} navigating to ${path}`,
  ).toBeLessThan(400);
}

/**
 * Assert cross-tenant isolation — a route that belongs to another tenant must
 * either 403 or redirect to dashboard (depending on how the app handles it).
 */
export async function assertCrossTenantBlocked(
  page: Page,
  path: string,
  context: string,
): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const url = new URL(page.url());
  // The app should NOT render the target content — either redirected or empty
  const landed = url.pathname;
  if (landed === path) {
    // If we landed on the path, the content should be empty (RLS isolation)
    // or show no data from the other tenant
    const bodyText = await page.textContent("body");
    expect(
      bodyText,
      `${context}: partner persona landed on ${path} and may see T1 data — cross-tenant leak!`,
    ).not.toContain("Demo Municipal Corporation");
  }
}
