/**
 * E2E: Visual Regression — Screenshot comparison for HRMS/Payroll pages
 *
 * Uses `expect(page).toHaveScreenshot()` for pixel-level comparison across runs.
 * Baseline screenshots are platform-specific (linux/darwin/win32) and browser-specific.
 *
 * First run generates baselines in `__screenshots__/`. Subsequent runs compare.
 * Update baselines: playwright test --update-snapshots
 *
 * Covers:
 * - Key page layouts (dashboard, employee list, payroll runs)
 * - Data-rich pages (tables, stat grids)
 * - Forms (leave application)
 * - Empty/loading states
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';
import * as fixtures from './fixtures';

test.describe('Visual Regression — HRMS Pages', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('HR Dashboard', async ({ page }) => {
    await page.goto('/hr/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('hr-dashboard.png', {
      fullPage: true,
      mask: [page.locator('[data-testid="timestamp"]')], // Mask dynamic timestamps
    });
  });

  test('Employee List', async ({ page }) => {
    await page.goto('/hr/employees');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('employee-list.png', { fullPage: true });
  });

  test('Employee Detail', async ({ page }) => {
    await page.goto('/hr/employees/emp-001');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('employee-detail.png', { fullPage: true });
  });

  test('Leave Management', async ({ page }) => {
    await page.goto('/hr/leave');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('leave-management.png', { fullPage: true });
  });

  test('Leave Application Form', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('leave-apply-form.png', { fullPage: true });
  });

  test('Attendance', async ({ page }) => {
    await page.goto('/hr/attendance');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('attendance.png', { fullPage: true });
  });

  test('Recruitment', async ({ page }) => {
    await page.goto('/hr/recruitment');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('recruitment.png', { fullPage: true });
  });

  test('Transfer Orders', async ({ page }) => {
    await page.goto('/hr/transfer');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('transfer-orders.png', { fullPage: true });
  });
});

test.describe('Visual Regression — Payroll Pages', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('Payroll Runs List', async ({ page }) => {
    await page.goto('/hr/payroll');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('payroll-runs.png', { fullPage: true });
  });

  test('Payroll Run Detail (paid)', async ({ page }) => {
    await page.goto('/hr/payroll/run-001');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('payroll-run-detail-paid.png', { fullPage: true });
  });

  test('Payroll Run Detail (draft)', async ({ page }) => {
    await page.goto('/hr/payroll/run-003');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('payroll-run-detail-draft.png', { fullPage: true });
  });

  test('Pay Structures', async ({ page }) => {
    await page.goto('/hr/payroll/structures');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('pay-structures.png', { fullPage: true });
  });

  test('Salary Slips', async ({ page }) => {
    await page.goto('/hr/payroll/salary-slips');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('salary-slips.png', { fullPage: true });
  });

  test('DDOs', async ({ page }) => {
    await page.goto('/hr/payroll/ddos');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('ddos.png', { fullPage: true });
  });

  test('Pensioners', async ({ page }) => {
    await page.goto('/hr/payroll/pensioners');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('pensioners.png', { fullPage: true });
  });
});

test.describe('Visual Regression — Empty & Error States', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('Empty employees state', async ({ page }) => {
    await page.route('**/api/v1/hrms/employees', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], pagination: { hasMore: false, pageSize: 50 } }),
      }),
    );
    await page.goto('/hr/employees');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('employee-list-empty.png', { fullPage: true });
  });

  test('Empty payroll (no structures)', async ({ page }) => {
    await page.route('**/api/v1/payroll/structures', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.route('**/api/v1/payroll/runs', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.goto('/hr/payroll');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('payroll-no-structures.png', { fullPage: true });
  });

  test('Empty recruitment (no vacancies)', async ({ page }) => {
    await page.route('**/api/v1/hrms/job-openings*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/v1/hrms/recruitment/dashboard', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalOpenings: 0, openVacancies: 0, publishedVacancies: 0, internshipsApprenticeships: 0, applicationsInternal: 0, applicationsPublic: 0 }),
      }),
    );
    await page.goto('/hr/recruitment');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('recruitment-empty.png', { fullPage: true });
  });

  test('Payroll run not found', async ({ page }) => {
    await page.route('**/api/v1/payroll/runs/nonexistent', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: 'run not found' }) }),
    );
    await page.goto('/hr/payroll/nonexistent');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('payroll-run-not-found.png', { fullPage: true });
  });
});
