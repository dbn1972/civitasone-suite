You are writing a Playwright E2E test suite for CivitasOne web app.
Read CLAUDE.md, `apps/web/src/app/auth/login/page.tsx`, and `apps/web/src/app/(app)/_data/loaders.ts` first.

## Goal

Cover the critical user journeys with Playwright tests that run against the real Next.js dev server + gateway.
Tests must be deterministic — mock external services (gateway API calls) with `page.route()` interceptors, not real backends.

## Setup

Create `apps/web/e2e/` directory with:

### `playwright.config.ts`
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'e2e-report' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.CI ? {
    command: 'pnpm --filter @civitasone/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  } : undefined,
});
```

### `e2e/helpers/mock-api.ts`

Create a reusable helper that intercepts gateway calls:

```typescript
import type { Page } from '@playwright/test';

export async function mockGateway(page: Page, overrides: Record<string, unknown> = {}) {
  // Mock auth check
  await page.route('**/api/identity/**', route => route.fulfill({ status: 200, json: { id: 'user-1', roles: ['admin'] } }));

  // Finance
  await page.route('**/api/v1/finance/accounts**', route => route.fulfill({ status: 200, json: { data: [
    { id: '1', code: '1001', name: 'Cash', type: 'asset', balanceMinor: 500000 },
    { id: '2', code: '2001', name: 'Accounts Payable', type: 'liability', balanceMinor: 200000 },
  ]}}));
  await page.route('**/api/v1/finance/payments**', route => route.fulfill({ status: 200, json: { data: [
    { id: 'p-1', reference: 'PAY-001', amountMinor: 10000, status: 'completed', createdAt: '2024-01-01' },
  ]}}));
  await page.route('**/api/v1/finance/journals**', route => route.fulfill({ status: 200, json: { data: [] }}));

  // HR
  await page.route('**/api/v1/hrms/employees**', route => route.fulfill({ status: 200, json: { data: [
    { id: 'e-1', name: 'Ravi Kumar', designation: 'Engineer', department: 'IT', status: 'active' },
    { id: 'e-2', name: 'Priya Singh', designation: 'Manager', department: 'Finance', status: 'active' },
  ]}}));
  await page.route('**/api/v1/hrms/leave**', route => route.fulfill({ status: 200, json: { data: [] }}));
  await page.route('**/api/v1/hrms/attendance**', route => route.fulfill({ status: 200, json: { data: [] }}));
  await page.route('**/api/v1/payroll/runs**', route => route.fulfill({ status: 200, json: { data: [] }}));

  // Procurement
  await page.route('**/api/v1/procurement/vendors**', route => route.fulfill({ status: 200, json: { data: [
    { id: 'v-1', name: 'Tech Supplies Ltd', gstNo: '29ABCDE1234F1Z5', status: 'active' },
  ]}}));
  await page.route('**/api/v1/procurement/pos**', route => route.fulfill({ status: 200, json: { data: [] }}));
  await page.route('**/api/v1/procurement/approvals**', route => route.fulfill({ status: 200, json: { data: [] }}));

  // CRM
  await page.route('**/api/v1/crm/contacts**', route => route.fulfill({ status: 200, json: { data: [
    { id: 'c-1', name: 'Anita Desai', email: 'anita@example.com', phone: '+91-9876543210' },
  ]}}));
  await page.route('**/api/v1/crm/deals**', route => route.fulfill({ status: 200, json: { data: [] }}));
  await page.route('**/api/v1/crm/activities**', route => route.fulfill({ status: 200, json: { data: [] }}));

  // Helpdesk
  await page.route('**/api/v1/citizen/tickets**', route => route.fulfill({ status: 200, json: { data: [] }}));
  await page.route('**/api/v1/helpdesk/**', route => route.fulfill({ status: 200, json: { data: [] }}));

  // Audit
  await page.route('**/api/audit/events**', route => route.fulfill({ status: 200, json: { data: [
    { id: 'a-1', actor: { email: 'admin@example.com' }, action: 'tenant.create', resource: 'tenant:t-1', outcome: 'success', createdAt: '2024-01-01T00:00:00Z' },
  ]}}));
  await page.route('**/api/v1/audit/**', route => route.fulfill({ status: 200, json: { data: [] }}));

  // Tenant admin
  await page.route('**/api/v1/admin/**', route => route.fulfill({ status: 200, json: { data: [] }}));
  await page.route('**/api/v1/tenants/**', route => route.fulfill({ status: 200, json: { modules: ['finance', 'hr', 'procurement', 'crm', 'helpdesk'] }}));
  await page.route('**/api/identity/users**', route => route.fulfill({ status: 200, json: { data: [
    { id: 'u-1', email: 'admin@example.com', name: 'Admin', roles: ['admin'] },
  ]}}));
}

export async function login(page: Page) {
  await page.goto('/auth/login');
  await page.fill('[name="username"]', 'admin');
  await page.fill('[name="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}
```

## Test files to write

### `e2e/auth.spec.ts`
Test login happy path and error states:
```typescript
test('login with valid credentials redirects to dashboard', ...)
test('login with wrong password shows error message', ...)
test('logout clears session and redirects to login', ...)
```

### `e2e/dashboard.spec.ts`
```typescript
test('dashboard shows module nav tiles after login', ...)
test('clicking Finance tile navigates to /finance', ...)
```

### `e2e/finance.spec.ts`
```typescript
test('chart of accounts lists accounts from API', ...)
test('payments list shows payment reference and status', ...)
test('journal entry form submits and shows confirmation', ...)
```

### `e2e/hr.spec.ts`
```typescript
test('employees list shows employee name and designation', ...)
test('leave list loads without error', ...)
test('attendance list loads without error', ...)
```

### `e2e/procurement.spec.ts`
```typescript
test('vendor list shows vendor name and GST number', ...)
test('purchase orders list loads without error', ...)
test('approvals screen renders without error', ...)
```

### `e2e/crm.spec.ts`
```typescript
test('contacts list shows contact name and email', ...)
test('deals list loads without error', ...)
test('activities list loads without error', ...)
```

### `e2e/helpdesk.spec.ts`
```typescript
test('tickets list loads without error', ...)
test('SLA list loads without error', ...)
```

### `e2e/audit.spec.ts`
```typescript
test('audit log shows actor and action columns', ...)
test('audit rows render outcome badge', ...)
```

### `e2e/tenant-admin.spec.ts`
```typescript
test('tenant admin shows users tab with user list', ...)
test('roles tab renders role list', ...)
test('settings tab renders setting controls', ...)
```

## Test implementation rules

1. Every test file: import `mockGateway` and call it in `test.beforeEach`.
2. Use `expect(page.locator(...)).toBeVisible()` — not `toHaveCount()`.
3. Never use `page.waitForTimeout()` — use `waitForSelector` or `toBeVisible`.
4. Keep tests focused: one assertion per test is fine.
5. Use data-testid attributes where present; fall back to text/role selectors.
6. Each module spec file uses `test.describe('ModuleName')` wrapper.

## package.json update

In `apps/web/package.json`, add:
```json
"scripts": {
  "e2e": "playwright test",
  "e2e:ui": "playwright test --ui",
  "e2e:report": "playwright show-report e2e-report"
},
"devDependencies": {
  "@playwright/test": "^1.44.0"
}
```

Run `npx playwright install chromium --with-deps` if in CI.

## Verification

```bash
cd apps/web
pnpm add -D @playwright/test
npx playwright install chromium
pnpm e2e -- --reporter=list 2>&1 | tail -40
```

If the dev server isn't running during headless execution, set `webServer` in playwright.config.ts.
Report: X passed, Y failed. Fix any failures before finishing.
