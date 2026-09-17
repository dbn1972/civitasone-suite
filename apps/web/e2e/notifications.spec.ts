import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
    // authenticate()'s blanket `**/api/proxy/**` stub (added to silence one
    // specific noisy call -- SyncProvider's POST to
    // /api/proxy/v1/devices/register) also intercepts this page's OWN
    // legitimate client-side GET read (useOfflineResource -> GET
    // /api/proxy/notification/notifications), returning `{}` instead of the
    // seeded fixture -- the page then correctly renders its real "no
    // notifications yet" empty state for what is, from its point of view, a
    // genuinely empty response. Route registered after authenticate() runs
    // first (Playwright matches the most-recently-registered handler first),
    // so this overrides the stub for this one path without touching the
    // shared helper other pages/specs also rely on.
    await page.route('**/api/proxy/notification/notifications', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'notif-001',
            title: 'Bill Approved',
            message: 'Your bill PAY-001 has been approved.',
            module: 'finance',
            eventType: 'bill.approved',
            recipient: 'admin@example.com',
            channel: 'email',
            status: 'sent',
            createdAt: '2024-01-15T10:00:00Z',
          },
        ]),
      }),
    );
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('notifications hub shows heading', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // ── Notifications list ────────────────────────────────────────────────────

  test('notifications list page shows Notifications heading', async ({ page }) => {
    await page.goto('/notifications/list');
    // level: 1 -- a card <h3> ("Notifications") and, while the client-side
    // useOfflineResource fetch is still in flight, a transient loading <h4>
    // ("Loading notifications…") both also match a loose name search.
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
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
