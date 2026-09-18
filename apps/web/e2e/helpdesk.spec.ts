import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Helpdesk', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('helpdesk hub page renders navigation tiles', async ({ page }) => {
    await page.goto('/helpdesk');
    await expect(page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible();
    // REL-023 tranche 6: the hub's own tile to /helpdesk/tickets is labelled
    // "All Tickets" (git blame: intentionally renamed 2026-08-13, the same
    // HR Dashboard redesign commit that added "Internal Ops" as a sibling
    // tile) -- "Citizen Tickets" is the destination page's own <h1> (still
    // correct there, see the "tickets list" test below), not this tile's
    // label. The two labels differing by context (nav tile vs. page title)
    // is intentional, not drift.
    await expect(page.getByRole('link', { name: 'All Tickets' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SLA Monitor' })).toBeVisible();
  });

  // ── Tickets list ──────────────────────────────────────────────────────────

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

  // ── Ticket detail ─────────────────────────────────────────────────────────

  test('ticket detail shows Ticket Detail heading', async ({ page }) => {
    await page.goto('/helpdesk/tickets/t0000000-0000-0000-0000-000000000001');
    await expect(page.getByRole('heading', { name: 'Ticket Detail' })).toBeVisible();
  });

  test('ticket detail shows ticket subject', async ({ page }) => {
    await page.goto('/helpdesk/tickets/t0000000-0000-0000-0000-000000000001');
    await expect(page.getByText('Unable to access portal')).toBeVisible();
  });

  test('ticket detail breadcrumb links back to tickets', async ({ page }) => {
    await page.goto('/helpdesk/tickets/t0000000-0000-0000-0000-000000000001');
    // REL-023 tranche 6: two distinct, both-legitimate elements say "Tickets"
    // here -- the layout shell's auto-generated breadcrumb trail and this
    // page's own PageHeader `back` link -- a real (if redundant)
    // navigation-affordance duplication, not a bug in either one. `.first()`
    // disambiguates the presence check; established pattern (tranche 5's
    // "unscoped locators" fixes).
    await expect(page.getByRole('link', { name: 'Tickets' }).first()).toBeVisible();
  });

  test('navigating tickets list → detail shows detail page', async ({ page }) => {
    await page.goto('/helpdesk/tickets');
    await page.getByRole('link', { name: 'TKT-001' }).click();
    await expect(page.getByRole('heading', { name: 'Ticket Detail' })).toBeVisible();
  });

  // ── SLA list ──────────────────────────────────────────────────────────────

  test('SLA list page loads without error', async ({ page }) => {
    await page.goto('/helpdesk/slas');
    await expect(page.getByRole('heading', { level: 1, name: /sla/i })).toBeVisible();
  });
});
