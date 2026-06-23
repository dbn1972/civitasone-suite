import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('HR', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('hr dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/hr/dashboard');
    await expect(page.getByText('Headcount')).toBeVisible();
    await expect(page.getByText(/attendance/i)).toBeVisible();
  });

  // ── List ─────────────────────────────────────────────────────────────────

  test('employees list shows column headers', async ({ page }) => {
    await page.goto('/hr/employees');
    await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('employees list shows employee name and department from mock', async ({ page }) => {
    await page.goto('/hr/employees');
    await expect(page.getByRole('link', { name: 'Ravi Kumar' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'IT' }).first()).toBeVisible();
  });

  // ── Detail ───────────────────────────────────────────────────────────────

  test('employee detail shows Employee Profile heading', async ({ page }) => {
    await page.goto('/hr/employees/EMP-001');
    await expect(page.getByRole('heading', { name: 'Employee Profile' })).toBeVisible();
  });

  test('employee detail shows key fields', async ({ page }) => {
    await page.goto('/hr/employees/EMP-001');
    await expect(page.getByText('Personal Information')).toBeVisible();
    await expect(page.getByText('EMP-001')).toBeVisible();
    await expect(page.getByText('Ravi Kumar')).toBeVisible();
  });

  test('employee detail breadcrumb links back to employees list', async ({ page }) => {
    await page.goto('/hr/employees/EMP-001');
    await expect(page.getByRole('link', { name: 'Employees' })).toBeVisible();
  });

  test('navigating employees list → detail shows profile', async ({ page }) => {
    await page.goto('/hr/employees');
    await page.getByRole('link', { name: 'Ravi Kumar' }).click();
    await expect(page.getByRole('heading', { name: 'Employee Profile' })).toBeVisible();
  });

  // ── Form ─────────────────────────────────────────────────────────────────

  test('leave application form shows all required fields', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await expect(page.getByRole('heading', { name: /leave/i })).toBeVisible();
    await expect(page.getByLabel(/employee id/i)).toBeVisible();
    await expect(page.getByLabel(/leave type/i)).toBeVisible();
    await expect(page.getByLabel(/from date/i)).toBeVisible();
    await expect(page.getByLabel(/to date/i)).toBeVisible();
  });

  test('leave application form validates required fields', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(page.getByText(/required/i)).toBeVisible();
  });

  // ── Other sub-pages ───────────────────────────────────────────────────────

  test('leave list page loads without error', async ({ page }) => {
    await page.goto('/hr/leave');
    await expect(page.getByRole('heading', { name: /leave/i })).toBeVisible();
  });

  test('attendance page loads without error', async ({ page }) => {
    await page.goto('/hr/attendance');
    await expect(page.getByRole('heading', { name: /attendance/i })).toBeVisible();
  });

  test('payroll list shows heading', async ({ page }) => {
    await page.goto('/hr/payroll');
    await expect(page.getByRole('heading', { name: /payroll/i })).toBeVisible();
  });

  test('payroll salary slips shows heading', async ({ page }) => {
    await page.goto('/hr/payroll/salary-slips');
    await expect(page.getByRole('heading', { name: /salary slip/i })).toBeVisible();
  });
});
