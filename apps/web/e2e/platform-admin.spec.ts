import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// /platform-admin is the tenant-level administration segment (roles, users, audit log, org
// hierarchy, tenant config). Data comes from admin-service, identity-service and audit-service.
test.describe('Platform admin', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('home derives its tiles from live data and links the six sections', async ({ page }) => {
    await page.goto('/platform-admin');
    await expect(page.locator('#page-heading:visible')).toContainText('Platform Administration');
    const main = page.locator('main');
    await expect(main).toContainText(/Org Levels\s*3/);
    await expect(main).toContainText(/Platform Roles\s*4/);
    await expect(main).toContainText(/Latest audit event\s*22 Oct 2026, 11:35 am/);
    const sections: Array<[string, string]> = [
      ['System Settings', '/platform-admin/system-settings'],
      ['Org Configuration', '/platform-admin/org-config'],
      ['Audit Log', '/platform-admin/audit-log'],
      ['Roles & Permissions', '/platform-admin/roles'],
      ['User Management', '/platform-admin/users'],
      ['Tenant Config', '/platform-admin/tenant-config'],
    ];
    for (const [label, href] of sections) {
      await expect(main.getByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', href);
    }
  });

  test('a section tile opens that section', async ({ page }) => {
    await page.goto('/platform-admin');
    await page.locator('main').getByRole('link', { name: /Tenant Config/ }).click();
    await expect(page).toHaveURL(/\/platform-admin\/tenant-config/);
    await expect(page.locator('#page-heading:visible')).toContainText('Tenant Configuration');
  });

  test('roles matrix is built from the real role and permission catalogue', async ({ page }) => {
    await page.goto('/platform-admin/roles');
    await expect(page.locator('#page-heading:visible')).toContainText('Roles & Permissions');
    const main = page.locator('main');
    await expect(main).toContainText(/Platform roles\s*4/);
    await expect(main).toContainText('4 roles · 2 modules · 4 actions');
    for (const role of ['Super Admin', 'Tenant Admin', 'HR Officer', 'Records Clerk']) {
      await expect(main).toContainText(role);
    }
    await expect(main).toContainText('System — read-only');
    await expect(main).toContainText('Journal.create');
    await expect(main).toContainText('Leave.approve');
  });

  test('users show roles, last login and MFA for each person', async ({ page }) => {
    await page.goto('/platform-admin/users');
    await expect(page.locator('#page-heading:visible')).toContainText('User Management');
    const main = page.locator('main');
    await expect(main).toContainText(/Total users\s*1/);
    await expect(main).toContainText(/MFA enabled\s*1/);
    const admin = page.getByRole('row', { name: /Admin User/ });
    await expect(admin).toContainText('admin@example.com');
    await expect(admin).toContainText('01 Jan 2024');
    await expect(admin).toContainText('MFA on');
    await expect(admin).toContainText('Active');
    await expect(admin.getByRole('button', { name: /Suspend/ })).toBeVisible();
  });

  test('the status filter and search hide people who do not match', async ({ page }) => {
    await page.goto('/platform-admin/users');
    await expect(page.getByRole('row', { name: /Admin User/ })).toBeVisible();
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: 'Suspended' });
    await expect(page.getByRole('row', { name: /Admin User/ })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: 'Active' });
    await expect(page.getByRole('row', { name: /Admin User/ })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search users' }).fill('nobody-by-this-name');
    await expect(page.getByRole('row', { name: /Admin User/ })).toHaveCount(0);
  });

  test('audit log shows the stats and every event with its outcome', async ({ page }) => {
    await page.goto('/platform-admin/audit-log');
    await expect(page.locator('#page-heading:visible')).toContainText('Platform Audit Log');
    const main = page.locator('main');
    await expect(main).toContainText(/Success\s*2/);
    await expect(main).toContainText(/Failures\s*1/);
    await expect(main).toContainText(/Unique actors\s*3/);
    await expect(main).toContainText('3 events');
    const update = page.getByRole('row', { name: /role\.permissions\.updated/ });
    await expect(update).toContainText('asha.verma@example.gov.in');
    await expect(update).toContainText('role:hr_officer');
    await expect(update).toContainText('10.20.30.40');
    await expect(update).toContainText('Success');
    await expect(page.getByRole('row', { name: /user\.suspend/ })).toContainText('Failure');
  });

  test('the outcome filter keeps only the failed events', async ({ page }) => {
    await page.goto('/platform-admin/audit-log');
    await page.getByLabel('Outcome').selectOption({ label: 'Failure' });
    await expect(page.getByRole('row', { name: /user\.suspend/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /role\.permissions\.updated/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /tenant\.config\.read/ })).toHaveCount(0);
  });

  test('org configuration lists the hierarchy and previews the reporting chain', async ({ page }) => {
    await page.goto('/platform-admin/org-config');
    await expect(page.locator('#page-heading:visible')).toContainText('Organisation Configuration');
    await expect(page.getByText('Reporting hierarchy — Ministry → Department → Section.')).toBeVisible();
    const main = page.locator('main');
    await expect(main).toContainText(/Hierarchy levels\s*3/);
    await expect(main).toContainText(/Top level\s*Ministry/);
    await expect(main).toContainText(/Lowest level\s*Section/);
    const dept = page.getByRole('row', { name: /Department/ });
    await expect(dept).toContainText('L2');
    await expect(dept).toContainText('Executes ministry policy');
    await expect(dept).toContainText('Department of Revenue');
    await expect(page.getByText('Reporting chain preview')).toBeVisible();
  });

  test('org configuration with no levels says none are configured', async ({ page }) => {
    await authenticate(page, 'empty');
    await page.goto('/platform-admin/org-config');
    await expect(page.locator('#page-heading:visible')).toContainText('Organisation Configuration');
    await expect(page.getByText('No hierarchy levels are configured yet.')).toBeVisible();
    await expect(page.getByText('No hierarchy levels configured yet.')).toBeVisible();
    await expect(page.locator('main')).toContainText(/Hierarchy levels\s*0/);
  });

  test('tenant config shows identity, infrastructure, storage and licence', async ({ page }) => {
    await page.goto('/platform-admin/tenant-config');
    await expect(page.locator('#page-heading:visible')).toContainText('Tenant Configuration');
    const main = page.locator('main');
    await expect(main).toContainText('Directorate of Digital Services');
    await expect(main).toContainText('dds.gov.in');
    await expect(main).toContainText('tenant_dds');
    await expect(main).toContainText('civitasone-dds');
    await expect(main).toContainText('640 GB used of 2000 GB (32%)');
    await expect(main).toContainText('Government Enterprise');
    await expect(main).toContainText('31 Mar 2031');
    await expect(main).toContainText(/Licensed seats\s*500/);
  });

  test('a failed audit log load shows a retry state, not an empty trail', async ({ page }) => {
    await authenticate(page, 'down');
    await page.goto('/platform-admin/audit-log');
    await expect(page.locator('#page-heading:visible')).toContainText('Platform Audit Log');
    await expect(page.getByText("We couldn't load audit log.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Timestamp' })).toHaveCount(0);
    await expect(page.getByText('3 events')).toHaveCount(0);
  });
});
