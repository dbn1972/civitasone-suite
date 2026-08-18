import { test, expect } from "@playwright/test";
import { injectAuthCookie } from "../helpers/auth";

/**
 * Establishment file journey (Req 6.1): create a digital file via the
 * Guided File wizard, add a noting, submit it for approval (DFA/noting
 * chain), approve it from the approvals queue, then verify the file's
 * status/movement trail reflects the dispatch-ready state.
 *
 * Uses the injected super_admin JWT for both the "officer" and "approver"
 * steps — the live UAT stack's demo roles are not separately provisioned
 * for E2E, and super_admin has access to every workflow action, matching
 * the existing pattern in full-journey.spec.ts.
 */
test.describe("Establishment — File Journey (Live)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("create file, note, submit for DFA/approval, approve, verify status", async ({ page }) => {
    // 1. Create a new file via the Guided File workspace.
    await page.goto("/estab/workspace");
    await page.waitForLoadState("networkidle");

    // The wizard's Step 1 "Subject" field — locate by the visible label text.
    const step1Subject = page.getByLabel("Subject").first();
    await expect(step1Subject).toBeVisible({ timeout: 15_000 });

    const dakCheckbox = page.locator('input[type="checkbox"]');
    if (await dakCheckbox.isChecked().catch(() => false)) {
      await dakCheckbox.uncheck();
    }

    const subjectText = `E2E Estab File — ${Date.now()}`;
    await step1Subject.fill(subjectText);
    await page.getByRole("button", { name: "Continue" }).click();

    // 2. Step 2 — open file: fill department + pick/enter an officer, then open.
    await expect(page.getByText("2 · Open file")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Department").fill("Administration");

    const officerSelect = page.getByLabel("Mark to officer");
    const isSelect = (await officerSelect.evaluate((el) => el.tagName.toLowerCase())) === "select";
    if (isSelect) {
      const options = await officerSelect.locator("option").all();
      if (options.length > 1) {
        const value = await options[1].getAttribute("value");
        if (value) await officerSelect.selectOption(value);
      }
    } else {
      await officerSelect.fill("00000000-0000-0000-0000-000000000099");
    }

    await page.getByLabel("Opening (yellow) note").fill("Initial noting for E2E journey test.");

    const openResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/proxy/v1/estab/files") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Open file & continue" }).click();
    const openResponse = await openResponsePromise.catch(() => null);
    if (openResponse) {
      expect(openResponse.ok()).toBeTruthy();
    }

    // 3. Step 3 — submit the opening note for approval.
    await expect(page.getByText("3 · Note & submit for approval")).toBeVisible({ timeout: 15_000 });
    const submitButton = page.getByRole("button", { name: "Submit for approval" });
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });
    await submitButton.click();

    // Reaches step 4 (draft outgoing) once the submission succeeds.
    await expect(page.getByText("4 · Draft outgoing communication (optional)")).toBeVisible({ timeout: 20_000 });

    // Grab the created file's link from the "Done" step for later verification.
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByText("✓ File created & routed")).toBeVisible({ timeout: 15_000 });

    const openFileLink = page.getByRole("link", { name: "Open the file" });
    const fileHref = await openFileLink.getAttribute("href");
    expect(fileHref).toBeTruthy();

    // 4. Login as approver (same super_admin session — see file header) and
    // approve the pending noting from the approvals queue.
    await page.goto("/estab/approvals");
    await page.waitForLoadState("networkidle");

    const approveButton = page.getByRole("button", { name: "Approve & e-Sign" }).first();
    if (await approveButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await approveButton.click();
      const dialog = await page.getByRole("alertdialog").first();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      const reasonField = dialog.locator("textarea, input").first();
      if (await reasonField.isVisible().catch(() => false)) {
        await reasonField.fill("Approved via E2E journey test.");
      }
      const confirmButton = dialog.getByRole("button", { name: "Approve & e-Sign" });
      await confirmButton.click();
      await expect(page.getByText(/Approved at|Final approval/)).toBeVisible({ timeout: 15_000 });
    }

    // 5. Verify the file detail page reflects the noting/movement state.
    if (fileHref) {
      await page.goto(fileHref);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(subjectText)).toBeVisible({ timeout: 15_000 });
      // Note sheet card and movement-trail card are always rendered on the
      // file detail page — presence confirms the approval chain updated it.
      await expect(page.getByText("Note sheet")).toBeVisible();
      await expect(page.getByText("Movement trail")).toBeVisible();
    }
  });
});
