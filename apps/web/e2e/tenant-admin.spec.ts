import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Tenant Admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('tenant admin page shows Quick Actions section with user management links', async ({ page }) => {
    await page.goto('/tenant-admin');
    await expect(page.getByRole('heading', { name: 'Tenant Administration' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roles' })).toBeVisible();
  });

  test('tenant admin shows service health section', async ({ page }) => {
    await page.goto('/tenant-admin');
    await expect(page.getByRole('heading', { name: 'Service Health' })).toBeVisible();
  });

  test('users page shows user table with email column', async ({ page }) => {
    await page.goto('/tenant-admin/users');
    await expect(page.getByRole('heading', { name: 'Manage Users' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  });

  test('users page shows user from mock API', async ({ page }) => {
    await page.goto('/tenant-admin/users');
    await expect(page.getByText('admin@example.com')).toBeVisible();
  });

  test('roles page shows roles table', async ({ page }) => {
    await page.goto('/tenant-admin/roles');
    await expect(page.getByRole('heading', { name: 'Manage Roles' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
  });

  test('roles page shows role from mock API', async ({ page }) => {
    await page.goto('/tenant-admin/roles');
    await expect(
      page.getByRole('table', { name: 'Tenant roles' }).getByRole('link', { name: 'admin', exact: true }),
    ).toBeVisible();
  });

  test('settings page renders without error', async ({ page }) => {
    await page.goto('/tenant-admin/settings');
    await expect(page.getByRole('heading', { name: /setting/i })).toBeVisible();
  });
});
