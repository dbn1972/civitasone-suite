import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Finance', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('finance dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/finance/dashboard');
    await expect(page.getByText(/budget|expenditure|payment/i).first()).toBeVisible();
  });

  // ── Chart of accounts ─────────────────────────────────────────────────────

  test('chart of accounts shows table column headers', async ({ page }) => {
    await page.goto('/finance/chart-of-accounts');
    await expect(page.getByRole('heading', { name: 'Chart of Accounts' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  });

  test('chart of accounts lists accounts from mock API', async ({ page }) => {
    await page.goto('/finance/chart-of-accounts');
    await expect(page.getByRole('cell', { name: '1001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Cash' })).toBeVisible();
  });

  // ── Payments list ─────────────────────────────────────────────────────────

  test('payments list shows table column headers', async ({ page }) => {
    await page.goto('/finance/payments');
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Reference' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Beneficiary' })).toBeVisible();
  });

  test('payments list shows payment reference and status', async ({ page }) => {
    await page.goto('/finance/payments');
    await expect(page.getByRole('cell', { name: 'PAY-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Queued' })).toBeVisible();
  });

  // ── Voucher form ──────────────────────────────────────────────────────────

  test('journal entry page renders heading', async ({ page }) => {
    await page.goto('/finance/journal-entry');
    await expect(page.getByRole('heading', { name: /journal entry/i })).toBeVisible();
  });

  test('new voucher form shows required fields', async ({ page }) => {
    await page.goto('/finance/accounting/vouchers/new');
    await expect(page.getByRole('heading', { name: /voucher/i })).toBeVisible();
    await expect(page.getByLabel(/date/i)).toBeVisible();
    await expect(page.getByLabel(/narration/i)).toBeVisible();
  });

  test('new voucher form validates debit/credit balance', async ({ page }) => {
    await page.goto('/finance/accounting/vouchers/new');
    await page.getByRole('button', { name: /submit|post/i }).click();
    await expect(page.getByText(/required|balance|error/i).first()).toBeVisible();
  });

  // ── Budget ────────────────────────────────────────────────────────────────

  test('budget formulation page loads without error', async ({ page }) => {
    await page.goto('/finance/budget/formulation');
    await expect(page.getByRole('heading', { name: /budget/i })).toBeVisible();
  });

  test('budget sanctions page loads without error', async ({ page }) => {
    await page.goto('/finance/budget/sanctions');
    await expect(page.getByRole('heading', { name: /sanction/i })).toBeVisible();
  });

  // ── Expenditure ───────────────────────────────────────────────────────────

  test('expenditure bills page loads without error', async ({ page }) => {
    await page.goto('/finance/expenditure/bills');
    await expect(page.getByRole('heading', { name: /bill/i })).toBeVisible();
  });

  test('advances page loads without error', async ({ page }) => {
    await page.goto('/finance/expenditure/advances');
    await expect(page.getByRole('heading', { name: /advance/i })).toBeVisible();
  });

  // ── General ledger ────────────────────────────────────────────────────────

  test('general ledger page loads without error', async ({ page }) => {
    await page.goto('/finance/accounting/general-ledger');
    await expect(page.getByRole('heading', { name: /general ledger/i })).toBeVisible();
  });
});
