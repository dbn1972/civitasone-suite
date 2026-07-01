import { test, expect } from '@playwright/test';
import { goAsAdmin } from './helpers/auth';

test.describe('Branding / Theme Editor', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the themes/branding API
    await page.route('**/api/v1/themes/tokens', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { key: '--color-primary', value: '#0052cc' },
          { key: '--color-secondary', value: '#003087' },
          { key: '--font-family', value: 'Inter, sans-serif' },
        ]),
      }),
    );

    await page.route('**/api/v1/themes/presets', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'preset-1', name: 'Government Blue', primary: '#0052cc', secondary: '#003087' },
          { id: 'preset-2', name: 'Forest Green', primary: '#006644', secondary: '#004d33' },
          { id: 'preset-3', name: 'Sunset Orange', primary: '#cc5200', secondary: '#993d00' },
        ]),
      }),
    );

    await goAsAdmin(page, '/themes');
  });

  test('navigate to themes/branding settings', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /themes|branding/i })).toBeVisible();
  });

  test('theme tokens render with color values', async ({ page }) => {
    await expect(page.getByText('--color-primary')).toBeVisible();
    await expect(page.getByText('#0052cc')).toBeVisible();
  });

  test('secondary color token is displayed', async ({ page }) => {
    await expect(page.getByText('--color-secondary')).toBeVisible();
    await expect(page.getByText('#003087')).toBeVisible();
  });

  test('font family token is displayed', async ({ page }) => {
    await expect(page.getByText('--font-family')).toBeVisible();
    await expect(page.getByText('Inter, sans-serif')).toBeVisible();
  });

  test('branding description text is shown', async ({ page }) => {
    await expect(page.getByText(/branding|token|theme/i).first()).toBeVisible();
  });

  test('save button or edit action exists', async ({ page }) => {
    // The page should have some way to edit/save theme values
    const saveBtn = page.getByRole('button', { name: /save|apply|update/i });
    const editBtn = page.getByRole('button', { name: /edit|customize/i });
    await expect(saveBtn.or(editBtn).first()).toBeVisible();
  });
});
