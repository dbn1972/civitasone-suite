import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Legal', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/legal');
    await expect(page.locator('a[href="/legal/list"]')).toBeVisible();
    await expect(page.locator('a[href="/legal/hearings"]')).toBeVisible();
    await expect(page.locator('a[href="/legal/court-orders"]')).toBeVisible();
    await expect(page.locator('a[href="/legal/opinions"]')).toBeVisible();
  });

  test('legal cases list shows heading and column headers', async ({ page }) => {
    await page.goto('/legal/list');
    await expect(page.getByRole('heading', { name: 'Legal Cases' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Case No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Court' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Filed Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Petitioner' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Respondent' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Advocate' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Next Hearing' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('legal cases list shows seeded case CASE-001', async ({ page }) => {
    await page.goto('/legal/list');
    await expect(page.getByRole('cell', { name: 'CASE-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'State v. ABC Construction' })).toBeVisible();
  });

  test('hearings page shows heading and column headers', async ({ page }) => {
    await page.goto('/legal/hearings');
    await expect(page.getByRole('heading', { name: 'Hearings' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Case No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Case Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Court' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Date', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Time' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Purpose' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Outcome' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Next Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('legal opinions page shows heading and column headers', async ({ page }) => {
    await page.goto('/legal/opinions');
    await expect(page.getByRole('heading', { name: 'Legal Opinions' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Opinion No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Requested By' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Request Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Due Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Advisor' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Issued Date' })).toBeVisible();
  });
});
