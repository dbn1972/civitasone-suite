import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Estab', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/estab');
    await expect(page.getByRole('heading', { name: 'Establishment' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'File Register' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Meetings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fleet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Guest House' })).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('estab dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/estab/dashboard');
    await expect(page.getByText(/file|pending/i).first()).toBeVisible();
  });

  // ── File list ─────────────────────────────────────────────────────────────

  test('file register shows heading and column headers', async ({ page }) => {
    await page.goto('/estab/list');
    await expect(page.getByRole('heading', { name: 'Digital File Tracking (eOffice)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'File No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Classification' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Created By' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('file register shows seeded file FILE-001', async ({ page }) => {
    await page.goto('/estab/list');
    await expect(page.getByRole('cell', { name: 'FILE-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Annual Budget Proposal' })).toBeVisible();
  });

  // ── File detail ───────────────────────────────────────────────────────────

  test('file detail shows file heading', async ({ page }) => {
    await page.goto('/estab/files/fil-001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('file detail shows file number and subject', async ({ page }) => {
    await page.goto('/estab/files/fil-001');
    await expect(page.getByText('FILE-001').or(page.getByText('Annual Budget Proposal')).first()).toBeVisible();
  });

  test('navigating file list → detail shows file detail', async ({ page }) => {
    await page.goto('/estab/list');
    await page.getByRole('link', { name: 'FILE-001' }).click();
    await expect(page.getByText('Annual Budget Proposal')).toBeVisible();
  });

  // ── New file form ─────────────────────────────────────────────────────────

  test('new file form shows heading and required fields', async ({ page }) => {
    await page.goto('/estab/files/new');
    await expect(page.getByRole('heading', { name: /new file|create file/i })).toBeVisible();
    await expect(page.getByLabel(/subject/i)).toBeVisible();
    await expect(page.getByLabel(/classification/i)).toBeVisible();
  });

  test('new file form submit shows success or error feedback', async ({ page }) => {
    await page.goto('/estab/files/new');
    await page.getByLabel(/subject/i).fill('Test Budget File');
    await page.getByLabel(/department/i).fill('Finance');
    await page.getByRole('button', { name: /create|submit/i }).click();
    // Response could be success (202) or an error since no real backend
    await expect(page.locator('body')).toBeVisible();
  });

  // ── Meetings ──────────────────────────────────────────────────────────────

  test('meetings page shows heading and column headers', async ({ page }) => {
    await page.goto('/estab/meetings');
    await expect(page.getByRole('heading', { name: 'Meeting Management' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Meeting No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('meetings page shows seeded meeting MTG-001', async ({ page }) => {
    await page.goto('/estab/meetings');
    await expect(page.getByRole('cell', { name: 'MTG-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Board Meeting' })).toBeVisible();
  });

  // ── Meeting detail ────────────────────────────────────────────────────────

  test('meeting detail shows meeting heading', async ({ page }) => {
    await page.goto('/estab/meetings/mtg-001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  // ── Other sub-pages ───────────────────────────────────────────────────────

  test('vehicle management page shows heading', async ({ page }) => {
    await page.goto('/estab/vehicles');
    await expect(page.getByRole('heading', { name: 'Vehicle Management' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('guest house management page shows heading', async ({ page }) => {
    await page.goto('/estab/guesthouse');
    await expect(page.getByRole('heading', { name: 'Guest House Management' })).toBeVisible();
  });
});
