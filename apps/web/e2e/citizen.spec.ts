import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Citizen', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('citizen hub shows heading and navigation links', async ({ page }) => {
    await page.goto('/citizen');
    await expect(page.getByRole('heading', { name: 'Citizen Services' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'RTI Applications' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Feedback' })).toBeVisible();
  });

  test('citizen hub nav links point to correct hrefs', async ({ page }) => {
    await page.goto('/citizen');
    await expect(page.getByRole('link', { name: 'Service Requests' })).toHaveAttribute('href', '/citizen/requests');
    await expect(page.getByRole('link', { name: 'RTI Applications' })).toHaveAttribute('href', '/citizen/rti');
  });

  test('service requests page shows heading and column headers', async ({ page }) => {
    await page.goto('/citizen/requests');
    await expect(page.getByRole('heading', { name: 'Citizen Service Requests' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Request No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Service Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Citizen Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Phone' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Submitted' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('service requests page shows seeded request data', async ({ page }) => {
    await page.goto('/citizen/requests');
    await expect(page.getByRole('cell', { name: 'REQ-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Birth Certificate' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Ramesh Kumar' })).toBeVisible();
  });

  test('RTI applications page shows heading and column headers', async ({ page }) => {
    await page.goto('/citizen/rti');
    await expect(page.getByRole('heading', { name: 'RTI Applications' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'RTI No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Applicant' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Public Authority' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Filed' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Deadline' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '1st Appeal?' })).toBeVisible();
  });

  test('RTI applications page shows seeded application data', async ({ page }) => {
    await page.goto('/citizen/rti');
    await expect(page.getByRole('cell', { name: 'RTI-001' })).toBeVisible();
  });
});
