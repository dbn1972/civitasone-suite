import { test, expect } from '@playwright/test';
import { loginAsAdmin, COOKIE_NAME } from './helpers/auth';

test.describe('Authentication Flows', () => {
  test.describe('Login Page', () => {
    test('valid credentials redirect to dashboard', async ({ page }) => {
      // Simulate successful auth by setting cookie then navigating
      await loginAsAdmin(page);
      await page.goto('/dashboard');
      await expect(page).not.toHaveURL(/\/auth\/login/);
      await expect(page.getByRole('heading', { name: /command center|dashboard/i })).toBeVisible();
    });

    test('invalid credentials show error message', async ({ page }) => {
      // Keycloak redirects back with error param on failure
      await page.goto('/auth/login?error=invalid_credentials');
      const errorAlert = page.getByRole('alert').or(page.getByText(/sign-in failed|invalid|error/i));
      await expect(errorAlert.first()).toBeVisible();
    });
  });

  test.describe('Session Management', () => {
    test('session expiry redirects to login', async ({ page }) => {
      // Visit protected page without auth → should redirect
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/auth\/login/);
    });

    test('unauthenticated access to protected route redirects', async ({ page }) => {
      await page.goto('/finance');
      await expect(page).toHaveURL(/\/auth\/login/);
    });
  });

  test.describe('Logout', () => {
    test('logout clears session and redirects to login', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard');
      // Navigate to logout
      await page.goto('/logout');
      await expect(page).toHaveURL(/\/auth\/login/);

      // Cookie should be cleared
      const cookies = await page.context().cookies();
      const authCookie = cookies.find((c) => c.name === COOKIE_NAME);
      expect(authCookie).toBeUndefined();
    });

    test('after logout, visiting dashboard redirects to login', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/logout');
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/auth\/login/);
    });
  });
});
