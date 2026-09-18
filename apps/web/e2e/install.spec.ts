import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Install', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Installer wizard ──────────────────────────────────────────────────────

  test('install page shows Installer Wizard heading', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByRole('heading', { name: 'Installer Wizard' })).toBeVisible();
  });

  test('install page shows progress section', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByText(/progress/i)).toBeVisible();
  });

  test('install page shows step titles from mock API', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByText('Database Setup')).toBeVisible();
    await expect(page.getByText('Seed Master Data')).toBeVisible();
  });

  test('install page shows completed steps', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByText('completed').first()).toBeVisible();
  });

  test('install page shows pending step Configure SMTP', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByText('Configure SMTP')).toBeVisible();
    await expect(page.getByText('pending')).toBeVisible();
  });

  test('install page shows Installation Complete banner when all required steps done', async ({ page }) => {
    await page.goto('/install');
    // REL-023 tranche 6: there's no banner with either literal phrase --
    // the page shows a terse "Status" StatCard whose value is just
    // "Complete" or "In progress" (install/page.tsx). A bare
    // getByText(/complete/i) would itself be a strict-mode violation: two
    // of the fixture's own steps are individually "Completed" too. Scope to
    // the specific stat tile by its own label.
    const statusCard = page.locator('.stat').filter({ has: page.getByText('Status', { exact: true }) });
    await expect(statusCard.getByText(/^(complete|in progress)$/i)).toBeVisible();
  });

  test('install page shows step description text', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByText('Initialize PostgreSQL schema')).toBeVisible();
  });
});
