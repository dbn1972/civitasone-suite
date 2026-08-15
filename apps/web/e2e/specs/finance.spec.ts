/**
 * E2E — Finance & Expense (S17 / Sprint 20)
 *
 * Covers the HRMS-facing finance routes:
 *   advances (GFR 2017 Rule 290), travel TA/DA, medical CGHS/CS(MA),
 *   expense claims, and loans (GFR 2017 Ch.23).
 *
 * Fixture data is served by the global-setup mock gateway so every
 * assertion here works against rendered HTML, not mocked client calls.
 */
import { test, expect } from '@playwright/test';
import { authenticate } from '../helpers/auth';

test.describe('Finance & Expense — HRMS (S17)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Advances ─────────────────────────────────────────────────────────────

  test('advances list: page heading and "New Advance" button are visible', async ({ page }) => {
    await page.goto('/finance/advances');
    await expect(page.getByRole('heading', { name: 'Advances' })).toBeVisible();
    // The AdvanceSlideOver button is always rendered in PageHeader.actions
    await expect(page.getByRole('button', { name: /New Advance/i }).first()).toBeVisible();
  });

  test('AdvanceSlideOver: dialog opens with "Sanctioning Authority" as required field (GFR Rule 290)', async ({ page }) => {
    await page.goto('/finance/advances');
    // Open the slide-over — click the first visible "New Advance" trigger
    await page.getByRole('button', { name: /New Advance/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New Advance' });
    await expect(dialog).toBeVisible();
    // GFR Rule 290 notice must appear in the panel
    await expect(dialog.getByText(/GFR 2017 Rule 290/i)).toBeVisible();
    // The "Sanctioning Authority" label must be visible
    await expect(dialog.getByText(/Sanctioning Authority/i)).toBeVisible();
    // The corresponding input must carry aria-required="true"
    const sanctionedInput = dialog.locator('input[aria-required="true"]');
    await expect(sanctionedInput).toBeVisible();
    await expect(sanctionedInput).toHaveAttribute('aria-required', 'true');
  });

  // ── Travel ───────────────────────────────────────────────────────────────

  test('travel list: heading and at least one TravelClaimCard article render', async ({ page }) => {
    await page.goto('/finance/travel');
    await expect(page.getByRole('heading', { name: 'TA / DA Claims' })).toBeVisible();
    await expect(page.getByText('TA/DA Claim Register')).toBeVisible();
    // TravelClaimCard renders as <article aria-label="Travel claim {id}">
    const firstCard = page.locator('article[aria-label^="Travel claim"]').first();
    await expect(firstCard).toBeVisible();
  });

  test('TravelClaimCard: Level 5 employee entitled to Sleeper, not AC-I (CCS(TA) Rules 1988 Sch. II)', async ({ page }) => {
    await page.goto('/finance/travel');
    await expect(page.getByRole('heading', { name: 'TA / DA Claims' })).toBeVisible();
    // Fixture has one claim for a Pay Level 5 employee (Suresh Nair / EMP-L5-001)
    const level5Card = page.locator('article[aria-label^="Travel claim"]', {
      hasText: 'Pay Level 5',
    });
    await expect(level5Card).toBeVisible();
    // The fare class span carries a title attribute encoding the entitlement
    const fareSpan = level5Card.locator('[title*="Entitlement for Pay Level 5:"]');
    await expect(fareSpan).toBeVisible();
    const title = await fareSpan.getAttribute('title');
    // CCS(TA) Rules 1988 Second Schedule: Level 1–5 → Sleeper Class
    expect(title).toContain('Sleeper');
    // Regression guard: must NOT show AC-I (senior entitlement) for Level 5
    expect(title).not.toContain('AC-I');
  });

  // ── Medical ──────────────────────────────────────────────────────────────

  test('medical claims list: page heading and "Medical Claims Register" card render', async ({ page }) => {
    await page.goto('/finance/medical');
    await expect(page.getByRole('heading', { name: 'Medical Reimbursement' })).toBeVisible();
    await expect(page.getByText('Medical Claims Register')).toBeVisible();
    // Stats always render regardless of data
    await expect(page.getByText('Total Claims')).toBeVisible();
    // With fixture data, at least the "Employee" column header is present in the DataTable
    await expect(page.getByRole('columnheader', { name: 'Employee' })).toBeVisible();
  });

  // ── Expenses ─────────────────────────────────────────────────────────────

  test('expenses: claims table and "New Claim" form panel render', async ({ page }) => {
    await page.goto('/finance/expenses');
    await expect(page.getByRole('heading', { name: 'Expense Claims' })).toBeVisible();
    // The "Expense Claims Register" card is always in layout
    await expect(page.getByText('Expense Claims Register')).toBeVisible();
    // The sidebar "New Claim" card is always in layout (not conditional on data)
    await expect(page.getByText('New Claim')).toBeVisible();
    // With fixture data, the claims table headers should be visible
    await expect(page.getByRole('columnheader', { name: 'Claim ID' })).toBeVisible();
  });

  // ── Loans ────────────────────────────────────────────────────────────────

  test('loans: "Loans & Advances" heading, LoanSummaryCard, and "All Loans & Advances" DataTable render', async ({ page }) => {
    await page.goto('/finance/loans');
    await expect(page.getByRole('heading', { name: 'Loans & Advances' })).toBeVisible();
    // "All Loans & Advances" DataTable is always rendered
    await expect(page.getByText('All Loans & Advances')).toBeVisible();
    // With fixture data (hba loan for Vikram Mehta), LoanSummaryCard renders
    // LoanSummaryCard uses LOAN_META.hba.label = "House Building Advance"
    await expect(page.getByText('House Building Advance')).toBeVisible();
    // Fixture employee appears in the table
    await expect(page.getByText(/Vikram Mehta/)).toBeVisible();
  });
});
