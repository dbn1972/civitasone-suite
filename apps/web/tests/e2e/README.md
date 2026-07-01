# E2E Tests — CivitasOne Web

Browser-based end-to-end tests using [Playwright](https://playwright.dev/).

## Quick Start

```bash
# Install Playwright browsers (first time only)
npx playwright install chromium

# Run all E2E tests
pnpm --filter @civitasone/web test:e2e

# Run with interactive UI
pnpm --filter @civitasone/web test:e2e:ui

# Run in debug mode (step through tests)
pnpm --filter @civitasone/web test:e2e:debug
```

## How It Works

These tests use **Playwright's `page.route()` API mocking** — no live backend services required. Each test file intercepts API calls and returns fixture data, so you can run E2E tests without spinning up all 33 microservices.

### Auth Strategy

Tests bypass Keycloak by setting an HS256-signed JWT cookie directly on the browser context. This matches the same pattern used in service integration tests:

```
JWT_ALGORITHM=HS256
JWT_SECRET=test_secret_for_civitasone_32chr
```

The `helpers/auth.ts` module provides:
- `loginAsAdmin(page)` — sets admin auth cookie + stubs proxy routes
- `loginAsMsme(page)` — sets MSME vendor user auth cookie
- `goAsAdmin(page, path)` — authenticate + navigate in one call
- `getAuthHeaders()` — returns `{ Authorization: "Bearer ..." }` for direct API calls

## Running in CI

### Prerequisites

1. Docker Compose stack running (Postgres, Redis, Keycloak, LocalStack):
   ```bash
   docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml up -d
   ```

2. Next.js dev server running (or let Playwright start it):
   ```bash
   pnpm --filter @civitasone/web dev
   ```

3. Playwright browsers installed:
   ```bash
   npx playwright install --with-deps chromium
   ```

### CI Configuration

```yaml
# Example GitHub Actions step
- name: Run E2E Tests
  run: pnpm --filter @civitasone/web test:e2e
  env:
    CI: true
    BASE_URL: http://localhost:3000
```

### Required Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CI` | — | Set in CI to enable retries and stricter mode |
| `BASE_URL` | `http://localhost:3000` | Override the app URL |

## Test Structure

```
tests/e2e/
├── helpers/
│   └── auth.ts          — Auth helpers (loginAsAdmin, loginAsMsme, getAuthHeaders)
├── smoke.spec.ts        — Basic app loading (no crash, login renders, dashboard works)
├── login.spec.ts        — Authentication flows (valid/invalid creds, session, logout)
├── navigation.spec.ts   — Sidebar routing (each route loads, no 404s, back button)
├── branding.spec.ts     — Theme editor (tokens render, edit UI present)
├── msme-onboard.spec.ts — MSME self-signup flow
├── playwright.config.ts — Playwright configuration
└── README.md            — This file
```

## Debugging Failures

### HTML Report

After a test run, open the HTML report:

```bash
npx playwright show-report apps/web/playwright-report
```

This shows:
- Screenshots of failures (captured automatically)
- Trace files for retried tests (open in Trace Viewer)
- Step-by-step execution timeline

### Trace Viewer

For tests that fail on retry, a trace is recorded. Open it:

```bash
npx playwright show-trace test-results/<test-name>/trace.zip
```

### Debug Mode

Step through tests interactively:

```bash
pnpm --filter @civitasone/web test:e2e:debug
```

## Writing New Tests

### Rules

1. **No arbitrary waits** — use `page.waitForSelector()` or `expect().toBeVisible()`, never `page.waitForTimeout()`
2. **Independent tests** — no shared state between spec files
3. **API mocking** — use `page.route()` to intercept API calls
4. **Use `test.describe`** for grouping related tests
5. **Each file is standalone** — can run independently

### Example

```typescript
import { test, expect } from '@playwright/test';
import { goAsAdmin } from './helpers/auth';

test.describe('My Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API responses for this feature
    await page.route('**/api/v1/my-feature/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [...] }),
      }),
    );
  });

  test('feature page loads', async ({ page }) => {
    await goAsAdmin(page, '/my-feature');
    await expect(page.getByRole('heading', { name: 'My Feature' })).toBeVisible();
  });
});
```

## Existing E2E Suites

The main `e2e/` directory (at `apps/web/e2e/`) contains comprehensive module-level E2E tests with a mock gateway server. Those use the root `playwright.config.ts` and include a full fixture server. This `tests/e2e/` suite is focused on core user flows with inline API mocking.
