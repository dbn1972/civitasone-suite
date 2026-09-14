import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
    // The dashboard renders a first-run onboarding tour (FirstRunTour.tsx) as a
    // centred modal dialog whenever civitasone.tour.dashboard.v1 isn't set in
    // localStorage -- true for every fresh E2E context. The dialog covers the
    // whole viewport (position: fixed, inset: 0) and intercepts pointer events,
    // so it blocks clicks on the module tiles beneath it. Seed the "already
    // seen" flag before any page script runs so the tour never mounts.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('civitasone.tour.dashboard.v1', new Date().toISOString());
      } catch {
        /* localStorage unavailable -- tour would no-op anyway */
      }
    });
    await page.goto('/dashboard');
  });

  test('shows module navigation tiles', async ({ page }) => {
    // Tiles are <Link aria-label={label}> wrapping a stat card; the label is the
    // accessible name of the link. Sidebar nav also has module links so we use
    // first() to avoid strict-mode conflicts when both match.
    await expect(page.getByRole('link', { name: 'Finance' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'HR & Payroll' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Procurement' }).first()).toBeVisible();
  });

  test('clicking Finance tile navigates to /finance', async ({ page }) => {
    // The dashboard nav renders links with aria-label matching the module label.
    // Use the one inside the modules nav (aria-label from i18n key
    // home.yourModules -> "Your modules") to avoid the sidebar's own Finance link.
    await page.locator('[aria-label="Your modules"]').getByRole('link', { name: 'Finance' }).click();
    await expect(page).toHaveURL(/\/finance/);
  });

  test('clicking Tenant Admin tile navigates to /tenant-admin', async ({ page }) => {
    await page.locator('[aria-label="Your modules"]').getByRole('link', { name: 'Tenant Admin' }).click();
    await expect(page).toHaveURL(/\/tenant-admin/);
  });
});
