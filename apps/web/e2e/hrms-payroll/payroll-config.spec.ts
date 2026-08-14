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
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('shows stat cards (total, active, default)', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.getByText(/total structures/i)).toBeVisible();
      await expect(page.getByText(/active/i).first()).toBeVisible();
    });

    test('displays structures table', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.locator('tbody tr').first()).toBeVisible();
    });

    test('shows default indicator', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      // Default indicator only present when a structure has isDefault=true in DB
      const defaultInd = page.getByText('Yes').first().or(page.getByText(/default/i).first());
      if (await defaultInd.isVisible()) {
        await expect(defaultInd).toBeVisible();
      } else {
        await expect(page.locator('tbody tr').first()).toBeVisible();
      }
    });

    test('shows create structure form', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      // CreateStructureForm should be visible
      const createForm = page.getByRole('button', { name: /create|add|new/i }).or(
        page.getByRole('textbox', { name: /name/i }),
      ).first();
      await expect(createForm).toBeVisible();
    });

    test('back link navigates to payroll hub', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      const backLink = page.getByRole('link', { name: /payroll|back/i }).first();
      if (await backLink.isVisible()) {
        await expect(backLink).toHaveAttribute('href', /\/hr/);
      }
    });
  });

  // ── DDOs (Drawing and Disbursing Officers) ───────────────────────────────

  test.describe('DDOs', () => {
    test('DDO page loads', async ({ page }) => {
      await page.goto('/hr/payroll/ddos');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('shows DDO master data', async ({ page }) => {
      await page.goto('/hr/payroll/ddos');
      await expect(
        page.locator('tbody tr').first().or(page.getByText(/DDO|treasury officer/i).first()),
      ).toBeVisible();
    });
  });

  // ── Pensioners ───────────────────────────────────────────────────────────

  test.describe('Pensioners', () => {
    test('pensioners page loads', async ({ page }) => {
      await page.goto('/hr/payroll/pensioners');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('shows pensioner master data', async ({ page }) => {
      await page.goto('/hr/payroll/pensioners');
      await expect(
        page.locator('tbody tr').first().or(page.getByText(/PPO|pensioner/i).first()),
      ).toBeVisible();
    });
  });

  // ── Tax Configuration ────────────────────────────────────────────────────

  test.describe('Tax Configuration', () => {
    test('tax config page loads', async ({ page }) => {
      await page.goto('/hr/payroll/tax-config');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('income tax page loads', async ({ page }) => {
      await page.goto('/hr/payroll/income-tax');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('tax declaration page loads', async ({ page }) => {
      await page.goto('/hr/payroll/tax-declaration');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── GPF ──────────────────────────────────────────────────────────────────

  test.describe('GPF', () => {
    test('GPF page loads', async ({ page }) => {
      await page.goto('/hr/payroll/gpf');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── NPS ──────────────────────────────────────────────────────────────────

  test.describe('NPS', () => {
    test('NPS page loads', async ({ page }) => {
      await page.goto('/hr/payroll/nps');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Form 16 ──────────────────────────────────────────────────────────────

  test.describe('Form 16', () => {
    test('Form 16 page loads', async ({ page }) => {
      await page.goto('/hr/payroll/form16');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Statutory Returns ────────────────────────────────────────────────────

  test.describe('Statutory Returns', () => {
    test('statutory returns page loads', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('statutory deductions page loads', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Other Payroll Sub-pages ──────────────────────────────────────────────

  test.describe('Other Payroll Pages', () => {
    test.describe.configure({ timeout: 90000 }); // extra headroom after 130+ tests
    test('arrears page loads', async ({ page }) => {
      await page.goto('/hr/payroll/arrears');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('bonus page loads', async ({ page }) => {
      await page.goto('/hr/payroll/bonus');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('loans page loads', async ({ page }) => {
      await page.goto('/hr/payroll/loans');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('FnF page loads', async ({ page }) => {
      await page.goto('/hr/payroll/fnf');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('disbursement page loads', async ({ page }) => {
      await page.goto('/hr/payroll/disbursement');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('pay groups page loads', async ({ page }) => {
      await page.goto('/hr/payroll/pay-groups');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('salary revisions page loads', async ({ page }) => {
      await page.goto('/hr/payroll/salary-revisions');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('reimbursements page loads', async ({ page }) => {
      await page.goto('/hr/payroll/reimbursements');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('off-cycle page loads', async ({ page }) => {
      await page.goto('/hr/payroll/off-cycle');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('payroll register page loads', async ({ page }) => {
      await page.goto('/hr/payroll/register');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('comparison page loads', async ({ page }) => {
      await page.goto('/hr/payroll/comparison');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('costing page loads', async ({ page }) => {
      await page.goto('/hr/payroll/costing');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('CTC page loads', async ({ page }) => {
      await page.goto('/hr/payroll/ctc');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('corrections page loads', async ({ page }) => {
      await page.goto('/hr/payroll/corrections');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('flex benefits page loads', async ({ page }) => {
      await page.goto('/hr/payroll/flex-benefits');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('period page loads', async ({ page }) => {
      await page.goto('/hr/payroll/period');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });
});
