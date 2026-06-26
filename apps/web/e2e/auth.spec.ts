import { test, expect } from '@playwright/test';
import { authenticate, COOKIE_NAME } from './helpers/auth';

test.describe('Authentication', () => {
  test('login page renders the PKCE sign-in button', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByRole('link', { name: /sign in with keycloak/i })).toBeVisible();
  });

  test('login page shows CivitasOne branding', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByText('CivitasOne Suite')).toBeVisible();
  });

  test('error query param shows the error alert', async ({ page }) => {
    await page.goto('/auth/login?error=invalid_credentials');
    const errorAlert = page.getByRole('alert').filter({ hasText: /Sign-in failed/ });
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('Sign-in failed');
  });

  test('unauthenticated visit to /dashboard redirects to /auth/login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('authenticated visit to /dashboard stays on dashboard', async ({ page }) => {
    await authenticate(page);
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/auth\/login/);
    // Dashboard renders PageHeader title="Command Center"
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
  });

  test('logout clears cookie and redirects to login', async ({ page }) => {
    await authenticate(page);
    await page.goto('/logout');
    await expect(page).toHaveURL(/\/auth\/login/);
    const cookies = await page.context().cookies();
    const atCookie = cookies.find((c) => c.name === COOKIE_NAME);
    expect(atCookie).toBeUndefined();
  });
});
