import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// /developer-portal reads GET /v1/admin/api-keys (the default mock holds none; the 'keys' scenario holds two).
test.describe('Developer portal', () => {
  test('shows the heading, the zero key counts and the capability roadmap', async ({ page }) => {
    await authenticate(page);
    await page.goto('/developer-portal');
    await expect(page.locator('#page-heading:visible')).toContainText('Developer Portal');
    await expect(page.getByText('API access, reference docs, plugin SDK guidance and environment diagnostics.')).toBeVisible();
    const main = page.locator('main');
    await expect(main).toContainText(/API keys issued\s*0/);
    await expect(main).toContainText(/Active keys\s*0/);
    const roadmap = page.getByRole('list', { name: 'Platform roadmap summary' });
    await expect(roadmap).toContainText('1 available');
    await expect(roadmap).toContainText('3 in preview');
    await expect(roadmap).toContainText('2 planned');
  });

  test('lists all six platform capabilities with their status', async ({ page }) => {
    await authenticate(page);
    await page.goto('/developer-portal');
    const caps = page.getByRole('list', { name: 'Developer platform capabilities' }).getByRole('listitem');
    await expect(caps).toHaveCount(6);
    for (const title of ['API Keys', 'API Reference', 'Plugin SDK', 'Webhooks', 'Sandbox & Test Tenant', 'Environment Diagnostics']) {
      await expect(caps.filter({ has: page.getByRole('heading', { name: title }) })).toHaveCount(1);
    }
    await expect(caps.filter({ hasText: 'API Keys' }).first()).toContainText('Available');
    await expect(caps.filter({ hasText: 'Plugin SDK' })).toContainText('Planned');
    await expect(caps.filter({ hasText: 'Webhooks' })).toContainText('Preview');
  });

  test('available capabilities link to their management surface', async ({ page }) => {
    await authenticate(page);
    await page.goto('/developer-portal');
    await expect(page.getByRole('link', { name: 'Manage API keys' }).first()).toHaveAttribute('href', '/tenant-admin/api-keys');
    await expect(page.getByRole('link', { name: 'Open API reference' })).toHaveAttribute('href', '/docs/api');
    await expect(page.getByRole('link', { name: 'Open demo sandbox' })).toHaveAttribute('href', '/sandbox');
    // Planned capabilities without a surface offer no link.
    await expect(page.getByRole('listitem').filter({ hasText: 'Plugin SDK' }).getByRole('link')).toHaveCount(0);
  });

  test('Manage API keys navigates to the tenant API key console', async ({ page }) => {
    await authenticate(page);
    await page.goto('/developer-portal');
    await page.getByRole('link', { name: 'Manage API keys' }).first().click();
    await expect(page).toHaveURL(/\/tenant-admin\/api-keys/);
  });

  test('issued keys are summarised and listed with their prefix and status', async ({ page }) => {
    await authenticate(page, 'keys');
    await page.goto('/developer-portal');
    const main = page.locator('main');
    await expect(main).toContainText(/API keys issued\s*2/);
    await expect(main).toContainText(/Active keys\s*1/);
    await expect(page.getByText('Recently issued API keys')).toBeVisible();
    const payroll = page.getByRole('listitem').filter({ hasText: 'Payroll integration' });
    await expect(payroll).toContainText('cvo_live_a1b2••••••••');
    await expect(payroll).toContainText('Active');
    const legacy = page.getByRole('listitem').filter({ hasText: 'Legacy reporting feed' });
    await expect(legacy).toContainText('cvo_live_c3d4••••••••');
    await expect(legacy).toContainText('Expired');
  });

  test('a failed key load shows a retry state instead of 0 keys, and keeps the roadmap', async ({ page }) => {
    await authenticate(page, 'down');
    await page.goto('/developer-portal');
    await expect(page.locator('#page-heading:visible')).toContainText('Developer Portal');
    await expect(page.getByText("We couldn't load API keys.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('API keys issued')).toHaveCount(0);
    await expect(page.getByText('Recently issued API keys')).toHaveCount(0);
    // The static roadmap does not depend on the key store.
    await expect(page.getByRole('list', { name: 'Developer platform capabilities' }).getByRole('listitem')).toHaveCount(6);
  });
});
