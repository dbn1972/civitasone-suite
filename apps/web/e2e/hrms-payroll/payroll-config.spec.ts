/**
 * E2E: Payroll Configuration — Structures, DDOs, Pensioners, Tax, GPF, NPS
 *
 * Exercises:
 * - Pay structures management (create, list, activate)
 * - DDO master data
 * - Pensioner master management
 * - Tax configuration
 * - GPF and NPS administration
 * - Form 16 generation
 * - Statutory returns
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';
import * as fixtures from './fixtures';

test.describe('Payroll Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  // ── Pay Structures ───────────────────────────────────────────────────────

  test.describe('Pay Structures', () => {
    test('page loads with heading and back navigation', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.getByRole('heading', { name: /pay structures/i })).toBeVisible();
    });

    test('shows stat cards (total, active, default)', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.getByText(/total structures/i)).toBeVisible();
      await expect(page.getByText(/active/i)).toBeVisible();
    });

    test('displays structures table', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.getByText('Regular Pay Structure')).toBeVisible();
      await expect(page.getByText('Contract Pay Structure')).toBeVisible();
    });

    test('shows default indicator', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.getByText('Yes').first()).toBeVisible(); // isDefault = true
    });

    test('shows create structure form', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      // CreateStructureForm should be visible
      const createForm = page.getByRole('button', { name: /create|add|new/i }).or(
        page.getByRole('textbox', { name: /name/i }),
      );
      await expect(createForm).toBeVisible();
    });

    test('back link navigates to payroll hub', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      const backLink = page.getByRole('link', { name: /payroll|back/i }).first();
      if (await backLink.isVisible()) {
        await expect(backLink).toHaveAttribute('href', /\/hr\/payroll/);
      }
    });
  });

  // ── DDOs (Drawing and Disbursing Officers) ───────────────────────────────

  test.describe('DDOs', () => {
    test('DDO page loads', async ({ page }) => {
      await page.goto('/hr/payroll/ddos');
      await expect(page.getByRole('heading', { name: /ddo/i })).toBeVisible();
    });

    test('shows DDO master data', async ({ page }) => {
      await page.goto('/hr/payroll/ddos');
      await expect(
        page.getByText('District Treasury Officer').or(page.getByText('DDO-001')),
      ).toBeVisible();
    });
  });

  // ── Pensioners ───────────────────────────────────────────────────────────

  test.describe('Pensioners', () => {
    test('pensioners page loads', async ({ page }) => {
      await page.goto('/hr/payroll/pensioners');
      await expect(page.getByRole('heading', { name: /pension/i })).toBeVisible();
    });

    test('shows pensioner master data', async ({ page }) => {
      await page.goto('/hr/payroll/pensioners');
      await expect(
        page.getByText('Ram Prasad Sharma').or(page.getByText('PPO-2024-001')),
      ).toBeVisible();
    });
  });

  // ── Tax Configuration ────────────────────────────────────────────────────

  test.describe('Tax Configuration', () => {
    test('tax config page loads', async ({ page }) => {
      await page.goto('/hr/payroll/tax-config');
      await expect(page.getByRole('heading', { name: /tax/i })).toBeVisible();
    });

    test('income tax page loads', async ({ page }) => {
      await page.goto('/hr/payroll/income-tax');
      await expect(page.getByRole('heading', { name: /income.*tax|tax/i })).toBeVisible();
    });

    test('tax declaration page loads', async ({ page }) => {
      await page.goto('/hr/payroll/tax-declaration');
      await expect(page.getByRole('heading', { name: /tax.*declaration|declaration/i })).toBeVisible();
    });
  });

  // ── GPF ──────────────────────────────────────────────────────────────────

  test.describe('GPF', () => {
    test('GPF page loads', async ({ page }) => {
      await page.goto('/hr/payroll/gpf');
      await expect(page.getByRole('heading', { name: /gpf|general provident/i })).toBeVisible();
    });
  });

  // ── NPS ──────────────────────────────────────────────────────────────────

  test.describe('NPS', () => {
    test('NPS page loads', async ({ page }) => {
      await page.goto('/hr/payroll/nps');
      await expect(page.getByRole('heading', { name: /nps|national pension/i })).toBeVisible();
    });
  });

  // ── Form 16 ──────────────────────────────────────────────────────────────

  test.describe('Form 16', () => {
    test('Form 16 page loads', async ({ page }) => {
      await page.goto('/hr/payroll/form16');
      await expect(page.getByRole('heading', { name: /form.?16/i })).toBeVisible();
    });
  });

  // ── Statutory Returns ────────────────────────────────────────────────────

  test.describe('Statutory Returns', () => {
    test('statutory returns page loads', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      await expect(page.getByRole('heading', { name: /return|statutory/i })).toBeVisible();
    });

    test('statutory deductions page loads', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.getByRole('heading', { name: /statutory/i })).toBeVisible();
    });
  });

  // ── Other Payroll Sub-pages ──────────────────────────────────────────────

  test.describe('Other Payroll Pages', () => {
    test('arrears page loads', async ({ page }) => {
      await page.goto('/hr/payroll/arrears');
      await expect(page.getByRole('heading', { name: /arrear/i })).toBeVisible();
    });

    test('bonus page loads', async ({ page }) => {
      await page.goto('/hr/payroll/bonus');
      await expect(page.getByRole('heading', { name: /bonus/i })).toBeVisible();
    });

    test('loans page loads', async ({ page }) => {
      await page.goto('/hr/payroll/loans');
      await expect(page.getByRole('heading', { name: /loan/i })).toBeVisible();
    });

    test('FnF page loads', async ({ page }) => {
      await page.goto('/hr/payroll/fnf');
      await expect(page.getByRole('heading', { name: /full.*final|f.?n.?f|settlement/i })).toBeVisible();
    });

    test('disbursement page loads', async ({ page }) => {
      await page.goto('/hr/payroll/disbursement');
      await expect(page.getByRole('heading', { name: /disburs/i })).toBeVisible();
    });

    test('pay groups page loads', async ({ page }) => {
      await page.goto('/hr/payroll/pay-groups');
      await expect(page.getByRole('heading', { name: /pay.*group/i })).toBeVisible();
    });

    test('salary revisions page loads', async ({ page }) => {
      await page.goto('/hr/payroll/salary-revisions');
      await expect(page.getByRole('heading', { name: /salary.*revision/i })).toBeVisible();
    });

    test('reimbursements page loads', async ({ page }) => {
      await page.goto('/hr/payroll/reimbursements');
      await expect(page.getByRole('heading', { name: /reimburs/i })).toBeVisible();
    });

    test('off-cycle page loads', async ({ page }) => {
      await page.goto('/hr/payroll/off-cycle');
      await expect(page.getByRole('heading', { name: /off.?cycle/i })).toBeVisible();
    });

    test('payroll register page loads', async ({ page }) => {
      await page.goto('/hr/payroll/register');
      await expect(page.getByRole('heading', { name: /register/i })).toBeVisible();
    });

    test('comparison page loads', async ({ page }) => {
      await page.goto('/hr/payroll/comparison');
      await expect(page.getByRole('heading', { name: /compar/i })).toBeVisible();
    });

    test('costing page loads', async ({ page }) => {
      await page.goto('/hr/payroll/costing');
      await expect(page.getByRole('heading', { name: /cost/i })).toBeVisible();
    });

    test('CTC page loads', async ({ page }) => {
      await page.goto('/hr/payroll/ctc');
      await expect(page.getByRole('heading', { name: /ctc|cost.*company/i })).toBeVisible();
    });

    test('corrections page loads', async ({ page }) => {
      await page.goto('/hr/payroll/corrections');
      await expect(page.getByRole('heading', { name: /correction/i })).toBeVisible();
    });

    test('flex benefits page loads', async ({ page }) => {
      await page.goto('/hr/payroll/flex-benefits');
      await expect(page.getByRole('heading', { name: /flex.*benefit/i })).toBeVisible();
    });

    test('period page loads', async ({ page }) => {
      await page.goto('/hr/payroll/period');
      await expect(page.getByRole('heading', { name: /period/i })).toBeVisible();
    });
  });
});
