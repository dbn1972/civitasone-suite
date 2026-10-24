import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// /admin is the platform operator console (admin-service plus tenant-service reads). The mock gateway
// answers /v1/admin/users from a three-person directory and filters it on ?q= and ?status=.
test.describe('Admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub groups the operator tools and links to the tenant directory', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#page-heading:visible')).toContainText('Platform Administration');
    await expect(page.getByText('Super admin tools for tenant management, billing, and platform operations.')).toBeVisible();
    const main = page.locator('main');
    for (const group of [/^platform$/i, /^billing and plans$/i, /^integrations and gateways$/i, /^operations$/i]) {
      await expect(main.getByText(group)).toBeVisible();
    }
    await expect(main.getByRole('link', { name: /^Tenants/ })).toHaveAttribute('href', '/admin/tenants');
    await expect(main.getByRole('link', { name: /^Editions/ })).toHaveAttribute('href', '/admin/editions');
    await expect(main.getByRole('link', { name: /^Entitlements/ })).toHaveAttribute('href', '/admin/entitlements');
  });

  test('hub link opens the tenant directory', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('main').getByRole('link', { name: /^Tenants/ }).click();
    await expect(page).toHaveURL(/\/admin\/tenants/);
    await expect(page.locator('#page-heading:visible')).toContainText('Tenants');
  });

  test('tenants show edition and status with counts per status', async ({ page }) => {
    await page.goto('/admin/tenants');
    await expect(page.locator('#page-heading:visible')).toContainText('Tenants');
    const main = page.locator('main');
    await expect(main).toContainText(/Total Tenants\s*3/);
    await expect(main).toContainText(/Active\s*1/);
    await expect(main).toContainText(/Trial\s*1/);
    await expect(main).toContainText(/Suspended\s*1/);
    for (const col of ['Tenant Name', 'Edition', 'Users', 'Created', 'Status']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    const mord = page.getByRole('row', { name: /Ministry of Rural Development/ });
    await expect(mord).toContainText('enterprise');
    await expect(mord).toContainText('Active');
    await expect(page.getByRole('row', { name: /District Collectorate Pune/ })).toContainText('Trial');
    await expect(page.getByRole('row', { name: /State Archives Bhopal/ })).toContainText('Suspended');
    await expect(page.getByRole('link', { name: 'Onboarding queue' })).toHaveAttribute('href', '/admin/onboarding');
  });

  test('editions show module bundles and tenant allocation', async ({ page }) => {
    await page.goto('/admin/editions');
    await expect(page.locator('#page-heading:visible')).toContainText('Edition Catalog');
    const main = page.locator('main');
    await expect(main).toContainText(/Total Editions\s*2/);
    await expect(main).toContainText(/Total Tenants\s*3/);
    const standard = page.getByRole('row', { name: /Standard/ });
    await expect(standard).toContainText('8');
    await expect(standard).toContainText('Active');
    const enterprise = page.getByRole('row', { name: /Enterprise/ });
    await expect(enterprise).toContainText('14');
  });

  test('users list the directory with MFA and status, and offer row actions', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.locator('#page-heading:visible')).toContainText('User Management');
    const main = page.locator('main');
    await expect(main).toContainText(/Total users\s*3/);
    await expect(main).toContainText(/Suspended\s*1/);
    const asha = page.getByRole('row', { name: /Asha Verma/ });
    await expect(asha).toContainText('asha.verma@example.gov.in');
    await expect(asha).toContainText('EMP-1042');
    await expect(asha).toContainText('Enabled');
    await expect(asha.getByRole('button', { name: /Suspend/ })).toBeVisible();
    const rohit = page.getByRole('row', { name: /Rohit Menon/ });
    await expect(rohit).toContainText('Disabled');
    await expect(rohit).toContainText('Suspended');
    await expect(rohit.getByRole('button', { name: /Activate/ })).toBeVisible();
  });

  test('searching users narrows the directory on the server', async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByRole('searchbox', { name: 'Search name, email or employee code' }).fill('meera');
    await page.getByRole('search', { name: 'Search users' }).getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=meera/);
    await expect(page.getByText('Showing 1–1 of 1 matching “meera”')).toBeVisible();
    await expect(page.getByRole('row', { name: /Meera Iyer/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Asha Verma/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Clear search' })).toBeVisible();
  });

  test('role permissions load per role and track unsaved changes', async ({ page }) => {
    await page.route('**/api/proxy/v1/admin/roles/10000000-0000-4000-8000-000000000003', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '10000000-0000-4000-8000-000000000003',
          key: 'hr_officer',
          name: 'HR Officer',
          description: 'Handles leave and service records',
          isSystem: false,
          permissions: ['hrms.leave.approve'],
        }),
      }),
    );
    await page.goto('/admin/roles');
    await expect(page.locator('#page-heading:visible')).toContainText('Role Permissions');
    const main = page.locator('main');
    await expect(main).toContainText(/Assignable roles\s*2/);
    await expect(main).toContainText(/Total permissions\s*4/);
    await expect(main).toContainText(/System roles \(read-only\)\s*2/);
    await page.getByLabel('Role:').selectOption({ label: 'HR Officer' });
    await expect(main).toContainText(/Granted to selected role\s*1/);
    await expect(page.getByRole('checkbox', { name: /Approve leave/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Approve bill/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /Approve bill/ }).check();
    await expect(page.getByRole('button', { name: 'Save 1 change' })).toBeEnabled();
  });

  test('with no roles the permission editor says so', async ({ page }) => {
    await authenticate(page, 'empty');
    await page.goto('/admin/roles');
    await expect(page.locator('#page-heading:visible')).toContainText('Role Permissions');
    await expect(page.getByLabel('Role:')).toContainText('No roles available');
    await expect(page.getByText('No role selected.')).toBeVisible();
    await expect(page.locator('main')).toContainText(/Assignable roles\s*0/);
  });

  test('a failed tenant load shows an error state with dashes instead of counts', async ({ page }) => {
    await authenticate(page, 'down');
    await page.goto('/admin/tenants');
    await expect(page.locator('#page-heading:visible')).toContainText('Tenants');
    await expect(page.getByText("Couldn't load tenants")).toBeVisible();
    await expect(page.getByText('The tenant directory could not be loaded. Refresh the page to try again.')).toBeVisible();
    await expect(page.locator('main')).toContainText(/Total Tenants\s*—/);
  });
});
