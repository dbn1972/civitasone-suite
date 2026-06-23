import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Audit', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Event log (legacy /audit route) ──────────────────────────────────────

  test('audit log shows the Event Log section', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByText('Event Log')).toBeVisible();
  });

  test('audit log shows actor and action column headers', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Outcome' })).toBeVisible();
  });

  test('audit log shows row from mock API', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('cell', { name: 'admin@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'user.login' })).toBeVisible();
  });

  test('audit row renders outcome badge', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByText('success')).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('audit dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/audit/dashboard');
    await expect(page.getByText(/observation/i)).toBeVisible();
  });

  // ── Observations list ─────────────────────────────────────────────────────

  test('audit observations list shows heading and column headers', async ({ page }) => {
    await page.goto('/audit/observations');
    await expect(page.getByRole('heading', { name: /observation/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Obs No/i }).or(page.getByRole('columnheader', { name: /No/i })).first()).toBeVisible();
  });

  test('audit observations list shows seeded observation', async ({ page }) => {
    await page.goto('/audit/observations');
    await expect(page.getByText('OBS-001').or(page.getByText('Weak access controls')).first()).toBeVisible();
  });

  // ── Observation detail ────────────────────────────────────────────────────

  test('audit observation detail shows heading', async ({ page }) => {
    await page.goto('/audit/observations/a0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('heading', { name: /observation/i })).toBeVisible();
  });

  test('audit observation detail shows breadcrumb', async ({ page }) => {
    await page.goto('/audit/observations/a0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('link', { name: /observation/i })).toBeVisible();
  });

  // ── Other sub-pages ───────────────────────────────────────────────────────

  test('risk register page shows heading', async ({ page }) => {
    await page.goto('/audit/risk-register');
    await expect(page.getByRole('heading', { name: /risk/i })).toBeVisible();
  });

  test('audit plan page shows heading', async ({ page }) => {
    await page.goto('/audit/plan');
    await expect(page.getByRole('heading', { name: /plan/i })).toBeVisible();
  });

  test('compliance page shows heading', async ({ page }) => {
    await page.goto('/audit/compliance');
    await expect(page.getByRole('heading', { name: /compliance/i })).toBeVisible();
  });
});
