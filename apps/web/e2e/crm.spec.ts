import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('CRM', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('crm dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/crm/dashboard');
    await expect(page.getByText('Leads / Contacts')).toBeVisible();
  });

  // ── Contacts list ─────────────────────────────────────────────────────────

  test('contacts list shows contact name and email from mock', async ({ page }) => {
    await page.goto('/crm/contacts');
    await expect(page.getByRole('heading', { level: 1, name: /contacts/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Anita Desai' })).toBeVisible();
    await expect(page.getByText('anita@example.com')).toBeVisible();
  });

  test('contacts list shows column headers', async ({ page }) => {
    await page.goto('/crm/contacts');
    await expect(page.getByRole('columnheader', { name: /name/i })).toBeVisible();
  });

  // ── Contact detail ────────────────────────────────────────────────────────

  test('contact detail shows Contact Detail heading', async ({ page }) => {
    await page.goto('/crm/contacts/c0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('heading', { name: 'Contact Detail' })).toBeVisible();
  });

  test('contact detail shows contact name', async ({ page }) => {
    await page.goto('/crm/contacts/c0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('heading', { level: 1, name: 'Anita Desai' })).toBeVisible();
  });

  test('contact detail breadcrumb links back to contacts', async ({ page }) => {
    await page.goto('/crm/contacts/c0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('link', { name: 'Contacts' })).toBeVisible();
  });

  test('navigating contacts list → detail shows detail page', async ({ page }) => {
    await page.goto('/crm/contacts');
    await page.getByRole('link', { name: 'Anita Desai' }).click();
    await expect(page.getByRole('heading', { name: 'Contact Detail' })).toBeVisible();
  });

  // ── Deals list ────────────────────────────────────────────────────────────

  test('deals list page loads without error', async ({ page }) => {
    await page.goto('/crm/deals');
    await expect(page.getByRole('heading', { name: /deal pipeline/i })).toBeVisible();
  });

  // ── Activities ────────────────────────────────────────────────────────────

  test('activities page loads without error', async ({ page }) => {
    await page.goto('/crm/activities');
    await expect(page.getByRole('heading', { level: 1, name: /activit/i })).toBeVisible();
  });
});
