import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';

test.describe('Attendance Management', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test.describe('Attendance Overview', () => {
    test('page renders h1 heading', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.locator('h1#page-heading')).toHaveText('Attendance');
    });

    test('shows Total Records stat card label', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText('Total Records', { exact: true }).first()).toBeVisible();
    });

    test('shows Present stat card label', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText('Present', { exact: true }).first()).toBeVisible();
    });

    test('shows Absent stat card label', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText('Absent', { exact: true }).first()).toBeVisible();
    });

    test('shows On Leave stat card label', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText('On Leave', { exact: true }).first()).toBeVisible();
    });

    test('displays Ravi Kumar from SSR fixture', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText('Ravi Kumar')).toBeVisible({ timeout: 10000 });
    });

    test('displays Priya Singh from SSR fixture', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText('Priya Singh')).toBeVisible({ timeout: 10000 });
    });

    test('displays Ankit Verma from SSR fixture', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText('Ankit Verma')).toBeVisible({ timeout: 10000 });
    });

    test('shows present status badge', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText(/present/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('shows absent status badge', async ({ page }) => {
      await page.goto('/hr/attendance');
      await expect(page.getByText(/absent/i).first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Regularisation', () => {
    test('page renders h1 heading', async ({ page }) => {
      await page.goto('/hr/attendance/regularisation');
      await expect(page.locator('h1#page-heading')).toContainText('Regularisation');
    });

    test('shows Pending stat card label', async ({ page }) => {
      await page.goto('/hr/attendance/regularisation');
      await expect(page.getByText(/pending/i).first()).toBeVisible();
    });

    test('shows Ankit Verma regularisation request', async ({ page }) => {
      await page.goto('/hr/attendance/regularisation');
      await expect(page.getByText('Ankit Verma')).toBeVisible({ timeout: 10000 });
    });

    test('Approve button visible for pending request', async ({ page }) => {
      await page.goto('/hr/attendance/regularisation');
      await expect(page.getByRole('button', { name: /approve/i }).first()).toBeVisible({ timeout: 10000 });
    });

    test('Reject button visible for pending request', async ({ page }) => {
      await page.goto('/hr/attendance/regularisation');
      await expect(page.getByRole('button', { name: /reject/i }).first()).toBeVisible({ timeout: 10000 });
    });

    test('approve button opens confirm dialog', async ({ page }) => {
      await page.goto('/hr/attendance/regularisation');
      await page.getByText('Ankit Verma').waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Approve' }).first().click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
    });
  });

  test.describe('Config', () => {
    test('page renders heading', async ({ page }) => {
      await page.goto('/hr/attendance/config');
      await expect(page.locator('h1').first()).toBeVisible();
    });

    test('shows working hours configuration', async ({ page }) => {
      await page.goto('/hr/attendance/config');
      await expect(page.getByText(/working hours/i)).toBeVisible();
    });
  });
});
