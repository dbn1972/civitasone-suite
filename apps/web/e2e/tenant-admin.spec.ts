import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Tenant Admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('tenant admin page shows Quick Navigation section with user management links', async ({ page }) => {
    await page.goto('/tenant-admin');
    await expect(page.getByRole('heading', { name: 'Tenant Administration' })).toBeVisible();
    // REL-023: the hub's narrower "Quick Actions" section was superseded by
    // a full "Quick Navigation" grid covering all 20 tenant-admin sub-pages
    // (not just Users/Roles) — and it's rendered as a plain
    // <div className="sec-h"> label, not a semantic heading, so this can no
    // longer be a getByRole('heading', ...) query. The section's real
    // purpose here (surfacing Users/Roles) is unchanged, just via a bigger
    // menu — checked directly below via the two links.
    await expect(page.getByText('Quick Navigation')).toBeVisible();
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
    // REL-023: the separate "Email"/"Name" columns were merged into one
    // "User" column (avatar initials + name + email together) — see
    // UsersTable.tsx's first column. The email value itself is still
    // rendered (checked in the next test); this just isn't its own
    // column anymore.
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
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
    // REL-023: the email now also appears in the PageHeader subtitle, in
    // addition to the detail field — two matches for the untargeted query.
    await expect(page.getByText('admin@example.com').first()).toBeVisible();
  });

  test('user detail breadcrumb links back to users', async ({ page }) => {
    await page.goto('/tenant-admin/users/u0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
  });

  test('navigating users list → detail shows user detail', async ({ page }) => {
    await page.goto('/tenant-admin/users');
    await page.getByRole('link', { name: 'Admin User' }).click();
    await expect(page.getByText('admin@example.com').first()).toBeVisible();
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
    // REL-023: the row-link's accessible name is "Open admin" (DataTable's
    // "Open <identifying value>" aria-label convention), not "admin" alone —
    // exact:true never matched even before the table itself had no
    // accessible name to scope by. RolesTable now has caption="Tenant roles"
    // (was missing entirely), so the table-scoped query resolves once
    // exact:true is dropped to allow that "Open " prefix.
    await expect(
      page.getByRole('table', { name: 'Tenant roles' }).getByRole('link', { name: 'admin' }),
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
    await page.getByRole('table', { name: 'Tenant roles' }).getByRole('link', { name: 'admin' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  // ── Other pages ───────────────────────────────────────────────────────────

  test('settings page renders without error', async ({ page }) => {
    await page.goto('/tenant-admin/settings');
    await expect(page.getByRole('heading', { name: /setting/i })).toBeVisible();
  });

  test('api keys page loads without error', async ({ page }) => {
    await page.goto('/tenant-admin/api-keys');
    // REL-023: card <h3 id="api-keys-table-heading">API keys</h3> also
    // matches /api key/i now, alongside the page's own <h1>API Keys</h1>.
    await expect(page.getByRole('heading', { name: /api key/i, level: 1 })).toBeVisible();
  });

  test('sessions page loads without error', async ({ page }) => {
    await page.goto('/tenant-admin/sessions');
    // REL-023: card <h3 id="sessions-table-heading">Session log</h3> also
    // matches /session/i now, alongside the page's own <h1>Active
    // Sessions</h1>.
    await expect(page.getByRole('heading', { name: /session/i, level: 1 })).toBeVisible();
  });
});
