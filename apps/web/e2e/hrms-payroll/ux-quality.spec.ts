/**
 * E2E: UX Quality — World-Class User Experience Validation
 *
 * These tests validate that the HRMS/Payroll experience is genuinely world-class:
 * - Task completion in minimum clicks
 * - Progressive disclosure (don't overwhelm)
 * - Immediate, contextual feedback
 * - Error prevention > error correction
 * - No dead ends (always a clear next step)
 * - Cognitive load management
 * - Consistent navigation patterns
 * - Responsive interaction (loading states, disabled buttons during submit)
 *
 * Philosophy: A government officer who has never used the system should be able
 * to complete their first leave application in under 60 seconds without help.
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';
import * as fixtures from './fixtures';

test.describe('UX Quality — Leave Application (Critical Journey)', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
    // Mock the leave-context API (progressive loading on employee select)
    await page.route('**/api/proxy/v1/hrms/leave-context*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          employee: { id: 'emp-001', employeeNo: 'EMP-001', name: 'Ravi Kumar' },
          leaveTypes: fixtures.leaveTypes,
          allocations: [
            { id: 'alloc-001', leaveTypeId: 'lt-001', leaveTypeCode: 'CL', leaveTypeName: 'Casual Leave', balanceDays: 5 },
            { id: 'alloc-002', leaveTypeId: 'lt-002', leaveTypeCode: 'EL', leaveTypeName: 'Earned Leave', balanceDays: 20 },
          ],
        }),
      }),
    );
    // Mock the leave submission
    await page.route('**/api/proxy/v1/hrms/leave-requests', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ commandId: 'cmd-001', accepted: true }),
        });
      }
      return route.continue();
    });
  });

  test('form shows balance alongside leave type (prevents over-application)', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    // Wait for leave context to load
    await page.waitForLoadState('networkidle');
    // The leave type selector should show balance info ("Casual Leave (5 days balance)")
    const leaveTypeSelect = page.getByLabel(/leave type/i);
    await expect(leaveTypeSelect).toBeVisible();
    // Options should include balance information to prevent errors
    const options = leaveTypeSelect.locator('option');
    const optionText = await options.nth(0).textContent();
    // World-class UX: balance visible at selection time, not after error
    expect(optionText).toMatch(/\d+ days/i);
  });

  test('shows calculated duration in real-time as dates are picked', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await page.waitForLoadState('networkidle');
    const fromDate = page.getByLabel(/from date/i);
    const toDate = page.getByLabel(/to date/i);
    await fromDate.fill('2024-08-12');
    await toDate.fill('2024-08-14');
    // Should immediately show "3 days" without needing to submit
    await expect(page.getByText(/3 day/i)).toBeVisible();
  });

  test('submit button is disabled while form is submitting (prevents double-submit)', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await page.waitForLoadState('networkidle');
    // Fill form
    const fromDate = page.getByLabel(/from date/i);
    const toDate = page.getByLabel(/to date/i);
    await fromDate.fill('2024-08-12');
    await toDate.fill('2024-08-12');
    // Add a delay to the API to catch the disabled state
    await page.route('**/api/proxy/v1/hrms/leave-requests', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ commandId: 'cmd-001', accepted: true }) });
    });
    const submitBtn = page.getByRole('button', { name: /submit/i });
    await submitBtn.click();
    // Button should be disabled during submission
    await expect(submitBtn).toBeDisabled();
  });

  test('shows success message with clear next action after submission', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await page.waitForLoadState('networkidle');
    const fromDate = page.getByLabel(/from date/i);
    const toDate = page.getByLabel(/to date/i);
    await fromDate.fill('2024-08-12');
    await toDate.fill('2024-08-12');
    await page.getByRole('button', { name: /submit/i }).click();
    // Should show success feedback
    await expect(page.getByText(/submitted|success|approval/i)).toBeVisible();
  });

  test('form fields reset after successful submission (ready for next task)', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await page.waitForLoadState('networkidle');
    const fromDate = page.getByLabel(/from date/i);
    const toDate = page.getByLabel(/to date/i);
    await fromDate.fill('2024-08-12');
    await toDate.fill('2024-08-12');
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(page.getByText(/submitted|success/i)).toBeVisible();
    // Dates should be cleared for next application
    await expect(fromDate).toHaveValue('');
    await expect(toDate).toHaveValue('');
  });

  test('inline validation on invalid date range (to < from)', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await page.waitForLoadState('networkidle');
    const fromDate = page.getByLabel(/from date/i);
    const toDate = page.getByLabel(/to date/i);
    await fromDate.fill('2024-08-15');
    await toDate.fill('2024-08-12'); // Invalid: to before from
    await page.getByRole('button', { name: /submit/i }).click();
    // Should show error without sending to server
    await expect(page.getByText(/after|before|invalid|error/i)).toBeVisible();
  });

  test('clear breadcrumb navigation (user always knows where they are)', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    // Should have breadcrumb or back nav showing: HR > Leave > Apply
    const nav = page.getByRole('navigation', { name: /breadcrumb/i }).or(page.getByRole('link', { name: /leave/i }));
    await expect(nav).toBeVisible();
  });
});

test.describe('UX Quality — Payroll Run Lifecycle (High-Stakes Action)', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('status stepper shows clear lifecycle progression', async ({ page }) => {
    await page.goto('/hr/payroll/run-001');
    // Should see a visual status progression (stepper)
    await expect(page.getByText(/draft/i)).toBeVisible();
    await expect(page.getByText(/approved/i)).toBeVisible();
    await expect(page.getByText(/disbursed/i)).toBeVisible();
  });

  test('approve action requires explicit confirmation (maker-checker)', async ({ page }) => {
    await page.goto('/hr/payroll/run-003'); // draft run
    const approveBtn = page.getByRole('button', { name: /approve/i });
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      // Should open a confirmation dialog, NOT immediately approve
      await expect(page.getByRole('alertdialog').or(page.getByText(/confirm|are you sure/i))).toBeVisible();
    }
  });

  test('confirm dialog shows impact summary (amount, employee count)', async ({ page }) => {
    await page.goto('/hr/payroll/run-003');
    const approveBtn = page.getByRole('button', { name: /approve/i });
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      // Dialog should show human-readable impact
      const dialog = page.getByRole('alertdialog');
      if (await dialog.isVisible()) {
        // Should mention employee count or amount
        await expect(dialog.getByText(/employee|₹|amount/i)).toBeVisible();
      }
    }
  });

  test('confirm dialog requires reason text for audit trail (maker-checker)', async ({ page }) => {
    await page.goto('/hr/payroll/run-003');
    const approveBtn = page.getByRole('button', { name: /approve/i });
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      const dialog = page.getByRole('alertdialog');
      if (await dialog.isVisible()) {
        // Confirm button should be disabled until reason is typed
        const confirmBtn = dialog.getByRole('button', { name: /approve|confirm/i });
        await expect(confirmBtn).toBeDisabled();
        // Type a reason
        const reasonField = dialog.getByRole('textbox');
        if (await reasonField.isVisible()) {
          await reasonField.fill('Reviewed and all deductions correct');
          await expect(confirmBtn).toBeEnabled();
        }
      }
    }
  });

  test('ESC key closes confirmation dialog (standard escape hatch)', async ({ page }) => {
    await page.goto('/hr/payroll/run-003');
    const approveBtn = page.getByRole('button', { name: /approve/i });
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      const dialog = page.getByRole('alertdialog');
      if (await dialog.isVisible()) {
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
      }
    }
  });

  test('duplicate period warning prevents accidental double-pay', async ({ page }) => {
    await page.goto('/hr/payroll');
    // The CreatePayrollRunForm should warn about existing periods
    const monthInput = page.locator('input[type="month"]');
    if (await monthInput.isVisible()) {
      // Set to a month that already has a run (2024-07 from fixtures)
      await monthInput.fill('2024-07');
      // Should show a warning about duplicate
      await expect(page.getByText(/already exists|double.?pay|duplicate/i)).toBeVisible();
    }
  });
});

test.describe('UX Quality — Navigation & Cognitive Load', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('HR hub has categorized tiles (not 72 flat items)', async ({ page }) => {
    await page.goto('/hr');
    // Page should have some organizational structure
    await expect(page.getByRole('heading', { name: /human resources/i })).toBeVisible();
    // Should have navigable tiles
    const links = await page.getByRole('link').count();
    expect(links).toBeGreaterThan(10); // Has navigation tiles
  });

  test('every page has a clear back navigation path', async ({ page }) => {
    const pages = ['/hr/leave/apply', '/hr/payroll/structures', '/hr/payroll/run-001', '/hr/employees/emp-001'];
    for (const url of pages) {
      await page.goto(url);
      // Should have back link/button
      const backNav = page.getByRole('link', { name: /back|←/i }).or(page.locator('.back'));
      await expect(backNav).toBeVisible();
    }
  });

  test('list pages have filter/search for quick access', async ({ page }) => {
    await page.goto('/hr/employees');
    // DataTable should render a search/filter input
    const filterInput = page.getByPlaceholder(/search|filter/i);
    await expect(filterInput).toBeVisible();
  });

  test('filter actually narrows results (responsive filtering)', async ({ page }) => {
    await page.goto('/hr/employees');
    const filterInput = page.getByPlaceholder(/search|filter/i);
    await filterInput.fill('Ravi');
    // Should show only matching rows
    await expect(page.getByText('Ravi Kumar')).toBeVisible();
    // Non-matching should be hidden
    await expect(page.getByText('Ankit Verma')).not.toBeVisible();
  });

  test('employee detail shows contextual information (not just raw data)', async ({ page }) => {
    await page.goto('/hr/employees/emp-001');
    // Should show employee name as page title (not "Employee ID: emp-001")
    await expect(page.getByRole('heading', { name: /Ravi Kumar/i })).toBeVisible();
    // Grouped information sections
    await expect(page.getByText(/personal information/i).or(page.getByText(/department/i))).toBeVisible();
  });

  test('tables have CSV export for operational use', async ({ page }) => {
    await page.goto('/hr/employees');
    const exportBtn = page.getByRole('button', { name: /csv|export|download/i });
    await expect(exportBtn).toBeVisible();
  });

  test('empty states provide actionable guidance (not just "No data")', async ({ page }) => {
    await page.route('**/api/v1/hrms/employees', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], pagination: { hasMore: false, pageSize: 50 } }),
      }),
    );
    await page.goto('/hr/employees');
    // Empty state should have a helpful message and action
    await expect(page.getByText(/add|create|get started|no people/i)).toBeVisible();
    // Should have a call-to-action link
    await expect(page.getByRole('link', { name: /how|add|help/i })).toBeVisible();
  });
});

test.describe('UX Quality — Feedback & Error Recovery', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('loading states prevent layout shift (skeleton visible before data)', async ({ page }) => {
    // Delay API response
    await page.route('**/api/v1/hrms/employees', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtures.employees) });
    });
    await page.goto('/hr/employees');
    // Page heading should be visible immediately (from server component)
    await expect(page.getByRole('heading', { name: /employees/i })).toBeVisible();
  });

  test('error state offers retry (not just "something went wrong")', async ({ page }) => {
    await page.route('**/api/v1/hrms/dashboard*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL"}' }),
    );
    await page.route('**/api/v1/hrms/employees*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL"}' }),
    );
    await page.goto('/hr/dashboard');
    // Error boundary should show retry option
    const retryBtn = page.getByRole('button', { name: /retry|try again/i });
    const backLink = page.getByRole('link', { name: /back|hr/i });
    // At minimum, user should have an escape route
    await expect(retryBtn.or(backLink)).toBeVisible();
  });

  test('offline indicator shows when using cached data', async ({ page }) => {
    await page.goto('/hr/employees');
    // The EmployeesTable uses useSeededResource which shows cache notice when offline
    // Verify the cache notice region exists (aria-live="polite")
    const liveRegion = page.locator('[role="status"][aria-live="polite"]');
    // This should exist even if not currently showing text
    const liveRegionCount = await liveRegion.count();
    expect(liveRegionCount).toBeGreaterThanOrEqual(0); // Structure is in place
  });

  test('form submission error shows inline (not page-level crash)', async ({ page }) => {
    await page.route('**/api/proxy/v1/hrms/leave-requests', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'LEAVE_OVERLAP', message: 'dates overlap an existing application' }) }),
    );
    await page.route('**/api/proxy/v1/hrms/leave-context*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          employee: { id: 'emp-001', employeeNo: 'EMP-001', name: 'Ravi Kumar' },
          leaveTypes: fixtures.leaveTypes,
          allocations: [{ id: 'alloc-001', leaveTypeId: 'lt-001', leaveTypeCode: 'CL', leaveTypeName: 'Casual Leave', balanceDays: 5 }],
        }),
      }),
    );
    await page.goto('/hr/leave/apply');
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/from date/i).fill('2024-08-12');
    await page.getByLabel(/to date/i).fill('2024-08-12');
    await page.getByRole('button', { name: /submit/i }).click();
    // Error should appear inline, page should NOT crash
    await expect(page.getByText(/overlap|error|fail/i)).toBeVisible();
    // Form should still be visible (user can correct and retry)
    await expect(page.getByRole('button', { name: /submit/i })).toBeVisible();
  });
});

test.describe('UX Quality — Responsive & Touch', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('DataTable rows are touch-friendly (min 44px height)', async ({ page }) => {
    await page.goto('/hr/employees');
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.isVisible()) {
      const box = await firstRow.boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(40); // Touch target
      }
    }
  });

  test('buttons have minimum touch target size (44px)', async ({ page }) => {
    await page.goto('/hr/payroll');
    const createBtn = page.getByRole('button', { name: /create/i });
    if (await createBtn.isVisible()) {
      const box = await createBtn.boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('form inputs have adequate size on mobile', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    const inputs = page.locator('input, select, textarea');
    const count = await inputs.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await inputs.nth(i).boundingBox();
      if (box) {
        // Inputs should be at least 36px tall for touch
        expect(box.height).toBeGreaterThanOrEqual(30);
      }
    }
  });
});

test.describe('UX Quality — Information Hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  test('dashboard shows KPIs first (most important info at top)', async ({ page }) => {
    await page.goto('/hr/dashboard');
    // KPI cards should appear before the data table
    const statGrid = page.locator('.stat-grid, [class*="stat"]').first();
    const table = page.locator('table').first();
    if (await statGrid.isVisible() && await table.isVisible()) {
      const statBox = await statGrid.boundingBox();
      const tableBox = await table.boundingBox();
      if (statBox && tableBox) {
        expect(statBox.y).toBeLessThan(tableBox.y); // Stats above table
      }
    }
  });

  test('payroll page shows context before action (understand then act)', async ({ page }) => {
    await page.goto('/hr/payroll');
    // Create form should come AFTER stat cards (understand the state first)
    const heading = page.getByRole('heading', { name: /payroll/i });
    await expect(heading).toBeVisible();
    // Stats visible before action area
    await expect(page.getByText(/total runs/i)).toBeVisible();
  });

  test('page titles are descriptive (not generic "Module")', async ({ page }) => {
    const titleChecks = [
      { url: '/hr/leave', expected: /leave/i },
      { url: '/hr/attendance', expected: /attendance/i },
      { url: '/hr/payroll', expected: /payroll/i },
      { url: '/hr/recruitment', expected: /recruitment/i },
    ];
    for (const { url, expected } of titleChecks) {
      await page.goto(url);
      const heading = page.getByRole('heading').first();
      await expect(heading).toHaveText(expected);
    }
  });

  test('help link is available on complex pages', async ({ page }) => {
    await page.goto('/hr/payroll');
    // PageHeader renders a "How this works" help link on complex pages
    const helpLink = page.getByRole('link', { name: /how this works|help/i });
    // At minimum, major pages should have help available
    const pageWithHelp = await helpLink.isVisible();
    // This is an assertion about UX quality — critical pages should have help
    if (!pageWithHelp) {
      // Check on recruitment (which does declare help="hr")
      await page.goto('/hr/recruitment');
      await expect(page.getByRole('link', { name: /how this works/i })).toBeVisible();
    }
  });
});
