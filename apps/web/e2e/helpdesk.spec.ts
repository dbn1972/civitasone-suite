import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Helpdesk', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('helpdesk hub page renders navigation tiles', async ({ page }) => {
    await page.goto('/helpdesk');
    await expect(page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Citizen Tickets' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SLA Monitor' })).toBeVisible();
  });

  test('tickets list shows ticket table columns', async ({ page }) => {
    await page.goto('/helpdesk/tickets');
    await expect(page.getByRole('heading', { name: 'Citizen Tickets' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Ticket No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
  });

  test('tickets list shows ticket from mock API', async ({ page }) => {
    await page.goto('/helpdesk/tickets');
    await expect(page.getByRole('link', { name: 'TKT-001' })).toBeVisible();
    await expect(page.getByText('Unable to access portal')).toBeVisible();
  });

  test('SLA list page loads without error', async ({ page }) => {
    await page.goto('/helpdesk/slas');
    await expect(page.getByRole('heading', { name: /sla/i })).toBeVisible();
  });
});
