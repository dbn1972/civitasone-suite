/**
 * HRMS/Payroll E2E test helpers — route mocking and shared utilities.
 */
import type { Page, Route } from '@playwright/test';
import { authenticate } from '../helpers/auth';
import * as fixtures from './fixtures';

/** Authenticate and set up HRMS API mocks for the page. */
export async function setupHrmsPage(page: Page): Promise<void> {
  await authenticate(page);
  await mockHrmsApis(page);
}

/** Set up all HRMS + Payroll API mocks. */
export async function mockHrmsApis(page: Page): Promise<void> {
  // HR Dashboard
  await page.route('**/api/v1/hrms/dashboard', (route) =>
    json(route, fixtures.hrDashboard),
  );

  // Employees
  await page.route('**/api/v1/hrms/employees', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.employees);
  });

  await page.route('**/api/v1/hrms/employees/emp-001', (route) => {
    if (route.request().method() === 'PATCH') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.employeeDetail);
  });

  await page.route('**/api/v1/hrms/employees/*/confirm', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/employees/*/transfer', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/employees/*/transfer/submit-approval', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/employees/*/promotion/submit-approval', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/employees/*/separate', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );

  // Leave
  await page.route('**/api/v1/hrms/leave-requests', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.leaveRequests.data);
  });
  await page.route('**/api/v1/hrms/leave-applications', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, { data: fixtures.leaveRequests.data });
  });
  await page.route('**/api/v1/hrms/leave-applications/*/approve', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/leave-applications/*/reject', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/leave-allocations', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.leaveAllocations);
  });
  await page.route('**/api/v1/hrms/leave-types*', (route) =>
    json(route, fixtures.leaveTypes),
  );
  await page.route('**/api/v1/hrms/leave/applications*', (route) =>
    json(route, { data: fixtures.leaveRequests.data, meta: { page: 1, pageSize: 50, total: fixtures.leaveRequests.data.length } }),
  );

  // Attendance
  await page.route('**/api/v1/hrms/attendance/summary*', (route) =>
    json(route, fixtures.attendanceSummary),
  );
  await page.route('**/api/v1/hrms/attendance/locks', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.attendanceLocks);
  });
  await page.route('**/api/v1/hrms/attendance/locks/unlock', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/attendance/regularisations', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.regularisations);
  });
  await page.route('**/api/proxy/v1/hrms/attendance/regularisations/*/approve', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/proxy/v1/hrms/attendance/regularisations/*/reject', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/hrms/attendance', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.attendanceRecords);
  });

  // Payroll
  await page.route('**/api/v1/payroll/runs', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.payrollRuns);
  });
  await page.route('**/api/v1/payroll/runs/run-001', (route) =>
    json(route, fixtures.payrollRunDetail),
  );
  await page.route('**/api/v1/payroll/runs/run-003', (route) =>
    json(route, fixtures.payrollRunDraft),
  );
  await page.route('**/api/v1/payroll/runs/*/approve', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/payroll/runs/*/disburse', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/payroll/runs/*/revert', (route) =>
    json(route, fixtures.acceptedResponse, 202),
  );
  await page.route('**/api/v1/payroll/structures', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.payrollStructures);
  });
  await page.route('**/api/v1/payroll/components*', (route) =>
    json(route, fixtures.payrollComponents),
  );
  await page.route('**/api/v1/payroll/salary-slips*', (route) =>
    json(route, fixtures.salarySlips),
  );
  await page.route('**/api/v1/payroll/ddos', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.ddos);
  });
  await page.route('**/api/v1/payroll/pensioners', (route) => {
    if (route.request().method() === 'POST') {
      return json(route, fixtures.acceptedResponse, 202);
    }
    return json(route, fixtures.pensioners);
  });

  // Recruitment
  await page.route('**/api/v1/hrms/recruitment/dashboard', (route) =>
    json(route, fixtures.recruitmentDashboard),
  );
  await page.route('**/api/v1/hrms/job-openings*', (route) =>
    json(route, fixtures.jobOpenings),
  );

  // HR sub-modules
  await page.route('**/api/v1/hrms/transfers*', (route) =>
    json(route, fixtures.transfers),
  );
  await page.route('**/api/v1/hrms/promotions*', (route) =>
    json(route, fixtures.promotions),
  );
  await page.route('**/api/v1/hrms/training-programs*', (route) =>
    json(route, fixtures.trainingPrograms),
  );
  await page.route('**/api/v1/hrms/appraisals*', (route) =>
    json(route, fixtures.appraisals),
  );
  await page.route('**/api/v1/hrms/org-chart*', (route) =>
    json(route, []),
  );
}

/** Fulfill a route with JSON data. */
function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Create a role-specific auth token and mock set.
 * Use for RBAC tests where different roles see different responses.
 */
export async function setupAsRole(page: Page, role: 'hr_admin' | 'employee' | 'manager' | 'payroll_officer'): Promise<void> {
  await authenticate(page);
  await mockHrmsApis(page);

  // Override specific routes based on role restrictions
  if (role === 'employee') {
    // Employees see only their own data
    await page.route('**/api/v1/hrms/employees', (route) =>
      json(route, { data: [fixtures.employees.data[0]], pagination: { hasMore: false, pageSize: 50 } }),
    );
  }
}
