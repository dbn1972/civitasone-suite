import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Tenant Admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

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

  // ── Users list ────────────────────────────────────────────────────────────

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

  // ── User detail ───────────────────────────────────────────────────────────

  test('user detail shows heading', async ({ page }) => {
    await page.goto('/tenant-admin/users/u0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('user detail shows email', async ({ page }) => {
    await page.goto('/tenant-admin/users/u0000000-0000-0000-0000-000000000001');
    await expect(page.getByText('admin@example.com')).toBeVisible();
  });

  test('user detail breadcrumb links back to users', async ({ page }) => {
    await page.goto('/tenant-admin/users/u0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
  });

  test('navigating users list → detail shows user detail', async ({ page }) => {
    await page.goto('/tenant-admin/users');
    await page.getByRole('link', { name: 'Admin User' }).click();
    await expect(page.getByText('admin@example.com')).toBeVisible();
  });

  // ── Roles list ────────────────────────────────────────────────────────────

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

  // ── Role detail ───────────────────────────────────────────────────────────

  test('role detail shows heading', async ({ page }) => {
    await page.goto('/tenant-admin/roles/r0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('role detail shows role name', async ({ page }) => {
    await page.goto('/tenant-admin/roles/r0000000-0000-0000-0000-000000000001');
    await expect(page.getByText('admin').first()).toBeVisible();
  });

  test('navigating roles list → detail shows role detail', async ({ page }) => {
    await page.goto('/tenant-admin/roles');
    await page.getByRole('table', { name: 'Tenant roles' }).getByRole('link', { name: 'admin', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  // ── Other pages ───────────────────────────────────────────────────────────

  test('settings page renders without error', async ({ page }) => {
    await page.goto('/tenant-admin/settings');
    await expect(page.getByRole('heading', { name: /setting/i })).toBeVisible();
  });

  test('api keys page loads without error', async ({ page }) => {
    await page.goto('/tenant-admin/api-keys');
    await expect(page.getByRole('heading', { name: /api key/i })).toBeVisible();
  });

  test('sessions page loads without error', async ({ page }) => {
    await page.goto('/tenant-admin/sessions');
    await expect(page.getByRole('heading', { name: /session/i })).toBeVisible();
  });
});
