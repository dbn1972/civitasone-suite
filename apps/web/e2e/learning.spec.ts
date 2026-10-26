import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// /learning reads hrms-service's learning and assessment routes. The mock gateway filters
// /v1/hrms/learning/courses on ?q=, so the catalogue search below is a real server-side search.
test.describe('Learning', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('home shows the personal progress tiles and the course catalogue', async ({ page }) => {
    await page.goto('/learning');
    await expect(page.locator('#page-heading:visible')).toContainText('Learning & Development');
    const main = page.locator('main');
    await expect(main).toContainText(/Enrolled\s*2/);
    await expect(main).toContainText(/In Progress\s*1/);
    await expect(main).toContainText(/Completed\s*1/);
    await expect(main).toContainText(/Overdue\s*0/);
    for (const col of ['Code', 'Title', 'Category', 'Credit hours', 'Status']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    const eof = page.getByRole('row', { name: /e-Office Fundamentals/ });
    await expect(eof).toContainText('e-Office Fundamentals');
    await expect(eof).toContainText('6 hrs');
    await expect(page.getByRole('row', { name: /GFR and Procurement Basics/ })).toContainText('FIN-110');
  });

  test('home tiles point at the viewer-scoped learning screens', async ({ page }) => {
    await page.goto('/learning');
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: /Enrolled/ })).toHaveAttribute(
      'href',
      '/learning/my-learning?employeeId=e0000000-0000-4000-8000-000000000001',
    );
    await expect(main.getByRole('link', { name: /Training Calendar/ })).toHaveAttribute('href', '/learning/calendar');
    await expect(main.getByRole('link', { name: /Competencies/ })).toHaveAttribute('href', '/learning/competency');
    await expect(main.getByRole('link', { name: /Assessments/ })).toHaveAttribute('href', '/learning/assessments');
    await expect(main.getByRole('link', { name: /Training Plans/ })).toHaveAttribute('href', '/learning/training-plans');
    await main.getByRole('link', { name: 'Browse all' }).click();
    await expect(page).toHaveURL(/\/learning\/courses/);
    await expect(page.locator('#page-heading:visible')).toContainText('Course Catalogue');
  });

  test('catalogue shows each course with the learner\'s own status', async ({ page }) => {
    await page.goto('/learning/courses');
    await expect(page.locator('#page-heading:visible')).toContainText('Course Catalogue');
    await expect(page.getByText('3 courses')).toBeVisible();
    await expect(page.getByRole('row', { name: /e-Office Fundamentals/ })).toContainText('In Progress');
    await expect(page.getByRole('row', { name: /Cyber Hygiene for Officers/ })).toContainText('Completed');
    await expect(page.getByRole('row', { name: /GFR and Procurement Basics/ })).toContainText('—');
    await expect(page.getByRole('link', { name: /Cyber Hygiene for Officers/ })).toHaveAttribute(
      'href',
      '/learning/courses/71000000-0000-4000-8000-000000000002',
    );
  });

  test('searching the catalogue filters on the server', async ({ page }) => {
    await page.goto('/learning/courses');
    await page.getByRole('searchbox', { name: 'Search courses' }).fill('cyber');
    await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=cyber/);
    await expect(page.getByText('1 course', { exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: /Cyber Hygiene for Officers/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /e-Office Fundamentals/ })).toHaveCount(0);
  });

  test('a search with no match shows the empty state', async ({ page }) => {
    await page.goto('/learning/courses?q=zzzz');
    await expect(page.getByText('No courses found')).toBeVisible();
    await expect(page.getByText('No courses match your search. Try a different term.')).toBeVisible();
    await expect(page.getByText('0 courses')).toBeVisible();
  });

  test('my learning shows progress and a continue action per enrolment', async ({ page }) => {
    await page.goto('/learning/my-learning');
    await expect(page.locator('#page-heading:visible')).toContainText('My Learning');
    await expect(page.getByText('Your course enrolments, progress and resume point.')).toBeVisible();
    const inProgress = page.getByRole('row', { name: /e-Office Fundamentals/ });
    await expect(inProgress).toContainText('EOF-101');
    await expect(inProgress).toContainText('40%');
    await expect(inProgress).toContainText('In Progress');
    await expect(inProgress).toContainText('Continue');
    const done = page.getByRole('row', { name: /Cyber Hygiene for Officers/ });
    await expect(done).toContainText('100%');
    await expect(done).toContainText('Completed');
    await expect(done).not.toContainText('Continue');
  });

  test('no enrolments shows the empty state', async ({ page }) => {
    await authenticate(page, 'empty');
    await page.goto('/learning/my-learning');
    await expect(page.locator('#page-heading:visible')).toContainText('My Learning');
    await expect(page.getByText('No enrolments yet')).toBeVisible();
    await expect(page.getByText('Enrol in a published course from the catalogue to start learning.')).toBeVisible();
  });

  test('training plans list the year, scope and status of each plan', async ({ page }) => {
    await page.goto('/learning/training-plans');
    await expect(page.locator('#page-heading:visible')).toContainText('Training Plans');
    await expect(page.getByText('Showing 2 of 2 plans')).toBeVisible();
    const annual = page.getByRole('row', { name: /Annual Training Plan 2026-27/ });
    await expect(annual).toContainText('FY 2026-27');
    await expect(annual).toContainText('All staff');
    await expect(annual).toContainText('Approved');
    const finance = page.getByRole('row', { name: /Finance Cadre Upskilling/ });
    await expect(finance).toContainText('Role: finance_officer');
    await expect(finance).toContainText('Draft');
    await expect(page.getByRole('link', { name: '+ New plan' })).toHaveAttribute('href', '/learning/training-plans/new');
  });

  test('assessments list passing score, duration and attempts', async ({ page }) => {
    await page.goto('/learning/assessments');
    await expect(page.locator('#page-heading:visible')).toContainText('Assessments');
    const gfr = page.getByRole('row', { name: /GFR Basics Assessment/ });
    await expect(gfr).toContainText('60 marks');
    await expect(gfr).toContainText('45 min');
    await expect(gfr).toContainText('Published');
    await expect(page.getByRole('row', { name: /Data Protection Awareness/ })).toContainText('3');
    await expect(page.getByRole('link', { name: 'Verify a certificate' })).toHaveAttribute('href', '/learning/assessments/verify');
  });

  test('a failed dashboard load shows a retry state in place of the tiles', async ({ page }) => {
    await authenticate(page, 'down');
    await page.goto('/learning');
    await expect(page.locator('#page-heading:visible')).toContainText('Learning & Development');
    await expect(page.getByText("We couldn't load learning dashboard.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Course catalogue' })).toHaveCount(0);
  });
});
