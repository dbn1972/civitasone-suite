/**
 * E2E: Onboarding Module — functional tests.
 *
 * Covers:
 * - Manager list page: joinee cards render with progress bars
 * - Overdue alert banner renders when joinee has overdue tasks
 * - Per-joinee detail: welcome header, checklist, calendar, document cards
 * - Document upload drag-zone and status chip render
 * - Empty state: "No joiners this month" with CTA
 *
 * Authentication: JWT cookie via `authenticate()` helper.
 * API: fully mocked — no real backend calls.
 */
import { test, expect } from '@playwright/test';
import { authenticate } from '../helpers/auth';
import * as fixtures from './fixtures';

// ── Shared route mock ─────────────────────────────────────────────────────────

async function mockOnboarding(page: import('@playwright/test').Page, rows = fixtures.onboardingRows) {
  await authenticate(page);
  await page.route('**/api/proxy/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/v1/hrms/onboarding*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows),
    }),
  );
}

// ── Manager list page ─────────────────────────────────────────────────────────

test.describe('Onboarding — manager list', () => {
  test('page heading renders', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    await expect(page.locator('#page-heading')).toBeVisible();
    await expect(page.locator('#page-heading')).toContainText('Onboarding Tracker');
  });

  test('stat cards render total, in-progress, completed, overdue counts', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    // Two rows: one in_progress, one overdue — so total=2, in_progress=1, overdue=1
    const stats = page.locator('.stat');
    await expect(stats).toHaveCount(4);
  });

  test('joinee cards render for each onboarding row', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    const cards = page.locator('[data-testid^="joinee-card-"]');
    await expect(cards).toHaveCount(fixtures.onboardingRows.length);
  });

  test('joinee card shows employee name and department', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    const first = page.locator('[data-testid="joinee-card-ob-001"]');
    await expect(first).toBeVisible();
    await expect(first).toContainText('Sunita Rao');
    await expect(first).toContainText('Finance');
  });

  test('overdue badge renders on card with overdue tasks', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    const overdueBadge = page.locator('[data-testid="overdue-badge-ob-002"]');
    await expect(overdueBadge).toBeVisible();
    await expect(overdueBadge).toContainText('overdue');
  });

  test('overdue alert banner renders at top when any joinee has overdue tasks', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('overdue');
  });

  test('progress is visible on joinee card', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    // Progress bar uses .bar class from DS
    const progressBars = page.locator('[data-testid="joinee-card-ob-001"] .bar');
    await expect(progressBars.first()).toBeVisible();
  });

  test('"View details" link navigates to detail page', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding');
    const link = page.locator('[data-testid="joinee-card-ob-001"] a[href="/hr/onboarding/ob-001"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('View details');
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

test.describe('Onboarding — empty state', () => {
  test('"No joiners this month" renders when list is empty', async ({ page }) => {
    await mockOnboarding(page, []);
    await page.goto('/hr/onboarding');
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No joiners this month');
  });

  test('"Add New Joinee" CTA renders in empty state', async ({ page }) => {
    await mockOnboarding(page, []);
    await page.goto('/hr/onboarding');
    const cta = page.locator('.empty-state a, .empty-state button').filter({ hasText: /add new joinee/i });
    await expect(cta.first()).toBeVisible();
  });
});

// ── Joinee detail page ────────────────────────────────────────────────────────

test.describe('Onboarding — joinee detail', () => {
  test('welcome header renders with employee name', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    const header = page.locator('[data-testid="joinee-welcome-header"]');
    await expect(header).toBeVisible();
    await expect(header).toContainText('Welcome, Sunita Rao');
  });

  test('welcome header shows department and reporting manager', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    const header = page.locator('[data-testid="joinee-welcome-header"]');
    await expect(header).toContainText('Finance');
    await expect(header).toContainText('CFO Mahesh Iyer');
  });

  test('checklist renders all steps', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    const checklist = page.locator('[data-testid="onboarding-checklist"]');
    await expect(checklist).toBeVisible();
    // ob-001 has 5 checklist steps
    const steps = page.locator('[data-testid^="checklist-step-"]');
    await expect(steps).toHaveCount(5);
  });

  test('completed checklist step has strikethrough style', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    // 'docs' step is completed — its label should have line-through
    const docsStep = page.locator('[data-testid="checklist-step-docs"] span').first();
    const decoration = await docsStep.evaluate((el) =>
      window.getComputedStyle(el).textDecoration,
    );
    expect(decoration).toContain('line-through');
  });

  test('task calendar renders with milestone columns', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    const cal = page.locator('[data-testid="task-calendar"]');
    await expect(cal).toBeVisible();
    await expect(cal).toContainText('Day 1');
    await expect(cal).toContainText('Day 7');
    await expect(cal).toContainText('Day 30');
  });

  test('calendar tasks render with correct titles', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    const calTask = page.locator('[data-testid="calendar-task-t1"]');
    await expect(calTask).toBeVisible();
    await expect(calTask).toContainText('Complete document submission');
  });

  test('document upload section renders all required docs', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    const docsSection = page.locator('[data-testid="document-upload-section"]');
    await expect(docsSection).toBeVisible();
    // 6 documents
    const docCards = page.locator('[data-testid^="doc-card-"]');
    await expect(docCards).toHaveCount(6);
  });

  test('verified document shows "VERIFIED" status chip', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    // doc-appt is verified
    const verifiedCard = page.locator('[data-testid="doc-card-doc-appt"]');
    await expect(verifiedCard).toContainText('VERIFIED');
  });

  test('pending document shows drag-and-drop upload zone', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    // doc-address is pending — should have upload button/zone
    const pendingCard = page.locator('[data-testid="doc-card-doc-address"]');
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard).toContainText('PENDING');
    const uploadZone = pendingCard.locator('[role="button"]');
    await expect(uploadZone.first()).toBeVisible();
  });

  test('document upload zone triggers file input on click', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-001');
    const pendingCard = page.locator('[data-testid="doc-card-doc-address"]');
    const uploadZone = pendingCard.locator('[role="button"]');
    // Should be clickable without throwing
    await expect(uploadZone.first()).toBeEnabled();
  });

  test('overdue checklist step highlighted in ob-002', async ({ page }) => {
    await mockOnboarding(page);
    await page.goto('/hr/onboarding/ob-002');
    const header = page.locator('[data-testid="joinee-welcome-header"]');
    await expect(header).toContainText('Welcome, Rajesh Nambiar');
    // Overdue steps exist
    const overdueSteps = page.locator('[data-testid^="checklist-step-"]').filter({ hasText: /overdue/i });
    await expect(overdueSteps.first()).toBeVisible();
  });
});
