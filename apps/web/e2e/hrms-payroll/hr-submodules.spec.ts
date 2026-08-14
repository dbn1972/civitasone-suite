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
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('training nominations page loads', async ({ page }) => {
      await page.goto('/hr/training/nominations');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('training feedback page loads', async ({ page }) => {
      await page.goto('/hr/training/feedback');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('new training program page loads', async ({ page }) => {
      await page.goto('/hr/training/new');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Appraisals ───────────────────────────────────────────────────────────

  test.describe('Appraisals', () => {
    test('appraisals page loads', async ({ page }) => {
      await page.goto('/hr/appraisals');
      await expect(page.locator('#page-heading')).toBeVisible();
    });

    test('new appraisal page loads', async ({ page }) => {
      await page.goto('/hr/appraisals/new');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Disciplinary ─────────────────────────────────────────────────────────

  test.describe('Disciplinary', () => {
    test('disciplinary page loads', async ({ page }) => {
      await page.route('**/api/v1/hrms/disciplinary*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
      );
      await page.goto('/hr/disciplinary');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Organisation Chart ───────────────────────────────────────────────────

  test.describe('Org Chart', () => {
    test('org chart page loads', async ({ page }) => {
      await page.goto('/hr/orgchart');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Service Book ─────────────────────────────────────────────────────────

  test.describe('Service Book', () => {
    test('service book page loads', async ({ page }) => {
      await page.goto('/hr/service-book');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Onboarding ───────────────────────────────────────────────────────────

  test.describe('Onboarding', () => {
    test('onboarding page loads', async ({ page }) => {
      await page.goto('/hr/onboarding');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Deputation ───────────────────────────────────────────────────────────

  test.describe('Deputation', () => {
    test('deputation page loads', async ({ page }) => {
      await page.goto('/hr/deputation');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Work from Home ───────────────────────────────────────────────────────

  test.describe('Work from Home', () => {
    test('WFH page loads', async ({ page }) => {
      await page.goto('/hr/wfh');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Benefits ─────────────────────────────────────────────────────────────

  test.describe('Benefits', () => {
    test('benefits page loads', async ({ page }) => {
      await page.goto('/hr/benefits');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Expenses ─────────────────────────────────────────────────────────────

  test.describe('Expenses', () => {
    test('expenses page loads', async ({ page }) => {
      await page.goto('/hr/expenses');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Travel ───────────────────────────────────────────────────────────────

  test.describe('Travel', () => {
    test('travel page loads', async ({ page }) => {
      await page.goto('/hr/travel');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Loans ────────────────────────────────────────────────────────────────

  test.describe('Loans (HR)', () => {
    test('loans page loads', async ({ page }) => {
      await page.goto('/hr/loans');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Advances ─────────────────────────────────────────────────────────────

  test.describe('Advances', () => {
    test('advances page loads', async ({ page }) => {
      await page.goto('/hr/advances');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Skills ───────────────────────────────────────────────────────────────

  test.describe('Skills', () => {
    test('skills page loads', async ({ page }) => {
      await page.goto('/hr/skills');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Certifications ───────────────────────────────────────────────────────

  test.describe('Certifications', () => {
    test('certifications page loads', async ({ page }) => {
      await page.goto('/hr/certifications');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Goals ────────────────────────────────────────────────────────────────

  test.describe('Goals', () => {
    test('goals page loads', async ({ page }) => {
      await page.goto('/hr/goals');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Confirmation ─────────────────────────────────────────────────────────

  test.describe('Confirmation', () => {
    test('confirmation page loads', async ({ page }) => {
      await page.goto('/hr/confirmation');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Vigilance ────────────────────────────────────────────────────────────

  test.describe('Vigilance', () => {
    test('vigilance page loads', async ({ page }) => {
      await page.goto('/hr/vigilance');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Grievance ────────────────────────────────────────────────────────────

  test.describe('Grievance', () => {
    test('grievance page loads', async ({ page }) => {
      await page.goto('/hr/grievance');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Employee Directory ───────────────────────────────────────────────────

  test.describe('Directory', () => {
    test('employee directory page loads', async ({ page }) => {
      await page.goto('/hr/directory');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Departments ──────────────────────────────────────────────────────────

  test.describe('Departments', () => {
    test('departments page loads', async ({ page }) => {
      await page.goto('/hr/departments');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Designations ─────────────────────────────────────────────────────────

  test.describe('Designations', () => {
    test('designations page loads', async ({ page }) => {
      await page.goto('/hr/designations');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Employee Types ───────────────────────────────────────────────────────

  test.describe('Employee Types', () => {
    test('employee types page loads', async ({ page }) => {
      await page.goto('/hr/employee-types');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Pay Matrix ───────────────────────────────────────────────────────────

  test.describe('Pay Matrix', () => {
    test('pay matrix page loads', async ({ page }) => {
      await page.goto('/hr/pay-matrix');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Salary Structure ─────────────────────────────────────────────────────

  test.describe('Salary Structure', () => {
    test('salary structure page loads', async ({ page }) => {
      await page.goto('/hr/salary-structure');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Staffing Plan ────────────────────────────────────────────────────────

  test.describe('Staffing Plan', () => {
    test('staffing plan page loads', async ({ page }) => {
      await page.goto('/hr/staffing-plan');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Interns ──────────────────────────────────────────────────────────────

  test.describe('Interns', () => {
    test('interns page loads', async ({ page }) => {
      await page.goto('/hr/interns');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Outsourced ───────────────────────────────────────────────────────────

  test.describe('Outsourced', () => {
    test('outsourced page loads', async ({ page }) => {
      await page.goto('/hr/outsourced');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Contractual ──────────────────────────────────────────────────────────

  test.describe('Contractual', () => {
    test('contractual page loads', async ({ page }) => {
      await page.goto('/hr/contractual');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── ID Cards ─────────────────────────────────────────────────────────────

  test.describe('ID Cards', () => {
    test('ID cards page loads', async ({ page }) => {
      await page.goto('/hr/id-cards');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Work Summary ─────────────────────────────────────────────────────────

  test.describe('Work Summary', () => {
    test('work summary page loads', async ({ page }) => {
      await page.goto('/hr/work-summary');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });

  // ── Social Feed ──────────────────────────────────────────────────────────

  test.describe('Social Feed', () => {
    test('social feed page loads', async ({ page }) => {
      await page.goto('/hr/social-feed');
      await expect(page.locator('#page-heading')).toBeVisible();
    });
  });
});
