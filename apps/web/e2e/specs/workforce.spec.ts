import { test, expect } from '@playwright/test';
import { authenticate } from '../helpers/auth';

/**
 * E2E — HRMS Workforce Operations (Sprint 20 · Story S16)
 *
 * Covers: org chart (tree rendering + keyboard nav), WFH request list,
 * WFH request form, overtime list, overtime claim form, shift definitions,
 * and staffing plan.
 *
 * Auth: authenticate() sets civitasone_at cookie with an all-roles JWT so
 * every role-guarded layout passes without a redirect to /auth/login.
 */

test.describe('Workforce Operations — S16', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── 1. Org Chart ──────────────────────────────────────────────────────────

  test.describe('Org Chart (/hr/org-chart)', () => {
    test('renders page heading and employee stat tile', async ({ page }) => {
      await page.goto('/hr/org-chart');
      await expect(
        page.getByRole('heading', { name: 'Organisation Chart' }),
      ).toBeVisible();
      await expect(page.getByText('Total Employees')).toBeVisible();
    });

    test('org tree renders with at least one treeitem visible', async ({ page }) => {
      await page.goto('/hr/org-chart');
      const tree = page.getByRole('tree', { name: 'Organisation hierarchy' });
      await expect(tree).toBeVisible();
      await expect(tree.getByRole('treeitem').first()).toBeVisible();
    });

    test('keyboard nav: first treeitem carries tabindex="0"', async ({ page }) => {
      await page.goto('/hr/org-chart');
      const tree = page.getByRole('tree', { name: 'Organisation hierarchy' });
      await expect(tree).toBeVisible();
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

    test('"New WFH Request" card is visible on the list page', async ({ page }) => {
      await page.goto('/hr/workforce/wfh');
      await expect(page.getByText('New WFH Request')).toBeVisible();
    });

    test('request data-table renders Employee and Status column headers', async ({
      page,
    }) => {
      await page.goto('/hr/workforce/wfh');
      await expect(page.getByRole('columnheader', { name: 'Employee' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    });
  });

  // ── 3. WFH New Request Form ───────────────────────────────────────────────
  //
  // The WFHRequestForm is rendered inline on the list page (/hr/workforce/wfh).
  // When a dedicated /wfh/new route exists it must also expose the same form;
  // this block tests the form whether accessed directly or embedded.

  test.describe('WFH New Request Form (/hr/workforce/wfh/new)', () => {
    test('form is accessible via the list page with employee selector and date pickers', async ({
      page,
    }) => {
      await page.goto('/hr/workforce/wfh');
      const form = page.getByRole('form', { name: 'Work-From-Home request form' });
      await expect(form).toBeVisible();
      await expect(form.getByLabel('Employee ID (UUID)')).toBeVisible();
      await expect(form.getByLabel(/From Date/)).toBeVisible();
      await expect(form.getByLabel(/To Date/)).toBeVisible();
    });

    test('dedicated /wfh/new route renders the WFH request form', async ({ page }) => {
      await page.goto('/hr/workforce/wfh/new');
      // Standalone page or redirect to list — the WFH form must be present.
      const form = page.getByRole('form', { name: 'Work-From-Home request form' });
      await expect(form).toBeVisible();
      await expect(form.getByLabel('Employee ID (UUID)')).toBeVisible();
      await expect(form.getByLabel(/From Date/)).toBeVisible();
      await expect(form.getByLabel(/To Date/)).toBeVisible();
    });
  });

  // ── 4. Overtime Request List ──────────────────────────────────────────────

  test.describe('Overtime Requests (/hr/workforce/overtime)', () => {
    test('page heading "Overtime Requests" is visible', async ({ page }) => {
      await page.goto('/hr/workforce/overtime');
      await expect(
        page.getByRole('heading', { name: 'Overtime Requests' }),
      ).toBeVisible();
    });

    test('overtime data-table renders Employee and Status column headers', async ({
      page,
    }) => {
      await page.goto('/hr/workforce/overtime');
      await expect(page.getByRole('columnheader', { name: 'Employee' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    });

    test('"+ New Request" link is visible and points to /overtime/new', async ({
      page,
    }) => {
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
      const form = page.getByRole('form', { name: 'Overtime claim form' });
      await expect(form).toBeVisible();
      await expect(form.getByLabel(/Employee ID/i)).toBeVisible();
      await expect(form.getByLabel(/Date of Overtime/i)).toBeVisible();
      await expect(form.getByLabel(/Hours Worked OT/i)).toBeVisible();
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

    test('shift cards section is rendered', async ({ page }) => {
      await page.goto('/hr/shifts');
      const shiftCards = page.getByRole('region', { name: 'Shift cards' });
      await expect(shiftCards).toBeVisible();
    });

    test('at least one shift card is visible (GoI standard shifts seeded)', async ({
      page,
    }) => {
      await page.goto('/hr/shifts');
      // "General Duty" is part of the DoPT standard shift seed (09:00-17:30 Mon-Fri)
      await expect(page.getByText('General Duty')).toBeVisible();
    });

    test('shift table renders with Shift Name column header', async ({ page }) => {
      await page.goto('/hr/shifts');
      await expect(
        page.getByRole('columnheader', { name: 'Shift Name' }),
      ).toBeVisible();
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

    test('staffing plan stat tiles render sanctioned and filled counts', async ({
      page,
    }) => {
      await page.goto('/hr/workforce/staffing-plan');
      await expect(page.getByText('Sanctioned Posts')).toBeVisible();
      await expect(page.getByText('Filled Positions')).toBeVisible();
    });

    test('staffing plan table renders Department and Filled column headers', async ({
      page,
    }) => {
      await page.goto('/hr/workforce/staffing-plan');
      await expect(
        page.getByRole('columnheader', { name: /Department/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('columnheader', { name: 'Filled' }),
      ).toBeVisible();
    });
  });
});
