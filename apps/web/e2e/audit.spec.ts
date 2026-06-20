import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Audit', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
    await page.goto('/audit');
  });

  test('audit log shows the Event Log section', async ({ page }) => {
    await expect(page.getByText('Event Log')).toBeVisible();
  });

  test('audit log shows actor and action column headers', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Outcome' })).toBeVisible();
  });

  test('audit log shows row from mock API', async ({ page }) => {
    await expect(page.getByRole('cell', { name: 'admin@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'user.login' })).toBeVisible();
  });

  test('audit row renders outcome badge', async ({ page }) => {
    await expect(page.getByText('success')).toBeVisible();
  });
});
