import { test } from '@playwright/test';
import { authenticate } from './helpers/auth';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Module-wise desktop screenshot capture for functional review.
 * Reuses the E2E mock-gateway (port 4001, DIC trial fixtures) + dev auth cookie.
 * Output: docs/screenshots/<module>/<screen>.png  +  results.json
 *
 * Run: pnpm --filter @civitasone/web exec playwright test screenshots --project=chromium
 */

const OUT = join(process.cwd(), '..', '..', 'docs', 'screenshots');

const MODULES: Record<string, Array<{ label: string; path: string }>> = {
  'Dashboard': [{ label: 'Command Centre', path: '/dashboard' }],
  'Finance': [
    { label: 'Dashboard', path: '/finance/dashboard' },
    { label: 'Chart of Accounts', path: '/finance/chart-of-accounts' },
    { label: 'Payments', path: '/finance/payments' },
  ],
  'HR': [
    { label: 'Dashboard', path: '/hr/dashboard' },
    { label: 'Employees', path: '/hr/employees' },
    { label: 'Org Chart', path: '/hr/orgchart' },
  ],
  'Procurement': [
    { label: 'Dashboard', path: '/procurement/dashboard' },
    { label: 'Vendors', path: '/procurement/vendors' },
  ],
  'Projects': [
    { label: 'Projects', path: '/projects/list' },
    { label: 'Milestones', path: '/projects/milestones' },
  ],
  'Grants': [
    { label: 'Grants', path: '/grants/list' },
    { label: 'Grantees', path: '/grants/grantees' },
  ],
  'Assets': [
    { label: 'Fixed Assets', path: '/assets/fixed-assets' },
    { label: 'Maintenance', path: '/assets/maintenance' },
  ],
  'Citizen': [
    { label: 'RTI', path: '/citizen/rti' },
    { label: 'Requests', path: '/citizen/requests' },
  ],
  'CRM': [
    { label: 'Contacts', path: '/crm/contacts' },
    { label: 'Dashboard', path: '/crm/dashboard' },
  ],
  'Audit': [
    { label: 'Observations', path: '/audit/observations' },
  ],
  'Legal': [
    { label: 'Cases', path: '/legal/list' },
  ],
  'Establishment': [
    { label: 'Files (eOffice)', path: '/estab/list' },
    { label: 'Meetings', path: '/estab/meetings' },
  ],
  'Knowledge': [
    { label: 'Repository', path: '/knowledge/repository' },
  ],
  'Stock': [
    { label: 'Items', path: '/stock/list' },
  ],
  'Billing': [
    { label: 'Plans', path: '/billing/plans' },
  ],
  'TenantAdmin': [
    { label: 'Users', path: '/tenant-admin/users' },
    { label: 'Operations', path: '/tenant-admin/operations' },
  ],
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const results: Record<string, Array<{ label: string; path: string; file: string | null }>> = {};

test.describe('Screenshot capture', () => {
  test('capture all module screens (desktop 1440x900)', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await authenticate(page);

    for (const [module, screens] of Object.entries(MODULES)) {
      results[module] = [];
      const dir = join(OUT, slug(module));
      mkdirSync(dir, { recursive: true });
      for (const screen of screens) {
        const rel = `${slug(module)}/${slug(screen.label)}.png`;
        try {
          await page.goto(screen.path, { waitUntil: 'networkidle', timeout: 45_000 });
          await page.waitForTimeout(800);
          await page.screenshot({ path: join(dir, `${slug(screen.label)}.png`), fullPage: true });
          results[module].push({ ...screen, file: rel });
          console.log(`  captured ${module}/${screen.label}`);
        } catch (err) {
          results[module].push({ ...screen, file: null });
          console.log(`  FAILED ${module}/${screen.label}: ${(err as Error).message}`);
        }
      }
    }

    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'results.json'), JSON.stringify({ capturedAt: new Date().toISOString(), tenant: 'District Industries Centre (DIC) — Trial', results }, null, 2));
  });
});
