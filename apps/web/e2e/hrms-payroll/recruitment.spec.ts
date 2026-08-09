/**
 * E2E: Recruitment — Job Openings, Applications, Talent Pool
 *
 * Exercises:
 * - Recruitment dashboard with statistics
 * - Job openings list and detail
 * - New vacancy creation form
 * - Talent pool management
 * - Application tracking
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';
import * as fixtures from './fixtures';

test.describe('Recruitment', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  // ── Recruitment Dashboard ────────────────────────────────────────────────

  test.describe('Recruitment Page', () => {
    test('page loads with heading', async ({ page }) => {
      await page.goto('/hr/recruitment');
      await expect(page.getByRole('heading', { name: /recruitment/i })).toBeVisible();
    });

    test('shows stat cards with vacancy metrics', async ({ page }) => {
      await page.goto('/hr/recruitment');
      await expect(page.getByText(/total vacancies/i)).toBeVisible();
      await expect(page.getByText(/open now/i)).toBeVisible();
      await expect(page.getByText(/published/i)).toBeVisible();
      await expect(page.getByText(/applications received/i)).toBeVisible();
    });

    test('shows stat values from dashboard API', async ({ page }) => {
      await page.goto('/hr/recruitment');
      // recruitmentDashboard.totalOpenings = 5
      await expect(page.getByText('5')).toBeVisible();
      // openVacancies = 3
      await expect(page.getByText('3').first()).toBeVisible();
    });

    test('displays job openings table', async ({ page }) => {
      await page.goto('/hr/recruitment');
      await expect(page.getByText('Senior Software Engineer')).toBeVisible();
      await expect(page.getByText('Accounts Officer')).toBeVisible();
    });

    test('shows vacancy count and application count', async ({ page }) => {
      await page.goto('/hr/recruitment');
      await expect(page.getByText('28')).toBeVisible(); // applications for job-001
    });

    test('shows correct status for openings', async ({ page }) => {
      await page.goto('/hr/recruitment');
      await expect(page.getByText('published').first()).toBeVisible();
    });

    test('links to new vacancy page', async ({ page }) => {
      await page.goto('/hr/recruitment');
      const newBtn = page.getByRole('link', { name: /new vacancy/i });
      await expect(newBtn).toBeVisible();
      await expect(newBtn).toHaveAttribute('href', /\/hr\/recruitment\/new/);
    });

    test('links to talent pool', async ({ page }) => {
      await page.goto('/hr/recruitment');
      const poolLink = page.getByRole('link', { name: /talent pool/i });
      await expect(poolLink).toBeVisible();
    });

    test('links to public careers page', async ({ page }) => {
      await page.goto('/hr/recruitment');
      const careersLink = page.getByRole('link', { name: /careers/i });
      await expect(careersLink).toBeVisible();
    });

    test('shows empty state when no vacancies', async ({ page }) => {
      await page.route('**/api/v1/hrms/job-openings*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
      );
      await page.route('**/api/v1/hrms/recruitment/dashboard', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ totalOpenings: 0, openVacancies: 0, publishedVacancies: 0, internshipsApprenticeships: 0, applicationsInternal: 0, applicationsPublic: 0 }),
        }),
      );
      await page.goto('/hr/recruitment');
      await expect(page.getByText(/no vacancies/i)).toBeVisible();
    });
  });

  // ── New Vacancy Form ─────────────────────────────────────────────────────

  test.describe('New Vacancy', () => {
    test('new vacancy page loads', async ({ page }) => {
      await page.goto('/hr/recruitment/new');
      await expect(page.getByRole('heading', { name: /new.*vacancy|create.*vacancy|post.*job/i })).toBeVisible();
    });
  });

  // ── Talent Pool ──────────────────────────────────────────────────────────

  test.describe('Talent Pool', () => {
    test('talent pool page loads', async ({ page }) => {
      await page.goto('/hr/recruitment/talent-pool');
      await expect(page.getByRole('heading', { name: /talent.*pool/i })).toBeVisible();
    });
  });

  // ── Vacancy Detail ───────────────────────────────────────────────────────

  test.describe('Vacancy Detail', () => {
    test('vacancy detail page loads for known job', async ({ page }) => {
      await page.route('**/api/v1/hrms/job-openings/job-001', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fixtures.jobOpenings[0]),
        }),
      );
      await page.goto('/hr/recruitment/job-001');
      await expect(
        page.getByText('Senior Software Engineer').or(page.getByRole('heading', { name: /vacancy|job/i })),
      ).toBeVisible();
    });
  });
});
