# HRMS & Payroll — Comprehensive E2E Test Suite

Complete Playwright E2E tests exercising every major HRMS and Payroll user journey
across 3 browsers × 3 viewports with accessibility, visual regression, and RBAC coverage.

## Coverage Matrix

| Journey | Spec File | Tests |
|---------|-----------|-------|
| Employee Lifecycle | `employee-lifecycle.spec.ts` | Create, view, confirm, transfer, promote, separate |
| Leave Management | `leave-management.spec.ts` | Apply, approve, reject, balance, policies |
| Attendance | `attendance.spec.ts` | Mark, regularise, period lock, summary, shifts |
| Payroll Runs | `payroll-runs.spec.ts` | Create, approve, disburse, revert, salary slips |
| Payroll Config | `payroll-config.spec.ts` | Structures, DDOs, pensioners, tax, GPF, NPS, Form 16 |
| Recruitment | `recruitment.spec.ts` | Job openings, applications, talent pool |
| HR Sub-modules | `hr-submodules.spec.ts` | 30+ modules (training, appraisals, org chart, etc.) |
| HR Dashboard | `hr-dashboard.spec.ts` | KPIs, hub nav, cross-module journeys, error states |
| Role-Based Access | `rbac.spec.ts` | HR admin, employee, manager, payroll officer |
| Accessibility | `accessibility.spec.ts` | WCAG 2.2 AA via axe-core across all key pages |
| Visual Regression | `visual-regression.spec.ts` | Screenshot diffs for layouts and empty states |

## Browser & Viewport Matrix

| Browser | Desktop (1440×900) | Tablet (768×1024) | Mobile (375×812) |
|---------|---|---|---|
| Chromium | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ |
| WebKit | ✅ | ✅ | ✅ |

## Running

```bash
# Full matrix (3 browsers × 3 viewports) — uses dedicated config
pnpm --filter @civitasone/web exec playwright test --config e2e/hrms-payroll/playwright.config.ts

# Desktop-only (fast, uses root config which picks up this dir)
pnpm --filter @civitasone/web exec playwright test e2e/hrms-payroll/

# Single spec file
pnpm --filter @civitasone/web exec playwright test e2e/hrms-payroll/employee-lifecycle.spec.ts

# Single browser
pnpm --filter @civitasone/web exec playwright test --config e2e/hrms-payroll/playwright.config.ts --project=desktop-chromium

# Update visual regression baselines
pnpm --filter @civitasone/web exec playwright test --config e2e/hrms-payroll/playwright.config.ts visual-regression.spec.ts --update-snapshots

# With interactive UI for debugging
pnpm --filter @civitasone/web exec playwright test e2e/hrms-payroll/ --ui

# Generate HTML report
pnpm --filter @civitasone/web exec playwright show-report apps/web/hrms-payroll-report
```

## Architecture

```
e2e/hrms-payroll/
├── playwright.config.ts           — Dedicated config (3×3 matrix, JUnit XML output)
├── fixtures.ts                    — Shared mock data (matches @civitasone/schemas/web)
├── helpers.ts                     — setupHrmsPage(), mockHrmsApis(), role helpers
├── employee-lifecycle.spec.ts     — Employee CRUD and lifecycle actions
├── leave-management.spec.ts       — Leave apply/approve/reject
├── attendance.spec.ts             — Attendance records and locks
├── payroll-runs.spec.ts           — Payroll run lifecycle
├── payroll-config.spec.ts         — Payroll master data (structures, DDOs, etc.)
├── recruitment.spec.ts            — Job openings and talent pool
├── hr-submodules.spec.ts          — All secondary HR modules (30+)
├── hr-dashboard.spec.ts           — Dashboard, hub, cross-module flows
├── rbac.spec.ts                   — Role-based access patterns
├── accessibility.spec.ts          — WCAG 2.2 AA audits via @axe-core/playwright
├── visual-regression.spec.ts      — toHaveScreenshot() pixel comparisons
└── README.md                      — This file
```

### Key Design Decisions

- **API Mocking**: `page.route()` intercepts — no live backend, no flaky network
- **Auth**: Fake JWT cookie (HS256 unsigned) — no real Keycloak
- **Fixtures**: Realistic Indian government ERP data matching actual response schemas
- **Accessibility**: axe-core WCAG 2.2 AA — filters critical/serious violations only
- **Visual Regression**: Platform-specific baselines, 1% pixel diff tolerance
- **Parallelism**: `fullyParallel: true` in CI for fast matrix runs
- **Reporting**: HTML report + JUnit XML for CI dashboards
- **Error Resilience**: Tests verify graceful degradation on API failures

## CI Integration

```yaml
# GitHub Actions example
- name: HRMS/Payroll E2E Tests
  run: |
    npx playwright install --with-deps
    pnpm --filter @civitasone/web exec playwright test \
      --config e2e/hrms-payroll/playwright.config.ts
  env:
    CI: true

- name: Upload Test Report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: hrms-payroll-e2e-report
    path: apps/web/hrms-payroll-report/
```
