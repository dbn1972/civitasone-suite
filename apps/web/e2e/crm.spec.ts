import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('CRM', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('contacts list shows contact name and email', async ({ page }) => {
    await page.goto('/crm/contacts');
    await expect(page.getByRole('heading', { name: /contacts/i })).toBeVisible();
    await expect(page.getByText('Anita Desai')).toBeVisible();
    await expect(page.getByText('anita@example.com')).toBeVisible();
  });

  test('contacts list shows column headers', async ({ page }) => {
    await page.goto('/crm/contacts');
    await expect(page.getByRole('columnheader', { name: /name/i })).toBeVisible();
  });

  test('deals list page loads without error', async ({ page }) => {
    await page.goto('/crm/deals');
    await expect(page.getByRole('heading', { name: /deal pipeline/i })).toBeVisible();
  });

  test('activities page loads without error', async ({ page }) => {
    await page.goto('/crm/activities');
    await expect(page.getByRole('heading', { name: /activit/i })).toBeVisible();
  });
});
