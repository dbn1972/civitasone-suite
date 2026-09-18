import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/projects');
    // REL-023: the hub's ModuleHub link for the list page is labelled
    // "Projects" (matching the short, single/double-word style of every
    // other link in this hub — Dashboard, Schemes, Milestones, Fund
    // Releases, Utilization, ...), not "Projects List".
    await expect(page.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
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
    // REL-023: card <h3>Projects</h3> also matches "Projects" now, alongside
    // the page's own <h1>Projects</h1>.
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Project Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Scheme' })).toBeVisible();
  });

  test('projects list shows seeded project PROJ-001', async ({ page }) => {
    await page.goto('/projects/list');
    // REL-023: ProjectsTable passes identifyingColumnKey="name" to DataTable,
    // which gives column 0's <a> (wrapping the "PROJ-001" cell) an
    // aria-label of "Open Highway Expansion Phase 1". Per the accessible-
    // name-from-content algorithm, that aria-label also becomes the
    // containing <td>'s computed name, so getByRole('cell', {name:
    // 'PROJ-001'}) can never match even though "PROJ-001" is genuinely
    // rendered on screen — getByText checks rendered text directly instead
    // of the (hijacked) accessible name.
    await expect(page.getByText('PROJ-001')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Highway Expansion Phase 1', exact: true })).toBeVisible();
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
    // REL-023: the detail page grew a full Gantt-style milestone timeline
    // (its own "Milestone Timeline" heading, a sortable "Milestone" column,
    // an sr-only caption, ...) alongside the original "Milestones" card, so
    // the untargeted /milestone/i text query now resolves to 5 elements.
    // The "Milestones" section heading specifically is still the right,
    // unambiguous signal that this section renders.
    await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
  });

  test('navigating projects list → detail shows project detail', async ({ page }) => {
    await page.goto('/projects/list');
    // REL-023: see "projects list shows seeded project PROJ-001" above —
    // the row-link's accessible name is "Open Highway Expansion Phase 1",
    // not "PROJ-001", so getByRole('link', {name:'PROJ-001'}) never
    // resolves even though the link (and its click behavior) work fine.
    await page.getByText('PROJ-001').click();
    await expect(page.getByText('Highway Expansion Phase 1')).toBeVisible();
  });

  // ── Sub-lists ─────────────────────────────────────────────────────────────

  test('milestones page shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/milestones');
    // REL-023: card <h3>Milestones</h3> also matches now, alongside the
    // page's own <h1>Milestones</h1>.
    await expect(page.getByRole('heading', { name: 'Milestones', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Milestone Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('schemes page shows heading and column headers', async ({ page }) => {
    await page.goto('/projects/schemes');
    // REL-023: card <h3>Schemes</h3> also matches now, alongside the page's
    // own <h1>Schemes</h1>.
    await expect(page.getByRole('heading', { name: 'Schemes', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Scheme Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('fund releases page loads without error', async ({ page }) => {
    await page.goto('/projects/fund-releases');
    // REL-023: card <h3>Fund Releases</h3> and empty-state <h4>No fund
    // releases</h4> also match /fund release/i now, alongside the page's
    // own <h1>Fund Release Tracking</h1>.
    await expect(page.getByRole('heading', { name: /fund release/i, level: 1 })).toBeVisible();
  });
});
