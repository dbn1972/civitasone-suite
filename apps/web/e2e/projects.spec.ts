import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('link', { name: 'Projects List' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Milestones' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fund Releases' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Schemes' })).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('projects dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/projects/dashboard');
    await expect(page.getByText(/project/i).first()).toBeVisible();
  });

  // ── Projects list ─────────────────────────────────────────────────────────

  test('projects list shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/list');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Project Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Scheme' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('projects list shows seeded project PROJ-001', async ({ page }) => {
    await page.goto('/projects/list');
    await expect(page.getByRole('cell', { name: 'PROJ-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Highway Expansion' })).toBeVisible();
  });

  // ── Project detail ────────────────────────────────────────────────────────

  test('project detail shows heading', async ({ page }) => {
    await page.goto('/projects/prj-001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('project detail shows project name', async ({ page }) => {
    await page.goto('/projects/prj-001');
    await expect(page.getByText('Highway Expansion Phase 1')).toBeVisible();
  });

  test('project detail shows milestones section', async ({ page }) => {
    await page.goto('/projects/prj-001');
    await expect(page.getByText(/milestone/i)).toBeVisible();
  });

  test('navigating projects list → detail shows project detail', async ({ page }) => {
    await page.goto('/projects/list');
    await page.getByRole('link', { name: 'PROJ-001' }).click();
    await expect(page.getByText('Highway Expansion Phase 1')).toBeVisible();
  });

  // ── Sub-lists ─────────────────────────────────────────────────────────────

  test('milestones page shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/milestones');
    await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Milestone Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('schemes page shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/schemes');
    await expect(page.getByRole('heading', { name: 'Schemes' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Scheme Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('fund releases page loads without error', async ({ page }) => {
    await page.goto('/projects/fund-releases');
    await expect(page.getByRole('heading', { name: /fund release/i })).toBeVisible();
  });
});
