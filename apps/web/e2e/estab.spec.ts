import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Estab', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/estab');
    await expect(page.getByRole('heading', { name: 'Establishment' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'File Register' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Meetings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fleet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Guest House' })).toBeVisible();
  });

  test('file register shows heading and column headers', async ({ page }) => {
    await page.goto('/estab/list');
    await expect(page.getByRole('heading', { name: 'Digital File Tracking (eOffice)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'File No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Classification' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Created By' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Created Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Current Holder' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('file register shows seeded file FILE-001', async ({ page }) => {
    await page.goto('/estab/list');
    await expect(page.getByRole('cell', { name: 'FILE-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Annual Budget Proposal' })).toBeVisible();
  });

  test('meetings page shows heading and column headers', async ({ page }) => {
    await page.goto('/estab/meetings');
    await expect(page.getByRole('heading', { name: 'Meeting Management' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Meeting No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Time' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Venue' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Chairperson' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Attendees' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('meetings page shows seeded meeting MTG-001', async ({ page }) => {
    await page.goto('/estab/meetings');
    await expect(page.getByRole('cell', { name: 'MTG-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Board Meeting' })).toBeVisible();
  });

  test('vehicle management page shows heading and column headers', async ({ page }) => {
    await page.goto('/estab/vehicles');
    await expect(page.getByRole('heading', { name: 'Vehicle Management' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Vehicle No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Make / Model' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Assigned To' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Driver' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Fuel' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Odometer (km)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Next Service' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('guest house management page shows heading and column headers', async ({ page }) => {
    await page.goto('/estab/guesthouse');
    await expect(page.getByRole('heading', { name: 'Guest House Management' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Booking No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Guest Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Designation' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Check-in' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Check-out' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Room Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Room No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });
});
