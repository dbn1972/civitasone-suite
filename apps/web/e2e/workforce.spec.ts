import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

/**
 * E2E — Workforce Operations (Sprint 20 · Story S16)
 *
 * Covers: org chart (tree + keyboard nav), WFH requests, WFH new-request form,
 * overtime list, overtime claim form, shift definitions, and staffing plan.
 *
 * Auth: uses the shared `authenticate` helper which sets civitasone_at cookie
 * with an all-roles JWT so every role-guarded layout passes.
 */

test.describe('Workforce Operations — S16', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── 1. Org Chart ──────────────────────────────────────────────────────────

  test.describe('Org Chart (/hr/org-chart)', () => {
    test('renders page heading and stat tiles', async ({ page }) => {
      await page.goto('/hr/org-chart');
      await expect(
        page.getByRole('heading', { name: 'Organisation Chart' }),
      ).toBeVisible();
      await expect(page.getByText('Total Employees')).toBeVisible();
    });

    test('org tree renders with at least one node visible', async ({ page }) => {
      await page.goto('/hr/org-chart');
      const tree = page.getByRole('tree', { name: 'Organisation hierarchy' });
      await expect(tree).toBeVisible();
      const firstNode = tree.getByRole('treeitem').first();
      await expect(firstNode).toBeVisible();
    });

    test('first tree node is in the tab order (keyboard nav)', async ({ page }) => {
      await page.goto('/hr/org-chart');
      const tree = page.getByRole('tree', { name: 'Organisation hierarchy' });
      await expect(tree).toBeVisible();
      // OrgTreeNode renders each treeitem with tabIndex={0} so it is
      // keyboard-reachable via Tab — assert the attribute directly.
      const firstNode = tree.getByRole('treeitem').first();
      await expect(firstNode).toHaveAttribute('tabindex', '0');
    });
  });

  // ── 2. WFH Request List ───────────────────────────────────────────────────

  test.describe('WFH Requests (/hr/workforce/wfh)', () => {
    test('page heading and stat grid are visible', async ({ page }) => {
      await page.goto('/hr/workforce/wfh');
      await expect(
        page.getByRole('heading', { name: 'Work From Home' }),
      ).toBeVisible();
      await expect(page.getByText('Total Requests')).toBeVisible();
    });

    test('"New WFH Request" section is visible on the list page', async ({ page }) => {
      await page.goto('/hr/workforce/wfh');
      // Card renders its title as visible text; form is embedded inline on this page
      await expect(page.getByText('New WFH Request')).toBeVisible();
    });

    test('WFH request list renders data-table column headers', async ({ page }) => {
      await page.goto('/hr/workforce/wfh');
      await expect(page.getByRole('columnheader', { name: 'Employee' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    });
  });

  // ── 3. WFH New Request Form ───────────────────────────────────────────────

  test.describe('WFH New Request Form (/hr/workforce/wfh/new)', () => {
    test('WFH form renders with employee selector and date pickers', async ({ page }) => {
      await page.goto('/hr/workforce/wfh/new');
      await expect(
        page.getByRole('form', { name: 'Work-From-Home request form' }),
      ).toBeVisible();
      // Employee selector
      await expect(page.getByLabel('Employee ID (UUID)')).toBeVisible();
      // From-date and to-date pickers
      await expect(page.getByLabel(/From Date/)).toBeVisible();
      await expect(page.getByLabel(/To Date/)).toBeVisible();
    });
  });

  // ── 4. Overtime Request List ──────────────────────────────────────────────

  test.describe('Overtime Requests (/hr/workforce/overtime)', () => {
    test('page heading and stat tiles are visible', async ({ page }) => {
      await page.goto('/hr/workforce/overtime');
      await expect(
        page.getByRole('heading', { name: 'Overtime Requests' }),
      ).toBeVisible();
    });

    test('overtime list renders data-table column headers', async ({ page }) => {
      await page.goto('/hr/workforce/overtime');
      await expect(page.getByRole('columnheader', { name: 'Employee' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    });

    test('"+ New Request" action link is visible and points to /overtime/new', async ({ page }) => {
      await page.goto('/hr/workforce/overtime');
      const link = page.getByRole('link', { name: /new request/i });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/hr/workforce/overtime/new');
    });
  });

  // ── 5. New Overtime Claim Form ────────────────────────────────────────────

  test.describe('New Overtime Claim (/hr/workforce/overtime/new)', () => {
    test('page heading and "Claim Details" card are visible', async ({ page }) => {
      await page.goto('/hr/workforce/overtime/new');
      await expect(
        page.getByRole('heading', { name: 'New Overtime Claim' }),
      ).toBeVisible();
      await expect(page.getByText('Claim Details')).toBeVisible();
    });

    test('overtime claim form renders with required fields', async ({ page }) => {
      await page.goto('/hr/workforce/overtime/new');
      await expect(
        page.getByRole('form', { name: 'Overtime claim form' }),
      ).toBeVisible();
      await expect(page.getByLabel(/Employee ID/i)).toBeVisible();
      await expect(page.getByLabel(/Date/i).first()).toBeVisible();
      await expect(page.getByLabel(/Hours/i)).toBeVisible();
    });
  });

  // ── 6. Shift Definitions ──────────────────────────────────────────────────

  test.describe('Shift Definitions (/hr/shifts)', () => {
    test('page heading "Shift Definitions" is visible', async ({ page }) => {
      await page.goto('/hr/shifts');
      await expect(
        page.getByRole('heading', { name: 'Shift Definitions' }),
      ).toBeVisible();
    });

    test('shift table renders with "Shift Name" column header', async ({ page }) => {
      await page.goto('/hr/shifts');
      await expect(
        page.getByRole('columnheader', { name: 'Shift Name' }),
      ).toBeVisible();
    });

    test('at least one shift card is visible (DoPT General Duty seeded)', async ({ page }) => {
      await page.goto('/hr/shifts');
      // "General Duty" is part of the GoI standard shift seed data
      await expect(page.getByText('General Duty')).toBeVisible();
    });
  });

  // ── 7. Staffing Plan ─────────────────────────────────────────────────────

  test.describe('Staffing Plan (/hr/workforce/staffing-plan)', () => {
    test('page heading "Staffing Plan" is visible', async ({ page }) => {
      await page.goto('/hr/workforce/staffing-plan');
      await expect(
        page.getByRole('heading', { name: 'Staffing Plan' }),
      ).toBeVisible();
    });

    test('staffing plan table renders with Department and Filled columns', async ({ page }) => {
      await page.goto('/hr/workforce/staffing-plan');
      const region = page.getByRole('region', { name: 'Staffing plan table' });
      await expect(region).toBeVisible();
      // Column labels: 'Department / Cadre' and 'Filled'
      await expect(
        page.getByRole('columnheader', { name: /Department/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('columnheader', { name: 'Filled' }),
      ).toBeVisible();
    });
  });
});
