import { test, expect } from "@playwright/test";
import { injectAuthCookie } from "../helpers/auth";

/**
 * Establishment quarters journey (Req 6.1): create a fresh vacant quarter,
 * apply for its allotment, allot it, mark it occupied, then vacate it —
 * verifying the allotment status transitions at each step via the
 * detail page.
 *
 * Uses the injected super_admin JWT for every step (officer, allotting
 * authority, applicant) — the live UAT stack's demo roles are not
 * separately provisioned for E2E, matching the pattern in
 * estab-file-journey.spec.ts. Writes go through the async CQRS command
 * path (queue.publish -> 202 Accepted -> consumer applies the state
 * change), so each transition polls the allotment detail page for the
 * expected StatusPill text rather than asserting an immediate DB state.
 */
test.describe("Establishment — Quarters Journey (Live)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("apply for allotment, allot, occupy, vacate", async ({ page }) => {
    const quarterNo = `E2E-Q-${Date.now()}`;

    // 1. Add a fresh vacant quarter via the "Add Quarter" form.
    await page.goto("/estab/quarters");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Quarter No.").fill(quarterNo);
    await page.getByLabel("Category").fill("general");

    const createResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/v1/estab/quarters") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Add Quarter" }).click();
    const createDialog = page.getByRole("alertdialog");
    await expect(createDialog).toBeVisible({ timeout: 10_000 });
    await createDialog.getByRole("button", { name: "Add quarter" }).click();
    const createResponse = await createResponsePromise.catch(() => null);
    if (createResponse) {
      expect(createResponse.ok()).toBeTruthy();
    }

    // 2. Locate the new quarter in the list and open its detail page.
    await page.waitForLoadState("networkidle");
    const filterBox = page.getByPlaceholder("Filter by quarter no., type, category or locality…");
    await filterBox.fill(quarterNo);
    const quarterLink = page.getByRole("link", { name: new RegExp(quarterNo) }).first();
    await expect(quarterLink).toBeVisible({ timeout: 15_000 });
    await quarterLink.click();
    await page.waitForLoadState("networkidle");

    // 3. Apply for allotment (form only renders while status === "vacant").
    const employeeIdInput = page.getByLabel("Employee ID");
    await expect(employeeIdInput).toBeVisible({ timeout: 15_000 });
    await employeeIdInput.fill("00000000-0000-0000-0000-000000000099");

    const applyResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/v1/estab/quarter-allotments") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Apply for allotment" }).click();
    const applyDialog = page.getByRole("alertdialog");
    await expect(applyDialog).toBeVisible({ timeout: 10_000 });
    await applyDialog.getByRole("button", { name: "Submit application" }).click();
    const applyResponse = await applyResponsePromise.catch(() => null);
    if (applyResponse) {
      expect(applyResponse.ok()).toBeTruthy();
    }
    await expect(page.getByText("Allotment application submitted.")).toBeVisible({ timeout: 15_000 });

    // 4. Open the allotment from the "Allotment history for this quarter" table.
    await page.waitForLoadState("networkidle");
    const allotmentRow = page.locator("table tbody tr").first();
    await expect(allotmentRow).toBeVisible({ timeout: 15_000 });
    await allotmentRow.click();
    await page.waitForLoadState("networkidle");

    // 5. Allot the quarter (status: applied -> allotted).
    const allotButton = page.getByRole("button", { name: "Allot quarter" });
    await expect(allotButton).toBeVisible({ timeout: 15_000 });
    await allotButton.click();
    const allotDialog = page.getByRole("alertdialog");
    await expect(allotDialog).toBeVisible({ timeout: 10_000 });
    await allotDialog.getByRole("button", { name: "Allot quarter" }).click();
    await expect(page.getByText("Allotment accepted for processing.")).toBeVisible({ timeout: 15_000 });

    // The write is async (queue -> consumer); poll for the status transition.
    await expect(async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("allotted", { exact: false })).toBeVisible();
    }).toPass({ timeout: 30_000, intervals: [2_000, 3_000, 5_000] });

    // 6. Mark occupied (status: allotted -> occupied).
    const occupyButton = page.getByRole("button", { name: "Mark occupied" });
    await expect(occupyButton).toBeVisible({ timeout: 15_000 });
    await occupyButton.click();
    const occupyDialog = page.getByRole("alertdialog");
    await expect(occupyDialog).toBeVisible({ timeout: 10_000 });
    await occupyDialog.getByRole("button", { name: "Mark occupied" }).click();
    await expect(page.getByText("Occupation accepted for processing.")).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("occupied", { exact: false })).toBeVisible();
    }).toPass({ timeout: 30_000, intervals: [2_000, 3_000, 5_000] });

    // 7. Vacate immediately (status: occupied -> vacated).
    const vacateNowButton = page.getByRole("button", { name: "Vacate now (skip notice)" });
    await expect(vacateNowButton).toBeVisible({ timeout: 15_000 });
    await vacateNowButton.click();
    const vacateDialog = page.getByRole("alertdialog");
    await expect(vacateDialog).toBeVisible({ timeout: 10_000 });
    await vacateDialog.getByRole("button", { name: "Record vacation" }).click();
    await expect(page.getByText("Vacation recorded — accepted for processing.")).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("vacated", { exact: false })).toBeVisible();
    }).toPass({ timeout: 30_000, intervals: [2_000, 3_000, 5_000] });

    // Final state is terminal — the lifecycle card confirms no further transitions.
    await expect(page.getByText(/no further transitions/i)).toBeVisible();
  });
});
