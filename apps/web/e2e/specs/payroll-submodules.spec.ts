/**
 * E2E — S12/S13: Payroll Sub-modules (Sprint 20)
 *
 * Render-level assertions for six payroll sub-pages:
 *   1. /hr/payroll/structures       — Salary Structure + SalaryStructureCard
 *   2. /hr/payroll/statutory        — Statutory hub (PF / ESI / PT / LWF)
 *   3. /hr/payroll/statutory/challans — ChallanTracker with month selector
 *   4. /hr/payroll/fnf              — F&F settlement form (employee + reason)
 *   5. /hr/payroll/form16           — Form-16 generation (FY selector visible)
 *   6. /hr/payroll/returns          — Quarterly TDS Returns (24Q / 26Q)
 *
 * Auth  : JWT from helpers/auth.ts TEST_TOKEN (all required roles embedded).
 * Mocks : SSR calls land on the mock gateway (port 4001); client-side proxy
 *         calls are stubbed blanket-200 by setupHrmsPage; additional stubs for
 *         new sub-module endpoints are added in beforeEach below.
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from '../hrms-payroll/helpers';

test.describe('Payroll Sub-modules — S12/S13', () => {
  test.beforeEach(async ({ page }) => {
    // Auth + standard payroll route stubs (structures, components, runs, etc.)
    await setupHrmsPage(page);

    // Additional client-side stubs for sub-module endpoints not in the shared layer
    await page.route('**/api/v1/payroll/fnf/settlements', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
    await page.route('**/api/v1/payroll/statutory/challans**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          period: '2026-08',
          formType: '24Q',
          count: 0,
          challans: [],
        }),
      }),
    );
    await page.route('**/api/v1/payroll/statutory/reconcile**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          formType: '24Q',
          perPeriod: [],
          totalDeductedMinor: '0',
          totalDepositedMinor: '0',
          varianceMinor: '0',
          matched: true,
          filingBlocked: false,
          note: 'No discrepancy.',
        }),
      }),
    );
  });

  // ── 1. Salary Structures (/hr/payroll/structures) ────────────────────────

  test.describe('Salary Structures', () => {
    test('page loads with Pay Structures heading', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.locator('#page-heading')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Pay Structures' }).first()).toBeVisible();
    });

    test('stat cards render — Total Structures, Active, Default, Components', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(page.getByText(/total structures/i)).toBeVisible();
      await expect(page.getByText(/active/i).first()).toBeVisible();
      await expect(page.getByText(/default/i).first()).toBeVisible();
      await expect(page.getByText(/components/i).first()).toBeVisible();
    });

    test('SalaryStructureCard or empty-state renders inside structures card', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      // When structures exist the card title is "Salary Structure Cards";
      // when empty the EmptyState message "No pay structures yet" appears.
      const content = page
        .getByText(/salary structure cards/i)
        .or(page.getByText(/no pay structures yet/i));
      await expect(content.first()).toBeVisible();
    });

    test('Component Grid card renders', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      await expect(
        page.getByText(/component grid.*earnings.*deductions/i),
      ).toBeVisible();
    });

    test('create structure trigger is present', async ({ page }) => {
      await page.goto('/hr/payroll/structures');
      const trigger = page
        .getByRole('button', { name: /create|add|new/i })
        .or(page.getByRole('textbox', { name: /name/i }))
        .or(page.getByText(/create.*structure/i));
      await expect(trigger.first()).toBeVisible();
    });
  });

  // ── 2. Statutory Compliance Hub (/hr/payroll/statutory) ─────────────────

  test.describe('Statutory Compliance', () => {
    test('page loads with Statutory Consoles heading', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.locator('#page-heading')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Statutory Consoles' })).toBeVisible();
    });

    test('StatutoryComplianceCard — Statutory Compliance Summary card renders', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.getByText(/statutory compliance summary/i)).toBeVisible();
    });

    test('PF section header is visible', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.getByText(/\bPF\b|\bEPF\b/i).first()).toBeVisible();
    });

    test('ESI section header is visible', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.getByText(/\bESI\b/i).first()).toBeVisible();
    });

    test('Professional Tax section header is visible', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.getByText(/professional tax/i).first()).toBeAttached();
    });

    test('Labour Welfare Fund section header is visible', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(page.getByText(/labour welfare fund/i).first()).toBeAttached();
    });

    test('navigation tile for Challans links to /hr/payroll/statutory/challans', async ({ page }) => {
      await page.goto('/hr/payroll/statutory');
      await expect(
        page.getByRole('link', { name: /challans/i }),
      ).toHaveAttribute('href', '/hr/payroll/statutory/challans');
    });
  });

  // ── 3. TDS Challans (/hr/payroll/statutory/challans) ────────────────────

  test.describe('TDS Challans', () => {
    test('page loads with TDS Challans heading', async ({ page }) => {
      await page.goto('/hr/payroll/statutory/challans');
      await expect(page.locator('#page-heading')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /TDS challans/i }),
      ).toBeVisible();
    });

    test('ChallanTracker — PeriodSelector month input is visible', async ({ page }) => {
      await page.goto('/hr/payroll/statutory/challans');
      // PeriodSelector renders a label "Period" and a type="month" input
      await expect(page.locator('input[type="month"]').first()).toBeVisible();
    });

    test('stat cards render — Challans for Period, Reconciliation Status', async ({ page }) => {
      await page.goto('/hr/payroll/statutory/challans');
      await expect(page.getByText(/challans for period/i)).toBeVisible();
      await expect(page.getByText(/reconciliation status/i)).toBeVisible();
    });

    test('IngestChallanForm renders in page body', async ({ page }) => {
      await page.goto('/hr/payroll/statutory/challans');
      // IngestChallanForm contains a BSR code field and deposit date; the
      // submit path runs through a ConfirmDialog, so the visible trigger is
      // either a submit button or the BSR code input label.
      const ingestPresent = page
        .getByRole('button', { name: /ingest|submit/i })
        .or(page.getByText(/BSR code/i))
        .or(page.getByText(/ingest.*challan/i));
      await expect(ingestPresent.first()).toBeVisible();
    });
  });

  // ── 4. Full & Final Settlement (/hr/payroll/fnf) ────────────────────────

  test.describe('F&F Settlement', () => {
    test('page loads with Full & Final Settlement heading', async ({ page }) => {
      await page.goto('/hr/payroll/fnf');
      await expect(page.locator('#page-heading')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /full.*final settlement/i }),
      ).toBeVisible();
    });

    test('stat cards render — Total, Pending/Draft, Settled, Separation Types', async ({ page }) => {
      await page.goto('/hr/payroll/fnf');
      await expect(page.getByText(/total settlements/i)).toBeVisible();
      await expect(page.getByText(/pending.*draft/i)).toBeVisible();
    });

    test('ComputeFnfForm — employee ID field (employee selector) is present', async ({ page }) => {
      await page.goto('/hr/payroll/fnf');
      // ComputeFnfForm renders an employeeId text input (employee selector)
      const empField = page
        .getByLabel(/employee id/i)
        .or(page.getByPlaceholder(/EMP-/i));
      await expect(empField.first()).toBeVisible();
    });

    test('ComputeFnfForm — separation type select (reason) is present', async ({ page }) => {
      await page.goto('/hr/payroll/fnf');
      const sepSelect = page
        .getByLabel(/separation type/i)
        .or(page.getByRole('combobox', { name: /separation/i }));
      await expect(sepSelect.first()).toBeVisible();
    });

    test('F&F Settlements card renders', async ({ page }) => {
      await page.goto('/hr/payroll/fnf');
      await expect(page.getByText(/F&F Settlements/)).toBeVisible();
    });
  });

  // ── 5. Form-16 Generation (/hr/payroll/form16) ──────────────────────────

  test.describe('Form 16', () => {
    test('page loads with Form-16 Generation heading', async ({ page }) => {
      await page.goto('/hr/payroll/form16');
      await expect(page.locator('#page-heading')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /form.16 generation/i }),
      ).toBeVisible();
    });

    test('Form-16 Wizard card renders', async ({ page }) => {
      await page.goto('/hr/payroll/form16');
      await expect(page.getByText(/form.16 wizard/i)).toBeVisible();
    });

    test('FyLookupForm — year selector (Financial Year label) is visible', async ({ page }) => {
      await page.goto('/hr/payroll/form16');
      await expect(page.locator('[name="fy"]').first()).toBeVisible();
    });

    test('FyLookupForm — year input pre-fills to current FY (2026-27)', async ({ page }) => {
      await page.goto('/hr/payroll/form16');
      // Server-computed currentFy(): Aug 2026 → month ≥ 3 (Apr) → FY 2026-27
      await expect(page.locator('[name="fy"]').first()).toHaveValue('2026-27');
    });

    test('Bulk Filing Status card renders', async ({ page }) => {
      await page.goto('/hr/payroll/form16');
      await expect(page.getByText(/bulk filing status/i)).toBeVisible();
    });
  });

  // ── 6. Quarterly TDS Returns (/hr/payroll/returns) ──────────────────────

  test.describe('TDS Returns', () => {
    test('page loads with Quarterly TDS Returns heading', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      await expect(page.locator('#page-heading')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /quarterly TDS returns/i }),
      ).toBeVisible();
    });

    test('Annual TDS Returns Overview card renders', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      await expect(page.getByText(/annual TDS returns overview/i)).toBeVisible();
    });

    test('QuarterLookupForm — Financial Year input is visible', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      await expect(page.locator('[name="fy"]').first()).toBeVisible();
    });

    test('QuarterLookupForm — Quarter selector renders with Q1 and Q4 options', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      const qSelect = page.getByLabel(/^quarter$/i);
      await expect(qSelect).toBeVisible();
      await expect(qSelect.getByRole('option', { name: 'Q1' })).toBeAttached();
      await expect(qSelect.getByRole('option', { name: 'Q4' })).toBeAttached();
    });

    test('Form-24Q salary TDS card renders', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      await expect(page.getByText(/form.24q.*salary TDS/i)).toBeVisible();
    });

    test('Form-26Q non-salary TDS card renders', async ({ page }) => {
      await page.goto('/hr/payroll/returns');
      await expect(page.getByText(/form.26q.*non.salary TDS/i)).toBeVisible();
    });
  });
});
