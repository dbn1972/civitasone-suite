import { test, expect } from "@playwright/test";
import { injectAuthCookie } from "../helpers/auth";

test.describe("Procurement — Create Indent (Live Write)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("submits indent creation form and receives 202 Accepted", async ({ page }) => {
    await page.goto("/procurement/indents");
    await page.waitForLoadState("networkidle");

    // Navigate to the creation form (new indent)
    const createButton = page.locator(
      'a:has-text("New Indent"), button:has-text("New Indent"), a:has-text("Create"), button:has-text("Create")'
    );
    await createButton.first().click();
    await page.waitForLoadState("networkidle");

    // Fill the indent creation form fields
    const descriptionField = page.locator(
      'input[name="description"], textarea[name="description"], input[name="title"], textarea[name="title"]'
    );
    if (await descriptionField.first().isVisible()) {
      await descriptionField.first().fill("E2E Test Indent — Office Supplies");
    }

    const quantityField = page.locator(
      'input[name="quantity"], input[name="qty"]'
    );
    if (await quantityField.first().isVisible()) {
      await quantityField.first().fill("10");
    }

    const remarksField = page.locator(
      'textarea[name="remarks"], textarea[name="justification"], input[name="remarks"]'
    );
    if (await remarksField.first().isVisible()) {
      await remarksField.first().fill("Urgent requirement for Q3 operations");
    }

    // Intercept the API call to verify 202
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/procurement/indents") &&
        res.request().method() === "POST"
    );

    // Submit the form
    const submitButton = page.locator(
      'button[type="submit"], button:has-text("Submit"), button:has-text("Save")'
    );
    await submitButton.first().click();

    // Verify either the API returned 202 or a success toast appears
    const response = await responsePromise.catch(() => null);

    if (response) {
      expect(response.status()).toBe(202);
    } else {
      // Fallback: check for success toast notification
      const toast = page.locator(
        '[role="status"]:has-text("Accepted"), [role="alert"]:has-text("Accepted"), .toast:has-text("Accepted"), [data-sonner-toast]:has-text("Accepted")'
      );
      await expect(toast.first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
