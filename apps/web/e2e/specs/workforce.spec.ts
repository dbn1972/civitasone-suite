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
    test('form is accessible via the list page with date pickers', async ({
      page,
    }) => {
      await page.goto('/hr/workforce/wfh');
      const form = page.getByRole('form', { name: 'Work From Home request form' });
      await expect(form).toBeVisible();
      // No employee-selector assertion here: this account resolves to a
      // linked self-service profile (no roster access in this fixture data),
      // so WFHRequestForm renders its picker-free, prefilled-employeeId path
      // and never shows the "Employee ID (UUID)" control at all.
      await expect(form.getByLabel(/From Date/)).toBeVisible();
      await expect(form.getByLabel(/To Date/)).toBeVisible();
    });

    test('dedicated /wfh/new route renders the WFH request form', async ({ page }) => {
      await page.goto('/hr/workforce/wfh/new');
      // Standalone page or redirect to list — the WFH form must be present.
      const form = page.getByRole('form', { name: 'Work From Home request form' });
      await expect(form).toBeVisible();
      await expect(form.getByLabel(/From Date/)).toBeVisible();
      await expect(form.getByLabel(/To Date/)).toBeVisible();
    });
  });

  // ── 4. Overtime Request List ──────────────────────────────────────────────

  test.describe('Overtime Requests (/hr/workforce/overtime)', () => {
    test('page heading "Overtime Requests" is visible', async ({ page }) => {
      await page.goto('/hr/workforce/overtime');
      // exact: true -- the canonical page also has an "All Overtime Requests"
      // card heading, which a plain substring match would ambiguously match too.
      await expect(
        page.getByRole('heading', { name: 'Overtime Requests', exact: true }),
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
      // /hr/workforce/overtime now redirects here (canonical /hr/overtime), and
      // its own "+ New Request" link points at the canonical /hr/overtime/new,
      // not the retired /hr/workforce/overtime/new.
      await expect(link).toHaveAttribute('href', '/hr/overtime/new');
    });
  });

  // ── 5. New Overtime Claim Form ────────────────────────────────────────────

  test.describe('New Overtime Claim (/hr/workforce/overtime/new)', () => {
    // /hr/workforce/overtime/new redirects to the canonical /hr/overtime/new,
    // which was already its own separate (older, simpler) implementation --
    // not the retired orphan's OvertimeClaimForm -- so it has its own heading,
    // card title, and an unlabelled <form> (no accessible "form" landmark).
    test('page heading and "Request Details" card are visible', async ({ page }) => {
      await page.goto('/hr/workforce/overtime/new');
      await expect(
        page.getByRole('heading', { name: 'New Overtime Request' }),
      ).toBeVisible();
      await expect(page.getByText('Request Details')).toBeVisible();
    });

    test('overtime request form renders with required fields', async ({ page }) => {
      await page.goto('/hr/workforce/overtime/new');
      // The canonical page's <form> has no aria-label, so it isn't exposed
      // with an accessible "form" role -- assert the labelled fields directly,
      // using this page's real copy ("Date of Overtime" / "Hours Requested",
      // not the orphan's "Hours Worked OT").
      await expect(page.getByLabel(/Employee ID/i)).toBeVisible();
      await expect(page.getByLabel(/Date of Overtime/i)).toBeVisible();
      await expect(page.getByLabel(/Hours Requested/i)).toBeVisible();
    });
  });

  // ── 6. Shift Definitions ──────────────────────────────────────────────────

  test.describe('Shift Definitions (/hr/shifts)', () => {
    test('page heading "Shift Definitions" is visible', async ({ page }) => {
      await page.goto('/hr/shifts');
      await expect(
        page.getByRole('heading', { name: 'Shift Definitions', exact: true }),
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
      // Fixture data intentionally appears twice (the shift-cards preview AND
      // the full table below it) -- scope to the cards region so this only
      // asserts the card, not an ambiguous whole-page text match.
      await expect(
        page.getByRole('region', { name: 'Shift cards' }).getByText('General Duty'),
      ).toBeVisible();
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
      await expect(page.getByText('Sanctioned Posts', { exact: true })).toBeVisible();
      // Canonical page's stat label is "Filled" (statFilledLabel), not the
      // orphan's "Filled Positions" -- scoped to the stat-card label (`.lab`)
      // since the table's own "Filled" columnheader would otherwise make a
      // page-wide exact-text match ambiguous (strict-mode violation).
      await expect(page.locator('.stat .lab', { hasText: /^Filled$/ })).toBeVisible();
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
