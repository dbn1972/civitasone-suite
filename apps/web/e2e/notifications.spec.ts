import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('notifications hub shows heading', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // ── Notifications list ────────────────────────────────────────────────────

  test('notifications list page shows Notifications heading', async ({ page }) => {
    await page.goto('/notifications/list');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  });

  test('notifications list shows stat cards Total and Sent', async ({ page }) => {
    await page.goto('/notifications/list');
    await expect(page.getByText('Total')).toBeVisible();
    await expect(page.getByText('Sent')).toBeVisible();
  });

  test('notifications list shows table column headers', async ({ page }) => {
    await page.goto('/notifications/list');
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Channel' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('notifications list shows seeded notification Bill Approved', async ({ page }) => {
    await page.goto('/notifications/list');
    await expect(page.getByText('Bill Approved')).toBeVisible();
  });

  test('notifications list shows recipient email', async ({ page }) => {
    await page.goto('/notifications/list');
    await expect(page.getByText('admin@example.com')).toBeVisible();
  });

  // ── Deliveries ────────────────────────────────────────────────────────────

  test('notification deliveries page loads without error', async ({ page }) => {
    await page.goto('/notifications/deliveries');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
