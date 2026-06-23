import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Legal', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/legal');
    await expect(page.locator('a[href="/legal/list"]')).toBeVisible();
    await expect(page.locator('a[href="/legal/hearings"]')).toBeVisible();
    await expect(page.locator('a[href="/legal/court-orders"]')).toBeVisible();
    await expect(page.locator('a[href="/legal/opinions"]')).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('legal dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/legal/dashboard');
    await expect(page.getByText(/case/i).first()).toBeVisible();
  });

  // ── Cases list ────────────────────────────────────────────────────────────

  test('legal cases list shows heading and column headers', async ({ page }) => {
    await page.goto('/legal/list');
    await expect(page.getByRole('heading', { name: 'Legal Cases' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Case No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Court' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('legal cases list shows seeded case CASE-001', async ({ page }) => {
    await page.goto('/legal/list');
    await expect(page.getByRole('cell', { name: 'CASE-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'State v. ABC Construction' })).toBeVisible();
  });

  // ── Case detail ───────────────────────────────────────────────────────────

  test('legal case detail shows heading', async ({ page }) => {
    await page.goto('/legal/cases/leg-001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('legal case detail shows case title', async ({ page }) => {
    await page.goto('/legal/cases/leg-001');
    await expect(page.getByText('State v. ABC Construction Ltd')).toBeVisible();
  });

  test('legal case detail breadcrumb links back to cases', async ({ page }) => {
    await page.goto('/legal/cases/leg-001');
    await expect(page.getByRole('link', { name: /cases|legal/i }).first()).toBeVisible();
  });

  test('navigating cases list → detail shows case detail', async ({ page }) => {
    await page.goto('/legal/list');
    await page.getByRole('link', { name: 'CASE-001' }).click();
    await expect(page.getByText('State v. ABC Construction Ltd')).toBeVisible();
  });

  // ── Sub-lists ─────────────────────────────────────────────────────────────

  test('hearings page shows heading and column headers', async ({ page }) => {
    await page.goto('/legal/hearings');
    await expect(page.getByRole('heading', { name: 'Hearings' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Case No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('legal opinions page shows heading and column headers', async ({ page }) => {
    await page.goto('/legal/opinions');
    await expect(page.getByRole('heading', { name: 'Legal Opinions' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
  });

  test('court orders page shows heading', async ({ page }) => {
    await page.goto('/legal/court-orders');
    await expect(page.getByRole('heading', { name: /court order/i })).toBeVisible();
  });
});
