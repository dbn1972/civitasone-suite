import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// /policy is the policy-service console: bindings, ABAC rules, role features and the evaluate probe.
test.describe('Policy', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub shows the six policy entry points with their destinations', async ({ page }) => {
    await page.goto('/policy');
    await expect(page.locator('#page-heading:visible')).toContainText('Policy');
    await expect(page.getByText('RBAC bindings, ABAC rules, permission evaluation and role-feature visibility.')).toBeVisible();
    const expected: Array<[string, string]> = [
      ['Roles', '/tenant-admin/roles'],
      ['Bindings', '/policy/bindings'],
      ['ABAC Rules', '/policy/abac'],
      ['Evaluate', '/policy/evaluate'],
      ['Role Features', '/policy/role-features'],
      ['Break-glass access', '/tenant-admin/breakglass'],
    ];
    for (const [label, href] of expected) {
      await expect(page.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('href', href);
    }
  });

  test('hub link opens the role bindings screen', async ({ page }) => {
    await page.goto('/policy');
    await page.getByRole('link', { name: /^Bindings/ }).click();
    await expect(page).toHaveURL(/\/policy\/bindings/);
    await expect(page.locator('#page-heading:visible')).toContainText('Role Bindings');
  });

  test('bindings resolve user and role names and count active versus revoked', async ({ page }) => {
    await page.goto('/policy/bindings');
    await expect(page.locator('#page-heading:visible')).toContainText('Role Bindings');
    const main = page.locator('main');
    await expect(main).toContainText(/Total\s*2/);
    await expect(main).toContainText(/Active\s*1/);
    await expect(main).toContainText(/Revoked\s*1/);
    const resolved = page.getByRole('row', { name: /Admin User/ });
    await expect(resolved).toContainText('admin');
    await expect(resolved).toContainText('Active');
    await expect(resolved.getByText('Revoke')).toBeVisible();
    // Ids with no matching user or role fall back to a short id and the binding is shown revoked.
    const revoked = page.getByRole('row', { name: /f2345678/ });
    await expect(revoked).toContainText('e5678901');
    await expect(revoked).toContainText('Revoked');
    await expect(page.getByText('Create binding').first()).toBeVisible();
  });

  test('ABAC rules show effect, conditions, role and enabled state', async ({ page }) => {
    await page.goto('/policy/abac');
    await expect(page.locator('#page-heading:visible')).toContainText('ABAC Rules');
    const main = page.locator('main');
    await expect(main).toContainText(/Rules\s*2/);
    await expect(main).toContainText(/Enabled\s*1/);
    await expect(main).toContainText(/Deny effect\s*1/);
    for (const col of ['Action', 'Resource', 'Effect', 'Conditions', 'Role', 'Enabled', 'Id']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    const deny = page.getByRole('row', { name: /finance\.ledger/ });
    await expect(deny).toContainText('Deny');
    await expect(deny).toContainText('subject.department = "IT"');
    await expect(deny).toContainText('Enabled');
    const allow = page.getByRole('row', { name: /hrms\.leave/ });
    await expect(allow).toContainText('Allow');
    await expect(allow).toContainText('Applies to all');
    await expect(allow).toContainText('Disabled');
  });

  test('role features list grants with revoke and restore actions', async ({ page }) => {
    await page.goto('/policy/role-features');
    await expect(page.locator('#page-heading:visible')).toContainText('Role Features');
    const main = page.locator('main');
    await expect(main).toContainText(/Grants\s*2/);
    await expect(main).toContainText(/Roles with grants\s*2/);
    const payroll = page.getByRole('row', { name: /hr\.payroll\.view/ });
    await expect(payroll).toContainText('hr_officer');
    await expect(payroll).toContainText('Granted');
    await expect(payroll.getByText('Revoke')).toBeVisible();
    const exportRow = page.getByRole('row', { name: /dms\.export/ });
    await expect(exportRow).toContainText('records_clerk');
    await expect(exportRow).toContainText('Revoked');
    await expect(exportRow.getByText('Restore')).toBeVisible();
    await expect(page.getByText('Dotted key, e.g. finance.dashboard')).toBeVisible();
  });

  test('evaluate shows the decision, reason and a link to the matched rule', async ({ page }) => {
    let posted: Record<string, unknown> | null = null;
    await page.route('**/api/proxy/v1/policy/evaluate', async (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          decision: 'deny',
          reason: 'Denied by ABAC rule: department is IT',
          matchedRuleId: 'c1000000-0000-4000-8000-000000000001',
        }),
      });
    });
    await page.goto('/policy/evaluate');
    await expect(page.locator('#page-heading:visible')).toContainText('Evaluate Permission');
    await page.getByPlaceholder('service.resource.action').fill('finance.ledger.read');
    await page.locator('textarea').fill('{"department":"IT"}');
    await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
    const result = page.getByRole('status').filter({ hasText: 'Decision:' });
    await expect(result).toContainText('Deny');
    await expect(result).toContainText('Denied by ABAC rule: department is IT');
    await expect(result.getByRole('link', { name: 'View rule' })).toHaveAttribute(
      'href',
      '/policy/abac#rule-c1000000-0000-4000-8000-000000000001',
    );
    expect(posted).toMatchObject({ permissionKey: 'finance.ledger.read', resource: { department: 'IT' } });
  });

  test('evaluate rejects malformed resource JSON without calling the service', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/proxy/v1/policy/evaluate', async (route) => {
      calls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/policy/evaluate');
    await page.locator('textarea').fill('{not json');
    await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
    await expect(page.getByText('Invalid JSON in resource field')).toBeVisible();
    await page.locator('textarea').fill('[1, 2]');
    await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
    await expect(page.getByText('Resource must be a JSON object')).toBeVisible();
    expect(calls).toBe(0);
  });

  test('evaluate surfaces a service failure as an alert', async ({ page }) => {
    await page.route('**/api/proxy/v1/policy/evaluate', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL', message: 'boom' }) }),
    );
    await page.goto('/policy/evaluate');
    await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /couldn't/i })).toBeVisible();
    await expect(page.getByText('Decision:')).toHaveCount(0);
  });

  test('empty bindings show the empty state with zero counts', async ({ page }) => {
    await authenticate(page, 'empty');
    await page.goto('/policy/bindings');
    await expect(page.locator('#page-heading:visible')).toContainText('Role Bindings');
    await expect(page.getByText('No bindings found')).toBeVisible();
    await expect(page.getByText('User–role bindings will appear here once assigned for this tenant.')).toBeVisible();
    await expect(page.locator('main')).toContainText(/Total\s*0/);
  });

  test('a failed ABAC load shows a retry state with dashes instead of counts', async ({ page }) => {
    await authenticate(page, 'down');
    await page.goto('/policy/abac');
    await expect(page.locator('#page-heading:visible')).toContainText('ABAC Rules');
    await expect(page.getByText("We couldn't load ABAC rules.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('main')).toContainText(/Rules\s*—/);
    await expect(page.getByRole('columnheader', { name: 'Conditions' })).toHaveCount(0);
  });
});
