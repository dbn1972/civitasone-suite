# HRMS & Payroll — Comprehensive E2E Test Suite

Complete Playwright E2E tests exercising every major HRMS and Payroll user journey.

## Coverage

| Journey | Spec File | Tests |
|---------|-----------|-------|
| Employee Lifecycle | `employee-lifecycle.spec.ts` | Create, view, confirm, transfer, promote, separate |
| Leave Management | `leave-management.spec.ts` | Apply, approve, reject, balance, policies |
| Attendance | `attendance.spec.ts` | Mark, regularise, period lock, summary |
| Payroll Runs | `payroll-runs.spec.ts` | Create, approve, disburse, revert, salary slips |
| Payroll Config | `payroll-config.spec.ts` | Structures, DDOs, pensioners, components |
| Recruitment | `recruitment.spec.ts` | Job openings, applications, talent pool |
| HR Sub-modules | `hr-submodules.spec.ts` | Training, appraisals, disciplinary, org chart, etc. |
| Role-Based Access | `rbac.spec.ts` | HR admin, employee, manager, payroll officer |
| Accessibility | `accessibility.spec.ts` | WCAG 2.2 AA across all HRMS/Payroll pages |

## Running

```bash
# All HRMS/Payroll E2E tests
pnpm --filter @civitasone/web exec playwright test e2e/hrms-payroll/

# Single spec
pnpm --filter @civitasone/web exec playwright test e2e/hrms-payroll/employee-lifecycle.spec.ts

# With UI for debugging
pnpm --filter @civitasone/web exec playwright test e2e/hrms-payroll/ --ui
```

## Architecture

- Uses the existing mock gateway (port 4001) with extended HRMS/Payroll fixtures
- Auth via fake JWT cookie (same as existing E2E suite)
- No live backend required — all API responses mocked via `page.route()`
- Accessibility checks via `@axe-core/playwright`
- Multi-browser (chromium, firefox, webkit) + responsive (desktop, tablet, mobile)

## Mock Strategy

Each spec file uses `page.route()` to intercept API calls with contextual fixture data.
The fixtures module (`fixtures.ts`) provides reusable mock data matching the actual
API response shapes defined in `@civitasone/schemas/web`.
