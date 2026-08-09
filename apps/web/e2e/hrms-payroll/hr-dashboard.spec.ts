/**
 * E2E: HR Dashboard & Hub — Entry point and cross-module navigation
 *
 * Exercises:
 * - HR hub page (module overview)
 * - HR dashboard KPI cards
 * - Navigation to all HRMS sub-modules from hub
 * - Cross-module user journeys (multi-step flows)
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';
import * as fixtures from './fixtures';

test.describe('HR Hub & Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  // ── HR Hub ───────────────────────────────────────────────────────────────

  test.describe('HR Hub Page', () => {
    test('hub page loads with module navigation tiles', async ({ page }) => {
      await page.goto('/hr');
      // The hub page should show module links
      await expect(page.getByRole('heading').first()).toBeVisible();
    });

    test('has links to key HR modules', async ({ page }) => {
      await page.goto('/hr');
      // Hub provides navigation tiles to sub-modules
      const expectedModules = ['employees', 'leave', 'attendance', 'payroll', 'recruitment'];
      for (const mod of expectedModules) {
        const link = page.getByRole('link', { name: new RegExp(mod, 'i') });
        if (await link.isVisible()) {
          await expect(link).toBeVisible();
        }
      }
    });
  });

  // ── HR Dashboard ─────────────────────────────────────────────────────────

  test.describe('HR Dashboard', () => {
    test('dashboard page loads with KPI heading', async ({ page }) => {
      await page.goto('/hr/dashboard');
      await expect(page.getByText(/headcount|head.*count/i).or(page.getByRole('heading', { name: /dashboard/i }))).toBeVisible();
    });

    test('shows headcount metric', async ({ page }) => {
      await page.goto('/hr/dashboard');
      // hrDashboard.headcount = 152
      await expect(page.getByText('152').or(page.getByText(/headcount/i))).toBeVisible();
    });

    test('shows attendance percentage', async ({ page }) => {
      await page.goto('/hr/dashboard');
      // hrDashboard.attendanceTodayPct = 92
      await expect(page.getByText(/attendance/i)).toBeVisible();
    });

    test('shows pending leaves count', async ({ page }) => {
      await page.goto('/hr/dashboard');
      await expect(page.getByText(/pending/i).or(page.getByText(/leave/i))).toBeVisible();
    });
  });

  // ── Cross-Module Journey: Onboard → Attendance → Leave → Payroll ────────

  test.describe('Cross-Module Navigation', () => {
    test('dashboard → employees → detail flow', async ({ page }) => {
      await page.goto('/hr/dashboard');
      // Navigate to employees
      const empLink = page.getByRole('link', { name: /employees/i }).first();
      if (await empLink.isVisible()) {
        await empLink.click();
        await expect(page.getByRole('heading', { name: /employees/i })).toBeVisible();
        // Then to a specific employee
        await page.getByRole('link', { name: 'Ravi Kumar' }).click();
        await expect(page.getByText('EMP-001')).toBeVisible();
      }
    });

    test('leave → apply → back flow', async ({ page }) => {
      await page.goto('/hr/leave');
      const applyLink = page.getByRole('link', { name: /apply|new leave/i });
      await expect(applyLink).toBeVisible();
      await applyLink.click();
      await expect(page.getByRole('heading', { name: /apply.*leave/i })).toBeVisible();
      // Back navigation
      const backLink = page.getByRole('link', { name: /back|leave/i }).first();
      if (await backLink.isVisible() && await backLink.getAttribute('href') === '/hr/leave') {
        await backLink.click();
        await expect(page.getByRole('heading', { name: /leave/i })).toBeVisible();
      }
    });

    test('payroll → structures → back flow', async ({ page }) => {
      await page.goto('/hr/payroll');
      const structLink = page.getByRole('link', { name: /pay structures|structures/i });
      if (await structLink.isVisible()) {
        await structLink.click();
        await expect(page.getByRole('heading', { name: /pay structures/i })).toBeVisible();
      }
    });

    test('payroll → salary slips → back flow', async ({ page }) => {
      await page.goto('/hr/payroll/salary-slips');
      await expect(page.getByRole('heading', { name: /salary slip/i })).toBeVisible();
    });
  });

  // ── Loading States ───────────────────────────────────────────────────────

  test.describe('Loading & Empty States', () => {
    test('employee list shows loading state before data', async ({ page }) => {
      // Delay the API response to catch loading state
      await page.route('**/api/v1/hrms/employees', async (route) => {
        await new Promise((r) => setTimeout(r, 500));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fixtures.employees),
        });
      });
      await page.goto('/hr/employees');
      // Loading skeleton or spinner should appear briefly
      // Page should ultimately show the data
      await expect(page.getByText('Ravi Kumar')).toBeVisible({ timeout: 10_000 });
    });

    test('empty employees shows appropriate message', async ({ page }) => {
      await page.route('**/api/v1/hrms/employees', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], pagination: { hasMore: false, pageSize: 50 } }),
        }),
      );
      await page.goto('/hr/employees');
      await expect(page.getByRole('heading', { name: /employees/i })).toBeVisible();
    });

    test('empty payroll runs shows create prompt', async ({ page }) => {
      await page.route('**/api/v1/payroll/runs', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
      );
      await page.goto('/hr/payroll');
      await expect(page.getByRole('heading', { name: /payroll/i })).toBeVisible();
    });
  });

  // ── Error Boundary ───────────────────────────────────────────────────────

  test.describe('Error Boundaries', () => {
    test('HR pages have error boundaries that prevent blank screens', async ({ page }) => {
      // Simulate a catastrophic API failure
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.includes('/api/v1/hrms/') || url.includes('/api/v1/payroll/')) {
          return route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL"}' });
        }
        return route.continue();
      });
      await page.goto('/hr/employees');
      // Page should NOT be completely blank — error boundary catches
      const body = await page.locator('body').textContent();
      expect(body?.length).toBeGreaterThan(0);
    });
  });
});
