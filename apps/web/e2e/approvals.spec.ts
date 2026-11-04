import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authenticate } from "./helpers/auth";

/**
 * UX R1: the unified approvals inbox (/approvals) against the mock gateway (e2e/global-setup.ts):
 * 17 pending tasks with business summaries. Client-side reads (decision context) and the decision
 * itself are stubbed per test with page.route, so approving a task runs end to end in the browser
 * without the live backend.
 */
const PO_TASK = "b2000000-0000-4000-8000-000000000002";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function context(taskId: string, over: Record<string, unknown> = {}) {
  return {
    data: {
      task: { id: taskId, name: "Review", status: "pending", decision: null, refType: "procurement_po", refId: "b3000000-0000-4000-8000-000000000002", instanceId: "b4000000-0000-4000-8000-000000000002", dueAt: null, createdAt: new Date().toISOString(), assigned: false },
      instance: { id: "b4000000-0000-4000-8000-000000000002", name: "Purchase order PO-2026-0042", status: "active", createdAt: "2026-10-30T05:00:00.000Z" },
      maker: { name: "Anita Verma", designation: "Section Officer" },
      isMaker: false,
      summary: null,
      trail: [
        { action: "create", decision: null, step: null, actor: { name: "Anita Verma", designation: "Section Officer" }, remarks: null, at: "2026-10-30T05:00:00.000Z" },
        { action: "complete", decision: "approve", step: "Section Officer Check", actor: { name: "Suresh Rao", designation: "Under Secretary" }, remarks: "Rates verified against GeM.", at: "2026-10-31T06:30:00.000Z" },
      ],
      permissions: { canAct: true, blockedReason: null, sodBlock: null, canForward: false },
      ...over,
    },
  };
}

async function stubContext(page: Page, over: Record<string, unknown> = {}) {
  await page.route("**/api/proxy/v1/workflow/inbox/tasks/*/context", (route) => {
    const id = route.request().url().split("/tasks/")[1]!.split("/")[0]!;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(context(id, over)) });
  });
}

test.describe("Approvals inbox (UX R1)", () => {
  test("one inbox with tabs and counts; rows carry business context, never ids", async ({ page }) => {
    await authenticate(page);
    await page.goto("/approvals");
    await expect(page.locator("#page-heading:visible")).toContainText("Approvals");
    const tabs = page.getByRole("navigation", { name: "Approval lists" });
    await expect(tabs.getByRole("link", { name: /Waiting for me\s*17/ })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: /Sent by me\s*0/ })).toBeVisible();
    await expect(tabs.getByRole("link", { name: /Done by me\s*0/ })).toBeVisible();

    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Item" })).toBeVisible();
    const po = page.getByRole("row", { name: /Approve purchase order PO\/2026\/0042/ });
    await expect(po).toContainText("₹1,23,456.00");
    await expect(po).toContainText("Anita Verma, Section Officer");
    await expect(po).toContainText("Level 2 of 3: Deputy Secretary Approval");
    await expect(po).toContainText(/Due \d{2} [A-Z][a-z]{2} \d{4}/);
    // The overdue leave is listed first, with its SLA in words (not colour only).
    const first = table.locator("tbody tr").first();
    await expect(first).toContainText("Approve leave: Earned Leave, 3 days");
    await expect(first).toContainText(/Overdue by [\d,]+ days/);
    await expect(page.locator("main")).not.toContainText("Review");
    expect(await page.locator("main").innerText()).not.toMatch(UUID);
  });

  test("approving one task: panel, remarks, confirm, toast, the item leaves and focus moves to the next", async ({ page }) => {
    await authenticate(page);
    await stubContext(page);
    let completed: unknown = null;
    await page.route(`**/api/proxy/v1/workflow/tasks/${PO_TASK}/complete`, async (route) => {
      completed = route.request().postDataJSON();
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: PO_TASK, status: "accepted", correlationId: "c-1" }) });
    });
    await page.goto("/approvals");
    await page.getByRole("button", { name: "Open: Approve purchase order PO/2026/0042" }).click();
    const panel = page.getByRole("region", { name: "Approve purchase order PO/2026/0042" });
    await expect(panel).toContainText("Suresh Rao, Under Secretary");
    await expect(panel).toContainText("Rates verified against GeM.");
    await panel.getByLabel("Remarks").fill("Within delegated financial powers.");
    await panel.getByRole("button", { name: "Approve", exact: true }).click();
    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Approved: Approve purchase order PO/2026/0042.").first()).toBeVisible();
    expect(completed).toEqual({ decision: "approve", reason: "Within delegated financial powers." });
    await expect(page.getByRole("button", { name: "Open: Approve purchase order PO/2026/0042" })).toHaveCount(0);
    // Focus is on the next row and the panel opened it.
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", /^Open: /);
    await expect(page.getByRole("navigation", { name: "Approval lists" }).getByRole("link", { name: /Waiting for me\s*16/ })).toBeVisible();
  });

  test("the maker cannot approve: Approve is disabled and says why", async ({ page }) => {
    await authenticate(page);
    await stubContext(page, { isMaker: true, permissions: { canAct: true, blockedReason: null, sodBlock: "maker", canForward: false } });
    await page.goto("/approvals");
    await page.getByRole("button", { name: "Open: Approve purchase order PO/2026/0042" }).click();
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeDisabled();
    await expect(page.getByText("You raised this item, so you cannot approve it (maker-checker).", { exact: false })).toBeVisible();
  });

  test("keyboard: J and K move between rows, Enter opens", async ({ page }) => {
    await authenticate(page);
    await stubContext(page);
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");
    const buttons = page.locator("tbody button");
    // Retried until the page has hydrated (the keys are handled by React, not the server HTML).
    await expect(async () => {
      await buttons.first().focus();
      await page.keyboard.press("j");
      await expect(buttons.nth(1)).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.keyboard.press("k");
    await expect(buttons.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^Approve/ })).toBeVisible();
  });

  test("the old queues redirect with 308 and keep working as filters", async ({ page }) => {
    await authenticate(page);
    const cases: Array<[string, string]> = [
      ["/workflow/my-tasks", "/approvals"],
      ["/procurement/approvals", "/approvals?module=procurement"],
      ["/hr/leave/approvals", "/approvals?module=leave"],
      ["/estab/approvals", "/approvals?module=estab"],
    ];
    for (const [from, to] of cases) {
      const res = await page.request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(308);
      expect(res.headers()["location"], from).toBe(to);
    }
    await page.goto("/procurement/approvals");
    await expect(page).toHaveURL(/\/approvals\?module=procurement$/);
    await expect(page.getByRole("button", { name: /Open: Approve purchase order PO\/2026\/0042/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open: Approve leave/ })).toHaveCount(0);
  });

  test("an empty inbox says so; a failed load offers a retry, not zeros", async ({ page }) => {
    await authenticate(page, "empty");
    await page.goto("/approvals");
    await expect(page.getByText("Nothing is waiting for you")).toBeVisible();
    await page.context().clearCookies();
    await authenticate(page, "down");
    await page.goto("/approvals");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    for (const locale of ["en", "hi"] as const) {
      for (const width of [1280, 320]) {
        test(`axe: no WCAG A/AA violations (${theme}, ${locale}, ${width}px, panel open)`, async ({ page }) => {
          await page.setViewportSize({ width, height: 2800 });
          await authenticate(page);
          await page.context().addCookies([{ name: "locale", value: locale, domain: "localhost", path: "/" }]);
          await stubContext(page);
          await page.goto("/approvals");
          if (theme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
          await page.locator("tbody button").nth(1).click();
          await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
          const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
          expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
          // 320 px reflow (WCAG 1.4.10): nothing in the inbox content is wider than the viewport.
          // Scoped to #main: the shell top bar overflows at 320 px on the base build too (36 px on
          // /approvals, 116 px on /dashboard), which is the shell redesign (R6), not this page.
          const wide = await page.evaluate(() => {
            const w = document.documentElement.clientWidth;
            return [...document.querySelectorAll("#main *")].filter((el) => el.getBoundingClientRect().right > w + 1)
              .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className)}`);
          });
          if (width === 320) expect(wide).toEqual([]);
        });
      }
    }
  }
});
