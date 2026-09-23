import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('HR', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('hr dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/hr/dashboard');
    // REL-023: the dashboard grew a "Dept. Headcount" chart and a "Download
    // Report" quick action whose description also contains the word
    // "Headcount", so the untargeted text match now resolves to 3 elements.
    // exact:true pins this back to the KPI strip's own "Headcount" label.
    await expect(page.getByText('Headcount', { exact: true })).toBeVisible();
    await expect(page.getByText(/attendance/i)).toBeVisible();
  });

  // ── List ─────────────────────────────────────────────────────────────────

  test('employees list shows column headers', async ({ page }) => {
    await page.goto('/hr/employees');
    // REL-023: the list page grew its own "All Employees" card <h3>, which
    // also matches "Employees" by substring — level:1 pins this to the <h1>.
    await expect(page.getByRole('heading', { name: 'Employees', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('employees list shows employee name and department from mock', async ({ page }) => {
    await page.goto('/hr/employees');
    await expect(page.getByRole('link', { name: 'Ravi Kumar' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'IT' }).first()).toBeVisible();
  });

  // ── Detail ───────────────────────────────────────────────────────────────

  test('employee detail shows Employee Profile heading', async ({ page }) => {
    await page.goto('/hr/employees/EMP-001');
    // REL-023: this was a false-positive pass. The EMP-001 detail fixture was
    // missing 3 fields EmployeeDetailSchema requires as present-but-nullable
    // (bankAccountNo/bankIfsc/pan), so schema validation always failed and
    // the page silently rendered its OWN "not found" branch -- whose title
    // happens to literally be "Employee Profile"
    // (employeeDetail.notFoundTitle) -- never the real profile at all. Now
    // that the fixture is complete (see global-setup.ts), the real page
    // renders, and its <h1> is the employee's own name, per PageHeader
    // title={employee.name} in hr/employees/[id]/page.tsx.
    await expect(page.getByRole('heading', { name: 'Ravi Kumar', level: 1 })).toBeVisible();
  });

  test('employee detail shows key fields', async ({ page }) => {
    await page.goto('/hr/employees/EMP-001');
    await expect(page.getByText('Personal Information')).toBeVisible();
    await expect(page.getByText('EMP-001')).toBeVisible();
    await expect(page.getByText('Ravi Kumar')).toBeVisible();
  });

  test('employee detail breadcrumb links back to employees list', async ({ page }) => {
    await page.goto('/hr/employees/EMP-001');
    await expect(page.getByRole('link', { name: 'Employees' })).toBeVisible();
  });

  test('navigating employees list → detail shows profile', async ({ page }) => {
    await page.goto('/hr/employees');
    await page.getByRole('link', { name: 'Ravi Kumar' }).click();
    // REL-023: see "employee detail shows Employee Profile heading" above --
    // the real page's heading is the employee's name, not a static label.
    await expect(page.getByRole('heading', { name: 'Ravi Kumar', level: 1 })).toBeVisible();
  });

  // ── Form ─────────────────────────────────────────────────────────────────

  test('leave application form shows all required fields', async ({ page }) => {
    await page.goto('/hr/leave/apply');
    await expect(page.getByRole('heading', { name: /leave/i })).toBeVisible();
    await expect(page.getByLabel('Employee', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/leave type/i)).toBeVisible();
    await expect(page.getByLabel(/from date/i)).toBeVisible();
    await expect(page.getByLabel(/to date/i)).toBeVisible();
  });

  test('leave application form validates required fields', async ({ page }) => {
    // REL-023 (systemic, disclosed — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
    // REL-023 tranche 3): helpers/auth.ts's authenticate() stubs the whole
    // **/api/proxy/** wildcard with an empty `{}` body. ApplyLeaveForm loads
    // its leave-type options from /api/proxy/v1/hrms/leave-context, so that
    // blanket stub gives it `{}` instead of a real { allocations: [...] }
    // body — the Leave Type <select> is then permanently disabled
    // (`disabled={!leaveContext?.allocations.length}`), which was masking
    // whatever this test originally saw. Overriding just this one route
    // narrowly (not touching the shared helper — same precedent as the
    // notifications.spec.ts fix in tranche 3) restores real leave-context
    // data so the rest of the form behaves like a live app.
    await page.route('**/api/proxy/v1/hrms/leave-context**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          employee: { id: 'EMP-001', employeeNo: 'EMP-001', name: 'Ravi Kumar' },
          leaveTypes: [{ id: 'lt-el', code: 'EL', name: 'Earned Leave', maxDays: 30 }],
          allocations: [{ id: 'alloc-el', leaveTypeId: 'lt-el', leaveTypeCode: 'EL', leaveTypeName: 'Earned Leave', balanceDays: 12 }],
        }),
      }),
    );
    await page.goto('/hr/leave/apply');
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(page.getByText(/required/i).first()).toBeVisible();
  });

  // ── Other sub-pages ───────────────────────────────────────────────────────

  test('leave list page loads without error', async ({ page }) => {
    await page.goto('/hr/leave');
    // REL-023: card <h3>Leave Requests</h3> also matches /leave/i now,
    // alongside the page's own <h1>Leave Management</h1>.
    await expect(page.getByRole('heading', { name: /leave/i, level: 1 })).toBeVisible();
  });

  test('attendance page loads without error', async ({ page }) => {
    await page.goto('/hr/attendance');
    // REL-023: card <h3>Attendance Records</h3> also matches /attendance/i.
    await expect(page.getByRole('heading', { name: /attendance/i, level: 1 })).toBeVisible();
  });

  test('payroll list shows heading', async ({ page }) => {
    await page.goto('/hr/payroll');
    // REL-023: card <h3>Payroll Runs</h3> and (when the mock 500s a retry
    // path) an error <h4> both also match /payroll/i now.
    await expect(page.getByRole('heading', { name: /payroll/i, level: 1 })).toBeVisible();
  });

  test('payroll salary slips shows heading', async ({ page }) => {
    await page.goto('/hr/payroll/salary-slips');
    // REL-023: card <h3>All Salary Slips</h3> and empty-state <h4>No salary
    // slips yet</h4> both also match /salary slip/i now.
    await expect(page.getByRole('heading', { name: /salary slip/i, level: 1 })).toBeVisible();
  });

  // FINDING-1 (HRMS role-based review): hr/org-chart and hr/orgchart were two
  // independent implementations of the same page -- org-chart is now
  // canonical (it alone carries the UX-005 accessibility remediation and the
  // GFR sanctioned-posts footnote; see next.config.mjs's redirects() for the
  // full reasoning). This is also the first e2e coverage of this page.
  test('org chart page loads at the canonical /hr/org-chart path', async ({ page }) => {
    await page.goto('/hr/org-chart');
    await expect(page.getByRole('heading', { name: 'Organisation Chart', level: 1 })).toBeVisible();
    await expect(page.getByText('Total Employees')).toBeVisible();
  });

  test('/hr/orgchart (old no-hyphen path) redirects to /hr/org-chart', async ({ page }) => {
    await page.goto('/hr/orgchart');
    await expect(page).toHaveURL(/\/hr\/org-chart$/);
    await expect(page.getByRole('heading', { name: 'Organisation Chart', level: 1 })).toBeVisible();
  });
});
