import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Telephony', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('telephony hub shows heading', async ({ page }) => {
    await page.goto('/telephony');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // ── Calls list ────────────────────────────────────────────────────────────

  test('telephony list page shows heading', async ({ page }) => {
    await page.goto('/telephony/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // /telephony/list permanently redirects to /telephony/calls, a client page that reads
  // the call API through the browser-side /api/proxy (which authenticate() stubs with an
  // empty body), so seed that request for the row-level assertions.
  async function seedCalls(page: import('@playwright/test').Page) {
    await page.route('**/api/proxy/v1/telephony/calls*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            id: 'call-001', direction: 'inbound', callerNumber: '+91-9876543210', calleeNumber: '1800',
            status: 'completed', disposition: null, queueId: null, agentId: null, linkedRefType: null,
            linkedRefId: null, hasRecording: false, waitSeconds: 5, talkSeconds: 120, slaAnswered: true,
            abandoned: false, startedAt: '2024-01-01T10:00:00Z', endedAt: '2024-01-01T10:02:00Z',
          }],
        }),
      }),
    );
  }

  test('telephony list shows seeded call record', async ({ page }) => {
    await seedCalls(page);
    await page.goto('/telephony/list');
    // Phone numbers are masked client-side to the last four digits.
    await expect(page.getByText(/\*+3210$/)).toBeVisible();
  });

  test('telephony list shows call status completed', async ({ page }) => {
    await seedCalls(page);
    await page.goto('/telephony/list');
    await expect(page.getByRole('cell', { name: 'completed', exact: true })).toBeVisible();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  test('clicking telephony link from hub navigates to list', async ({ page }) => {
    await page.goto('/telephony');
    const listLink = page.getByRole('link', { name: /call/i }).first();
    if (await listLink.isVisible()) {
      await listLink.click();
      await expect(page.getByRole('heading').first()).toBeVisible();
    }
  });
});
