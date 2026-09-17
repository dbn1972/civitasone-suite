/**
 * E2E — Finance & Expense (S17 / Sprint 20)
 *
 * Covers the HRMS-facing finance routes:
 *   advances (GFR 2017 Rule 290), travel TA/DA, medical CGHS/CS(MA),
 *   expense claims, and loans (GFR 2017 Ch.23).
 *
 * Fixture data is served by the global-setup mock gateway so every
 * assertion here works against rendered HTML, not mocked client calls.
 *
 * REL-023: all 5 routes below now live under /hr/* — finance/{advances,
 * travel,medical,expenses,loans}/page.tsx are redirect stubs ("called
 * finance-service routes that 404, superseded by the working hrms
 * equivalent"). Retargeted every page.goto() to the new location and
 * re-verified each assertion against the current hr per-route page.tsx source
 * rather than assuming a 1:1 port — several did NOT come across unchanged;
 * see the two test.fixme() blocks below for the two real gaps that turned
 * up (not test staleness — genuinely absent functionality).
 */
import { test, expect } from '@playwright/test';
import { authenticate } from '../helpers/auth';

test.describe('Finance & Expense — HRMS (S17)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Advances ─────────────────────────────────────────────────────────────

  test('advances list: page heading and "New Request" button are visible', async ({ page }) => {
    await page.goto('/hr/advances');
    // REL-023: heading text is now "Salary Advances" (a card <h3> and an
    // empty-state <h4> also contain "Advances" as a substring, hence
    // level:1 to pin this to the page's own <h1>).
    await expect(page.getByRole('heading', { name: 'Salary Advances', level: 1 })).toBeVisible();
    // REL-023: RequestAdvanceForm.tsx's toggle button reads "+ New Request"
    // now, not "New Advance".
    await expect(page.getByRole('button', { name: /New Request/i })).toBeVisible();
  });

  // REL-023: real gap, not a stale test — the modal "AdvanceSlideOver"
  // (finance/advances/AdvanceSlideOver.tsx) this test exercises, including
  // its GFR 2017 Rule 290 "Sanctioning Authority" mandatory-field notice, is
  // orphaned dead code: /finance/advances now redirects to /hr/advances,
  // whose RequestAdvanceForm.tsx is a plain inline expand-in-place form
  // (Employee / Amount / Recovery Months / Request Date / Purpose only)
  // with no dialog role and — this is the important part — no
  // "Sanctioning Authority" field and no GFR Rule 290 notice at all. GFR
  // 2017 Rule 290 requires an advance to be sanctioned by an authorised
  // officer; this looks like a compliance regression introduced when the
  // advances flow moved from Finance to HR, not a UI restyle. Flagging for
  // product/compliance review rather than silently dropping the
  // requirement or reintroducing the old dialog myself.
  test.fixme('AdvanceSlideOver: dialog opens with "Sanctioning Authority" as required field (GFR Rule 290)', async ({ page }) => {
    await page.goto('/hr/advances');
    await page.getByRole('button', { name: /New Request/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/GFR 2017 Rule 290/i)).toBeVisible();
    await expect(dialog.getByText(/Sanctioning Authority/i)).toBeVisible();
  });

  // ── Travel ───────────────────────────────────────────────────────────────

  // REL-023: real gap, not a stale test — TravelClaimCard.tsx (finance/
  // travel/TravelClaimCard.tsx), which computes CCS(TA) Rules 1988 Second
  // Schedule fare-class entitlement (Level 1-5 -> Sleeper, ... Level 9-17
  // -> AC-I) from an employee's pay level, is orphaned dead code:
  // /finance/travel now redirects to /hr/travel, whose TravelRequestsPage
  // is a pre-trip authorization request form (destination/purpose/dates/
  // mode) feeding a plain DataTable with no pay-level or fare-class field
  // at all — a materially different feature (request vs. entitlement-aware
  // claim), not a renamed/re-skinned version of the old one. The CCS(TA)
  // entitlement calculator has no live caller anywhere in the app
  // (grepped). Flagging as a product decision (reintegrate the entitlement
  // calculator into /hr/travel, or confirm claims-with-entitlement is
  // handled by a different, not-yet-built screen) rather than deleting
  // this coverage or asserting against a feature that is not there.
  test.fixme('travel list: heading and at least one TravelClaimCard article render', async ({ page }) => {
    await page.goto('/hr/travel');
    await expect(page.getByRole('heading', { name: 'TA / DA Claims' })).toBeVisible();
    await expect(page.getByText('TA/DA Claim Register')).toBeVisible();
    const firstCard = page.locator('article[aria-label^="Travel claim"]').first();
    await expect(firstCard).toBeVisible();
  });

  // REL-023: see the fixme above — same orphaned TravelClaimCard.tsx, no
  // entitlement UI reachable from /hr/travel.
  test.fixme('TravelClaimCard: Level 5 employee entitled to Sleeper, not AC-I (CCS(TA) Rules 1988 Sch. II)', async ({ page }) => {
    await page.goto('/hr/travel');
    const level5Card = page.locator('article[aria-label^="Travel claim"]', { hasText: 'Pay Level 5' });
    await expect(level5Card).toBeVisible();
    const fareSpan = level5Card.locator('[title*="Entitlement for Pay Level 5:"]');
    const title = await fareSpan.getAttribute('title');
    expect(title).toContain('Sleeper');
    expect(title).not.toContain('AC-I');
  });

  // ── Medical ──────────────────────────────────────────────────────────────

  test('medical claims list: page heading and "Medical Reimbursement Claims" card render', async ({ page }) => {
    await page.goto('/hr/medical');
    await expect(page.getByRole('heading', { name: 'Medical Reimbursement' })).toBeVisible();
    // REL-023: cardTitle is now "Medical Reimbursement Claims" (was "Medical
    // Claims Register") — see messages/en.json's medicalClaims namespace.
    await expect(page.getByRole('heading', { name: 'Medical Reimbursement Claims' })).toBeVisible();
    await expect(page.getByText('Total Claims')).toBeVisible();
    // REL-023: the "Employee" column is now "Claimant" (colClaimant) —
    // reflects that a claim can be filed for a dependant, not just self.
    await expect(page.getByRole('columnheader', { name: 'Claimant' })).toBeVisible();
  });

  // ── Expenses ─────────────────────────────────────────────────────────────

  test('expenses: claims table renders with fixture data', async ({ page }) => {
    await page.goto('/hr/expenses');
    await expect(page.getByRole('heading', { name: 'Expense Claims', level: 1 })).toBeVisible();
    // REL-023: the "New Claim" sidebar submission panel this test originally
    // checked no longer exists on this page at all (hr/expenses/page.tsx
    // renders only a StatGrid + the claims register Card+DataTable, no
    // claim-submission form component, unlike its advances/travel siblings
    // which each kept their own RequestAdvanceForm/TravelRequestForm). Not
    // asserting on it (nothing to find); noting it in the tranche report as
    // a smaller, non-compliance functional gap worth a follow-up.
    await expect(page.getByRole("columnheader", { name: "Category" })).toBeVisible();
    await expect(page.getByText('Office Supplies')).toBeVisible();
  });

  // ── Loans ────────────────────────────────────────────────────────────────

  test('loans: "Employee Loans" heading and loan data render', async ({ page }) => {
    await page.goto('/hr/loans');
    // REL-023: heading is now "Employee Loans" (loans.title) — "Loans &
    // Advances" isn't used anywhere on this page. LoanSummaryCard (the
    // component that produced LOAN_META.hba.label = "House Building
    // Advance") is likewise gone; loanType now renders as a plain DataTable
    // cell straight from the fixture/API value with no label lookup.
    await expect(page.getByRole('heading', { name: 'Employee Loans', level: 1 })).toBeVisible();
    await expect(page.getByText('Loans Register')).toBeVisible();
    await expect(page.getByText(/Vikram Mehta/)).toBeVisible();
    await expect(page.getByText(/House Building Advance/)).toBeVisible();
  });
});
