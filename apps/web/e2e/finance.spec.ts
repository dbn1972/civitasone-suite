import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Finance', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('finance dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/finance/dashboard');
    await expect(page.getByText(/budget|expenditure|payment/i).first()).toBeVisible();
  });

  // ── Chart of accounts ─────────────────────────────────────────────────────

  test('chart of accounts shows table column headers', async ({ page }) => {
    await page.goto('/finance/chart-of-accounts');
    // REL-023: the page now also renders an <h3> card title that repeats
    // "Chart of Accounts" (and the <h1> itself grew a Term-component acronym
    // expansion, e.g. "Chart of Accounts (LMMHA ...)"), so the untargeted
    // locator matched 2 headings. level:1 pins this to the page's own <h1>.
    await expect(page.getByRole('heading', { name: 'Chart of Accounts', level: 1 })).toBeVisible();
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
    // REL-023: the page grew a "Post journal entry" card <h3> alongside the
    // page's own <h1> — same duplicate-heading pattern as chart-of-accounts.
    await expect(page.getByRole('heading', { name: /journal entry/i, level: 1 })).toBeVisible();
  });

  test('new voucher form shows required fields', async ({ page }) => {
    await page.goto('/finance/accounting/vouchers/new');
    // REL-023: <h1>New Journal Voucher</h1> plus a "Voucher entry" card <h3> —
    // both match /voucher/i, so this needs level:1 to mean "the page heading".
    await expect(page.getByRole('heading', { name: /voucher/i, level: 1 })).toBeVisible();
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
    // REL-023: card <h3>Budget estimates (BE) — all fiscal years</h3> also
    // matches /budget/i now.
    await expect(page.getByRole('heading', { name: /budget/i, level: 1 })).toBeVisible();
  });

  test('budget sanctions page loads without error', async ({ page }) => {
    await page.goto('/finance/budget/sanctions');
    // REL-023: card <h3>Administrative & financial sanctions</h3> also
    // matches /sanction/i now.
    await expect(page.getByRole('heading', { name: /sanction/i, level: 1 })).toBeVisible();
  });

  // ── Expenditure ───────────────────────────────────────────────────────────

  test('expenditure bills page loads without error', async ({ page }) => {
    await page.goto('/finance/expenditure/bills');
    // REL-023: a card <h3>Bill processing</h3> and an empty-state <h4>No
    // bills yet</h4> both also match /bill/i now.
    await expect(page.getByRole('heading', { name: /bill/i, level: 1 })).toBeVisible();
  });

  test('advances page loads without error', async ({ page }) => {
    await page.goto('/finance/expenditure/advances');
    // REL-023: card <h3>Advance management</h3> also matches /advance/i now.
    await expect(page.getByRole('heading', { name: /advance/i, level: 1 })).toBeVisible();
  });

  // ── General ledger ────────────────────────────────────────────────────────

  test('general ledger page loads without error', async ({ page }) => {
    await page.goto('/finance/accounting/general-ledger');
    // REL-023: card <h3>General ledger — all fiscal years</h3> also matches
    // /general ledger/i now.
    await expect(page.getByRole('heading', { name: /general ledger/i, level: 1 })).toBeVisible();
  });
});
