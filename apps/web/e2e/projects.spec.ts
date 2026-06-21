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

  test('projects list shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/list');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Project Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Scheme' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Start Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Budget (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Expenditure (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Completion %' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('projects list shows seeded project PROJ-001', async ({ page }) => {
    await page.goto('/projects/list');
    await expect(page.getByRole('cell', { name: 'PROJ-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Highway Expansion' })).toBeVisible();
  });

  test('milestones page shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/milestones');
    await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Project Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Milestone Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Due Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Completed Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('schemes page shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/schemes');
    await expect(page.getByRole('heading', { name: 'Schemes' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Scheme Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Ministry' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Funding Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Allocation (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Released (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });
});
