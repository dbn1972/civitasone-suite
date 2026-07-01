import { test, expect } from '@playwright/test';
import { loginAsAdmin, goAsAdmin } from './helpers/auth';

test.describe('Smoke Tests — App Loads', () => {
  test('app loads without crash (root redirects or renders)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/auth/login');
    // Should show the Keycloak sign-in link or CivitasOne branding
    await expect(
      page.getByRole('link', { name: /sign in/i }).or(page.getByText('CivitasOne')),
    ).toBeVisible();
  });

  test('after login, dashboard loads', async ({ page }) => {
    await goAsAdmin(page, '/dashboard');
    // Dashboard page header should be visible
    await expect(page.getByRole('heading', { name: /command center|dashboard/i })).toBeVisible();
  });

  test('sidebar renders with navigation items', async ({ page }) => {
    await goAsAdmin(page, '/dashboard');
    // Sidebar should contain module navigation links
    const sidebar = page.locator('nav[aria-label="Sidebar"], aside, [data-testid="sidebar"]');
    await expect(sidebar.first()).toBeVisible();

    // At least some core module links should exist
    const financeLink = page.getByRole('link', { name: /finance/i }).first();
    const hrLink = page.getByRole('link', { name: /hr|human resource/i }).first();
    await expect(financeLink.or(hrLink)).toBeVisible();
  });
});
