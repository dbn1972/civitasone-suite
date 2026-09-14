import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Audit', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Event log (legacy /audit route) ──────────────────────────────────────

  test('audit log shows the Event Log section', async ({ page }) => {
    await page.goto('/audit');
    // Exact match: "Event Log" (breadcrumb) is also a substring of the
    // "Audit event log" card heading, which would otherwise resolve to 2 elements.
    await expect(page.getByText('Event Log', { exact: true })).toBeVisible();
  });

  test('audit log shows actor and action column headers', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    // Column was relabeled from "Outcome" to "Result".
    await expect(page.getByRole('columnheader', { name: 'Result' })).toBeVisible();
  });

  test('audit log shows row from mock API', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('cell', { name: 'admin@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'user.login' })).toBeVisible();
  });

  test('audit row renders outcome badge', async ({ page }) => {
    await page.goto('/audit');
    // Exact match: the "Success" KPI stat-card label is also a case-insensitive
    // substring match for "success", which would otherwise resolve to 2 elements.
    await expect(page.getByText('success', { exact: true })).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('audit dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/audit/dashboard');
    // Several elements legitimately match /observation/i (subtitle, KPI label,
    // quick-link) — any one of them proves the dashboard rendered.
    await expect(page.getByText(/observation/i).first()).toBeVisible();
  });

  // ── Observations list ─────────────────────────────────────────────────────

  test('audit observations list shows heading and column headers', async ({ page }) => {
    await page.goto('/audit/observations');
    // level: 1 targets the page's <h1> specifically — the "Audit observations"
    // card also has an <h3> that matches the same case-insensitive regex.
    await expect(page.getByRole('heading', { name: /observation/i, level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Obs' })).toBeVisible();
  });

  test('audit observations list shows seeded observation', async ({ page }) => {
    await page.goto('/audit/observations');
    await expect(page.getByText('OBS-001').or(page.getByText('Weak access controls')).first()).toBeVisible();
  });

  // ── Observation detail ────────────────────────────────────────────────────

  test('audit observation detail shows heading', async ({ page }) => {
    await page.goto('/audit/observations/a0000000-0000-0000-0000-000000000001');
    // Detail heading is "<Obs No> · <Department>" (e.g. "OBS-001 · —"), not the
    // word "observation" — match the observation-number pattern instead.
    await expect(page.getByRole('heading', { name: /OBS-/i, level: 1 })).toBeVisible();
  });

  test('audit observation detail shows breadcrumb', async ({ page }) => {
    await page.goto('/audit/observations/a0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('link', { name: /observation/i })).toBeVisible();
  });

  // ── Other sub-pages ───────────────────────────────────────────────────────

  test('risk register page shows heading', async ({ page }) => {
    await page.goto('/audit/risk-register');
    // level: 1 — the "Risk register" table card also has an <h3> matching /risk/i.
    await expect(page.getByRole('heading', { name: /risk/i, level: 1 })).toBeVisible();
  });

  test('audit plan page shows heading', async ({ page }) => {
    await page.goto('/audit/plan');
    // level: 1 — the "Audit plan" table card also has an <h3> matching /plan/i.
    await expect(page.getByRole('heading', { name: /plan/i, level: 1 })).toBeVisible();
  });

  test('compliance page shows heading', async ({ page }) => {
    await page.goto('/audit/compliance');
    // level: 1 — the "Compliance requirements" card also has an <h3> matching /compliance/i.
    await expect(page.getByRole('heading', { name: /compliance/i, level: 1 })).toBeVisible();
  });
});
