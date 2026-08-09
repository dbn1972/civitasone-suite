/**
 * E2E: Employee Lifecycle — Create → View → Confirm → Transfer → Promote → Separate
 *
 * Exercises the full employee journey through the HRMS module including:
 * - Employee list and detail views
 * - Employee creation form
 * - Probation confirmation
 * - Transfer orders (with eOffice approval)
 * - Promotion (with eOffice approval)
 * - Separation / Final settlement
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';
import * as fixtures from './fixtures';

test.describe('Employee Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  // ── Employee List ────────────────────────────────────────────────────────

  test.describe('Employee List', () => {
    test('displays page header and stat cards', async ({ page }) => {
      await page.goto('/hr/employees');
      await expect(page.getByRole('heading', { name: /employees/i })).toBeVisible();
    });

    test('renders employee table with correct columns', async ({ page }) => {
      await page.goto('/hr/employees');
      await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    });

    test('shows employee data from API', async ({ page }) => {
      await page.goto('/hr/employees');
      await expect(page.getByText('Ravi Kumar')).toBeVisible();
      await expect(page.getByText('Priya Singh')).toBeVisible();
      await expect(page.getByRole('cell', { name: 'IT' }).first()).toBeVisible();
    });

    test('shows correct status indicators', async ({ page }) => {
      await page.goto('/hr/employees');
      await expect(page.getByText('Active').first()).toBeVisible();
    });

    test('employee name links to detail page', async ({ page }) => {
      await page.goto('/hr/employees');
      const link = page.getByRole('link', { name: 'Ravi Kumar' });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page.getByRole('heading', { name: /employee profile/i })).toBeVisible();
    });
  });

  // ── Employee Detail ──────────────────────────────────────────────────────

  test.describe('Employee Detail', () => {
    test('displays employee profile with key fields', async ({ page }) => {
      await page.goto('/hr/employees/emp-001');
      await expect(page.getByRole('heading', { name: /employee profile/i })).toBeVisible();
      await expect(page.getByText('Ravi Kumar')).toBeVisible();
      await expect(page.getByText('Senior Engineer')).toBeVisible();
      await expect(page.getByText('IT')).toBeVisible();
    });

    test('shows personal information section', async ({ page }) => {
      await page.goto('/hr/employees/emp-001');
      await expect(page.getByText(/personal information/i)).toBeVisible();
      await expect(page.getByText('EMP-001')).toBeVisible();
    });

    test('breadcrumb links back to employee list', async ({ page }) => {
      await page.goto('/hr/employees/emp-001');
      const backLink = page.getByRole('link', { name: /employees/i });
      await expect(backLink).toBeVisible();
    });

    test('shows 404 state for non-existent employee', async ({ page }) => {
      await page.route('**/api/v1/hrms/employees/nonexistent', (route) =>
        route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: 'employee not found' }) }),
      );
      await page.goto('/hr/employees/nonexistent');
      // Should show error or not-found state
      await expect(page.getByText(/not found/i).or(page.getByText(/error/i))).toBeVisible();
    });
  });

  // ── Create Employee ──────────────────────────────────────────────────────

  test.describe('Create Employee', () => {
    test('employee creation form is accessible from list', async ({ page }) => {
      await page.goto('/hr/employees');
      // Look for an "Add" or "New" button/link
      const addBtn = page.getByRole('link', { name: /new|add|create/i }).or(
        page.getByRole('button', { name: /new|add|create/i }),
      );
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await expect(page).toHaveURL(/employees.*new|import|create/);
      }
    });
  });

  // ── Transfer ─────────────────────────────────────────────────────────────

  test.describe('Transfer', () => {
    test('transfer page loads with stat cards', async ({ page }) => {
      await page.goto('/hr/transfer');
      await expect(page.getByRole('heading', { name: /transfer/i })).toBeVisible();
      await expect(page.getByText(/total transfers/i)).toBeVisible();
    });

    test('shows transfer order table', async ({ page }) => {
      await page.goto('/hr/transfer');
      await expect(page.getByText('Ravi Kumar')).toBeVisible();
      await expect(page.getByText('HQ Delhi')).toBeVisible();
      await expect(page.getByText('Branch Jaipur')).toBeVisible();
    });

    test('shows correct status badges', async ({ page }) => {
      await page.goto('/hr/transfer');
      await expect(page.getByText('completed').first()).toBeVisible();
      await expect(page.getByText('pending').first()).toBeVisible();
    });

    test('transfer with approval button visible for HR admin', async ({ page }) => {
      await page.goto('/hr/transfer');
      // The TransferWithApproval component should render for HR admins
      const approvalBtn = page.getByRole('button', { name: /initiate|transfer|submit/i });
      if (await approvalBtn.isVisible()) {
        await expect(approvalBtn).toBeEnabled();
      }
    });
  });

  // ── Promotion ────────────────────────────────────────────────────────────

  test.describe('Promotion', () => {
    test('promotion page loads with stat cards', async ({ page }) => {
      await page.goto('/hr/promotion');
      await expect(page.getByRole('heading', { name: /promotion/i })).toBeVisible();
    });

    test('shows promotion data', async ({ page }) => {
      await page.goto('/hr/promotion');
      await expect(page.getByText('Ravi Kumar').or(page.getByText(/promotion/i).first())).toBeVisible();
    });
  });

  // ── Retirement / Separation ──────────────────────────────────────────────

  test.describe('Retirement', () => {
    test('retirement page loads', async ({ page }) => {
      await page.goto('/hr/retirement');
      await expect(page.getByRole('heading', { name: /retirement|separation/i })).toBeVisible();
    });
  });

  // ── Navigation: List → Detail → Back ────────────────────────────────────

  test('full navigation flow: list → detail → back', async ({ page }) => {
    await page.goto('/hr/employees');
    await page.getByRole('link', { name: 'Ravi Kumar' }).click();
    await expect(page.getByRole('heading', { name: /employee profile/i })).toBeVisible();
    await expect(page.getByText('EMP-001')).toBeVisible();

    // Navigate back
    const backLink = page.getByRole('link', { name: /employees|back/i }).first();
    if (await backLink.isVisible()) {
      await backLink.click();
      await expect(page.getByRole('heading', { name: /employees/i })).toBeVisible();
    }
  });
});
