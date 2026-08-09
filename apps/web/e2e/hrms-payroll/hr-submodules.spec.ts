/**
 * E2E: HR Sub-modules — Training, Appraisals, Disciplinary, Org Chart, etc.
 *
 * Exercises page loading and basic rendering for all HRMS secondary modules:
 * - Training programs and nominations
 * - Performance appraisals
 * - Disciplinary proceedings
 * - Organization chart
 * - Service book
 * - Onboarding
 * - Deputation
 * - Work-from-home
 * - Benefits, expenses, travel, loans
 * - Skills, certifications, goals
 * - Confirmation, vigilance, grievance
 * - Employee directory, departments, designations
 * - Pay matrix, salary structure
 */
import { test, expect } from '@playwright/test';
import { setupHrmsPage } from './helpers';

test.describe('HR Sub-modules', () => {
  test.beforeEach(async ({ page }) => {
    await setupHrmsPage(page);
  });

  // ── Training ─────────────────────────────────────────────────────────────

  test.describe('Training', () => {
    test('training programs page loads', async ({ page }) => {
      await page.goto('/hr/training');
      await expect(page.getByRole('heading', { name: /training/i })).toBeVisible();
    });

    test('training nominations page loads', async ({ page }) => {
      await page.goto('/hr/training/nominations');
      await expect(page.getByRole('heading', { name: /nomination/i })).toBeVisible();
    });

    test('training feedback page loads', async ({ page }) => {
      await page.goto('/hr/training/feedback');
      await expect(page.getByRole('heading', { name: /feedback/i })).toBeVisible();
    });

    test('new training program page loads', async ({ page }) => {
      await page.goto('/hr/training/new');
      await expect(page.getByRole('heading', { name: /new.*training|create.*program/i })).toBeVisible();
    });
  });

  // ── Appraisals ───────────────────────────────────────────────────────────

  test.describe('Appraisals', () => {
    test('appraisals page loads', async ({ page }) => {
      await page.goto('/hr/appraisals');
      await expect(page.getByRole('heading', { name: /appraisal/i })).toBeVisible();
    });

    test('new appraisal page loads', async ({ page }) => {
      await page.goto('/hr/appraisals/new');
      await expect(page.getByRole('heading', { name: /new.*appraisal|create.*appraisal/i })).toBeVisible();
    });
  });

  // ── Disciplinary ─────────────────────────────────────────────────────────

  test.describe('Disciplinary', () => {
    test('disciplinary page loads', async ({ page }) => {
      await page.route('**/api/v1/hrms/disciplinary*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
      );
      await page.goto('/hr/disciplinary');
      await expect(page.getByRole('heading', { name: /disciplin/i })).toBeVisible();
    });
  });

  // ── Organisation Chart ───────────────────────────────────────────────────

  test.describe('Org Chart', () => {
    test('org chart page loads', async ({ page }) => {
      await page.goto('/hr/orgchart');
      await expect(page.getByRole('heading', { name: /org.*chart|organisation|organization/i })).toBeVisible();
    });
  });

  // ── Service Book ─────────────────────────────────────────────────────────

  test.describe('Service Book', () => {
    test('service book page loads', async ({ page }) => {
      await page.goto('/hr/service-book');
      await expect(page.getByRole('heading', { name: /service.*book/i })).toBeVisible();
    });
  });

  // ── Onboarding ───────────────────────────────────────────────────────────

  test.describe('Onboarding', () => {
    test('onboarding page loads', async ({ page }) => {
      await page.goto('/hr/onboarding');
      await expect(page.getByRole('heading', { name: /onboard/i })).toBeVisible();
    });
  });

  // ── Deputation ───────────────────────────────────────────────────────────

  test.describe('Deputation', () => {
    test('deputation page loads', async ({ page }) => {
      await page.goto('/hr/deputation');
      await expect(page.getByRole('heading', { name: /deputation/i })).toBeVisible();
    });
  });

  // ── Work from Home ───────────────────────────────────────────────────────

  test.describe('Work from Home', () => {
    test('WFH page loads', async ({ page }) => {
      await page.goto('/hr/wfh');
      await expect(page.getByRole('heading', { name: /work.*from.*home|wfh|remote/i })).toBeVisible();
    });
  });

  // ── Benefits ─────────────────────────────────────────────────────────────

  test.describe('Benefits', () => {
    test('benefits page loads', async ({ page }) => {
      await page.goto('/hr/benefits');
      await expect(page.getByRole('heading', { name: /benefit/i })).toBeVisible();
    });
  });

  // ── Expenses ─────────────────────────────────────────────────────────────

  test.describe('Expenses', () => {
    test('expenses page loads', async ({ page }) => {
      await page.goto('/hr/expenses');
      await expect(page.getByRole('heading', { name: /expense/i })).toBeVisible();
    });
  });

  // ── Travel ───────────────────────────────────────────────────────────────

  test.describe('Travel', () => {
    test('travel page loads', async ({ page }) => {
      await page.goto('/hr/travel');
      await expect(page.getByRole('heading', { name: /travel/i })).toBeVisible();
    });
  });

  // ── Loans ────────────────────────────────────────────────────────────────

  test.describe('Loans (HR)', () => {
    test('loans page loads', async ({ page }) => {
      await page.goto('/hr/loans');
      await expect(page.getByRole('heading', { name: /loan/i })).toBeVisible();
    });
  });

  // ── Advances ─────────────────────────────────────────────────────────────

  test.describe('Advances', () => {
    test('advances page loads', async ({ page }) => {
      await page.goto('/hr/advances');
      await expect(page.getByRole('heading', { name: /advance/i })).toBeVisible();
    });
  });

  // ── Skills ───────────────────────────────────────────────────────────────

  test.describe('Skills', () => {
    test('skills page loads', async ({ page }) => {
      await page.goto('/hr/skills');
      await expect(page.getByRole('heading', { name: /skill/i })).toBeVisible();
    });
  });

  // ── Certifications ───────────────────────────────────────────────────────

  test.describe('Certifications', () => {
    test('certifications page loads', async ({ page }) => {
      await page.goto('/hr/certifications');
      await expect(page.getByRole('heading', { name: /certific/i })).toBeVisible();
    });
  });

  // ── Goals ────────────────────────────────────────────────────────────────

  test.describe('Goals', () => {
    test('goals page loads', async ({ page }) => {
      await page.goto('/hr/goals');
      await expect(page.getByRole('heading', { name: /goal/i })).toBeVisible();
    });
  });

  // ── Confirmation ─────────────────────────────────────────────────────────

  test.describe('Confirmation', () => {
    test('confirmation page loads', async ({ page }) => {
      await page.goto('/hr/confirmation');
      await expect(page.getByRole('heading', { name: /confirm/i })).toBeVisible();
    });
  });

  // ── Vigilance ────────────────────────────────────────────────────────────

  test.describe('Vigilance', () => {
    test('vigilance page loads', async ({ page }) => {
      await page.goto('/hr/vigilance');
      await expect(page.getByRole('heading', { name: /vigilance/i })).toBeVisible();
    });
  });

  // ── Grievance ────────────────────────────────────────────────────────────

  test.describe('Grievance', () => {
    test('grievance page loads', async ({ page }) => {
      await page.goto('/hr/grievance');
      await expect(page.getByRole('heading', { name: /grievance/i })).toBeVisible();
    });
  });

  // ── Employee Directory ───────────────────────────────────────────────────

  test.describe('Directory', () => {
    test('employee directory page loads', async ({ page }) => {
      await page.goto('/hr/directory');
      await expect(page.getByRole('heading', { name: /directory/i })).toBeVisible();
    });
  });

  // ── Departments ──────────────────────────────────────────────────────────

  test.describe('Departments', () => {
    test('departments page loads', async ({ page }) => {
      await page.goto('/hr/departments');
      await expect(page.getByRole('heading', { name: /department/i })).toBeVisible();
    });
  });

  // ── Designations ─────────────────────────────────────────────────────────

  test.describe('Designations', () => {
    test('designations page loads', async ({ page }) => {
      await page.goto('/hr/designations');
      await expect(page.getByRole('heading', { name: /designation/i })).toBeVisible();
    });
  });

  // ── Employee Types ───────────────────────────────────────────────────────

  test.describe('Employee Types', () => {
    test('employee types page loads', async ({ page }) => {
      await page.goto('/hr/employee-types');
      await expect(page.getByRole('heading', { name: /employee.*type/i })).toBeVisible();
    });
  });

  // ── Pay Matrix ───────────────────────────────────────────────────────────

  test.describe('Pay Matrix', () => {
    test('pay matrix page loads', async ({ page }) => {
      await page.goto('/hr/pay-matrix');
      await expect(page.getByRole('heading', { name: /pay.*matrix/i })).toBeVisible();
    });
  });

  // ── Salary Structure ─────────────────────────────────────────────────────

  test.describe('Salary Structure', () => {
    test('salary structure page loads', async ({ page }) => {
      await page.goto('/hr/salary-structure');
      await expect(page.getByRole('heading', { name: /salary.*structure/i })).toBeVisible();
    });
  });

  // ── Staffing Plan ────────────────────────────────────────────────────────

  test.describe('Staffing Plan', () => {
    test('staffing plan page loads', async ({ page }) => {
      await page.goto('/hr/staffing-plan');
      await expect(page.getByRole('heading', { name: /staffing.*plan/i })).toBeVisible();
    });
  });

  // ── Interns ──────────────────────────────────────────────────────────────

  test.describe('Interns', () => {
    test('interns page loads', async ({ page }) => {
      await page.goto('/hr/interns');
      await expect(page.getByRole('heading', { name: /intern/i })).toBeVisible();
    });
  });

  // ── Outsourced ───────────────────────────────────────────────────────────

  test.describe('Outsourced', () => {
    test('outsourced page loads', async ({ page }) => {
      await page.goto('/hr/outsourced');
      await expect(page.getByRole('heading', { name: /outsourc/i })).toBeVisible();
    });
  });

  // ── Contractual ──────────────────────────────────────────────────────────

  test.describe('Contractual', () => {
    test('contractual page loads', async ({ page }) => {
      await page.goto('/hr/contractual');
      await expect(page.getByRole('heading', { name: /contract/i })).toBeVisible();
    });
  });

  // ── ID Cards ─────────────────────────────────────────────────────────────

  test.describe('ID Cards', () => {
    test('ID cards page loads', async ({ page }) => {
      await page.goto('/hr/id-cards');
      await expect(page.getByRole('heading', { name: /id.*card/i })).toBeVisible();
    });
  });

  // ── Work Summary ─────────────────────────────────────────────────────────

  test.describe('Work Summary', () => {
    test('work summary page loads', async ({ page }) => {
      await page.goto('/hr/work-summary');
      await expect(page.getByRole('heading', { name: /work.*summary/i })).toBeVisible();
    });
  });

  // ── Social Feed ──────────────────────────────────────────────────────────

  test.describe('Social Feed', () => {
    test('social feed page loads', async ({ page }) => {
      await page.goto('/hr/social-feed');
      await expect(page.getByRole('heading', { name: /social|feed|announcement/i })).toBeVisible();
    });
  });
});
