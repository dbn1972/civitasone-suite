import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// /approvals is the workflow task inbox (GET /v1/workflow/tasks). The mock gateway serves 17 pending
// tasks 15 at a time, so the page-2 and filter tests exercise real limit/offset paging.
test.describe('Approvals', () => {
  test('shows the My Approvals heading and the whole-queue stat tiles', async ({ page }) => {
    await authenticate(page);
    await page.goto('/approvals');
    await expect(page.locator('#page-heading:visible')).toContainText('My Approvals');
    await expect(page.getByText('All pending items requiring your action across modules.')).toBeVisible();
    const main = page.locator('main');
    // Pending is the API's whole pending total (17), not the 15 rows on this page.
    await expect(main).toContainText(/Pending\s*17/);
    await expect(main).toContainText(/Overdue\s*1/);
    await expect(main).toContainText(/Modules\s*4/);
    await expect(main).toContainText(/Due within 7 days\s*2/);
    await expect(page.getByText('Showing 1–15 of 17.')).toBeVisible();
  });

  test('lists the tasks with module labels and flags the overdue one', async ({ page }) => {
    await authenticate(page);
    await page.goto('/approvals');
    for (const col of ['Task', 'Module', 'Assigned', 'Due', 'Status']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    const leave = page.getByRole('row', { name: /Leave approval - Ravi Kumar/ });
    await expect(leave).toContainText('Leave');
    await expect(leave).toContainText('15 Jan 2020');
    await expect(leave).toContainText('Overdue');
    await expect(page.getByRole('row', { name: /Purchase order PO-2026-0042/ })).toContainText('Procurement');
    await expect(page.getByRole('row', { name: /Bill approval - Stationery supply/ })).toContainText('Finance');
    await expect(page.getByRole('row', { name: /Estab file movement 1\b/ })).toContainText('Establishment');
    // Only the one past-due task carries the marker.
    await expect(page.getByText('Overdue', { exact: false }).filter({ hasText: '⚠️' })).toHaveCount(1);
  });

  test('each task links to the record it approves', async ({ page }) => {
    await authenticate(page);
    await page.goto('/approvals');
    await expect(page.getByRole('link', { name: 'Leave approval - Ravi Kumar' })).toHaveAttribute('href', '/hr/leave/approvals');
    await expect(page.getByRole('link', { name: 'Purchase order PO-2026-0042' })).toHaveAttribute(
      'href',
      '/procurement/orders/b3000000-0000-4000-8000-000000000002',
    );
    await expect(page.getByRole('link', { name: 'Bill approval - Stationery supply' })).toHaveAttribute(
      'href',
      '/finance/expenditure/bills/b3000000-0000-4000-8000-000000000003',
    );
  });

  test('the table filter narrows the rows to the typed task', async ({ page }) => {
    await authenticate(page);
    await page.goto('/approvals');
    await page.getByPlaceholder('Filter by name, module, status…').fill('purchase');
    await expect(page.getByRole('link', { name: 'Purchase order PO-2026-0042' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Leave approval - Ravi Kumar' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Bill approval - Stationery supply' })).toHaveCount(0);
  });

  test('the first page offers Next, and the second page serves the remaining tasks with Previous', async ({ page }) => {
    await authenticate(page);
    await page.goto('/approvals');
    const pager = page.getByRole('navigation', { name: 'Approvals pages' });
    await expect(pager).toContainText('Page 1');
    await expect(pager.getByRole('link', { name: /Previous/ })).toHaveCount(0);
    await expect(pager.getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/approvals?page=2');
    // Client-side Next: the table must swap to the page-2 rows, not keep page 1 rows.
    await pager.getByRole('link', { name: /Next/ }).click();
    await expect(page).toHaveURL(/\/approvals\?page=2/);
    await expect(page.getByText('Showing 16–17 of 17.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Estab file movement 13' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Leave approval - Ravi Kumar' })).toHaveCount(0);
    // A full load of page 2: the API is asked for offset 15 and answers the last two tasks.
    await page.goto('/approvals?page=2');
    await expect(pager).toContainText('Page 2');
    await expect(page.getByText('Showing 16–17 of 17.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Estab file movement 13' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Estab file movement 14' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Leave approval - Ravi Kumar' })).toHaveCount(0);
    await expect(pager.getByRole('link', { name: /Next/ })).toHaveCount(0);
    await expect(pager.getByRole('link', { name: /Previous/ })).toHaveAttribute('href', '/approvals?page=1');
  });

  test('an empty queue says everything is done', async ({ page }) => {
    await authenticate(page, 'empty');
    await page.goto('/approvals');
    await expect(page.locator('#page-heading:visible')).toContainText('My Approvals');
    await expect(page.getByText('No pending approvals').first()).toBeVisible();
    await expect(page.getByText("You're all caught up. No items need your attention right now.")).toBeVisible();
    await expect(page.locator('main')).toContainText(/Pending\s*0/);
    await expect(page.getByRole('columnheader', { name: 'Task' })).toHaveCount(0);
  });

  test('a failed load shows a retry state, not zeros', async ({ page }) => {
    await authenticate(page, 'down');
    await page.goto('/approvals');
    await expect(page.locator('#page-heading:visible')).toContainText('My Approvals');
    await expect(page.getByText("We couldn't load your approvals.")).toBeVisible();
    await expect(page.getByText("The workflow service didn't respond. Try again in a moment.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('main')).toContainText(/Pending\s*—/);
    await expect(page.getByText('No pending approvals')).toHaveCount(0);
  });
});
