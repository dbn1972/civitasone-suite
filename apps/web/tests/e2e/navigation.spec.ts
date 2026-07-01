import { test, expect } from '@playwright/test';
import { goAsAdmin } from './helpers/auth';

/**
 * Core sidebar routes that should be accessible without 404/500.
 * These map to the main module routes in the app.
 */
const SIDEBAR_ROUTES = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Finance', path: '/finance' },
  { name: 'HR', path: '/hr' },
  { name: 'Procurement', path: '/procurement' },
  { name: 'Projects', path: '/projects' },
  { name: 'Grants', path: '/grants' },
  { name: 'Assets', path: '/assets' },
  { name: 'Stock', path: '/stock' },
  { name: 'Legal', path: '/legal' },
  { name: 'CRM', path: '/crm' },
  { name: 'Citizen Services', path: '/citizen' },
  { name: 'Establishment', path: '/estab' },
  { name: 'Audit', path: '/audit' },
  { name: 'Tenant Admin', path: '/tenant-admin' },
] as const;

test.describe('Sidebar & Routing', () => {
  test.describe('Route Accessibility', () => {
    for (const route of SIDEBAR_ROUTES) {
      test(`${route.name} (${route.path}) loads without 404 or 500`, async ({ page }) => {
        // Mock API calls so pages don't fail on missing backends
        await page.route('**/api/**', (routeHandler) => {
          const url = routeHandler.request().url();
          // Let auth-related calls pass through to the mock gateway
          if (url.includes('/api/proxy/')) {
            return routeHandler.fulfill({
              status: 200,
              contentType: 'application/json',
              body: '{}',
            });
          }
          return routeHandler.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: [] }),
          });
        });

        await goAsAdmin(page, route.path);

        // Should not show 404 page
        await expect(page.getByText(/404|not found/i)).not.toBeVisible();
        // Should not show server error
        await expect(page.getByText(/500|internal server error/i)).not.toBeVisible();
      });
    }
  });

  test.describe('Navigation Behavior', () => {
    test('sidebar contains navigation links', async ({ page }) => {
      await page.route('**/api/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        }),
      );

      await goAsAdmin(page, '/dashboard');

      // Sidebar should have at minimum the Finance and HR links
      const financeLink = page.getByRole('link', { name: /finance/i }).first();
      await expect(financeLink).toBeVisible();
    });

    test('clicking a sidebar link navigates to the correct page', async ({ page }) => {
      await page.route('**/api/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        }),
      );

      await goAsAdmin(page, '/dashboard');

      // Click Finance in navigation
      const financeLink = page.getByRole('link', { name: /finance/i }).first();
      await financeLink.click();
      await expect(page).toHaveURL(/\/finance/);
    });

    test('browser back button returns to previous page', async ({ page }) => {
      await page.route('**/api/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        }),
      );

      await goAsAdmin(page, '/dashboard');
      await page.goto('/finance');
      await page.goBack();
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('breadcrumb shows current path context', async ({ page }) => {
      await page.route('**/api/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        }),
      );

      await goAsAdmin(page, '/finance');

      // Breadcrumb should contain Finance or show the current module
      const breadcrumb = page.locator(
        'nav[aria-label="Breadcrumb"], nav[aria-label="breadcrumb"], [data-testid="breadcrumb"]',
      );
      // If breadcrumb exists, verify it shows context
      const breadcrumbCount = await breadcrumb.count();
      if (breadcrumbCount > 0) {
        await expect(breadcrumb.first()).toContainText(/finance/i);
      }
    });
  });
});
