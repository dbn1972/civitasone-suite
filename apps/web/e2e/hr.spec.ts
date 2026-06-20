import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('HR', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('employees list shows employee name and department', async ({ page }) => {
    await page.goto('/hr/employees');
    await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ravi Kumar' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'IT' }).first()).toBeVisible();
  });

  test('employees list shows column headers', async ({ page }) => {
    await page.goto('/hr/employees');
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('leave list page loads without error', async ({ page }) => {
    await page.goto('/hr/leave');
    await expect(page.getByRole('heading', { name: /leave/i })).toBeVisible();
  });

  test('attendance page loads without error', async ({ page }) => {
    await page.goto('/hr/attendance');
    await expect(page.getByRole('heading', { name: /attendance/i })).toBeVisible();
  });
});
