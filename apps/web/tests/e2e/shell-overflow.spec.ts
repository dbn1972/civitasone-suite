import { test, expect, type Page } from "@playwright/test";
import { COOKIE_NAME, createTestJwt } from "./helpers/auth";

/**
 * UAT-P3 (DS-1): no app screen may pan sideways on a phone.
 *
 * The T-DEVICE run (04 Nov 2026) found the shared top bar 13-56 px wider than
 * a 360 / 390 px screen on 95 of 138 routes (147 of 158 phone FAILs). This
 * loads a sample of app screens for an officer and an employee at 320, 360
 * and 390 px and asserts that neither the document nor the top bar is wider
 * than the viewport. API calls are stubbed (no backend needed); pages render
 * their empty / error states, which is enough for the shell.
 *
 * Run against a production build: BASE_URL=http://localhost:<port> pnpm test:e2e shell-overflow
 */
const OFFICER_ROUTES = [
  "/dashboard", "/finance", "/finance/budget/sanctions", "/hr", "/hr/leave/approvals", "/procurement",
  "/procurement/grn", "/estab/inbox", "/meeting", "/revenue", "/billing", "/approvals",
];
const EMPLOYEE_ROUTES = ["/dashboard", "/hr/leave/apply", "/hr/payroll/my-slips", "/hr/attendance", "/hr/payroll/tax-declaration"];

const PERSONAS = {
  officer: ["super_admin", "tenant_admin", "finance_admin", "hr_admin", "revenue_admin", "billing_admin", "meeting_admin"],
  employee: ["employee"],
} as const;

async function signIn(page: Page, persona: keyof typeof PERSONAS) {
  const token = createTestJwt({
    sub: `shell-overflow-${persona}`,
    email: `${persona}@civitasone.test`,
    name: persona === "officer" ? "Rajesh Kumar Sharma" : "Anita Verma",
    roles: [...PERSONAS[persona]],
    tenantId: "t0000000-0000-0000-0000-000000000001",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const url = new URL(process.env.BASE_URL ?? "http://localhost:3000");
  await page.context().addCookies([{ name: COOKIE_NAME, value: token, domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  // First-visit tour and setup prompts are not part of the shell measurement.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("civitasone.tour.dashboard.v1", new Date().toISOString());
    } catch { /* storage blocked */ }
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }) }),
  );
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const header = document.querySelector<HTMLElement>("header.tb");
    const r = header?.getBoundingClientRect();
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      headerOverflow: header ? header.scrollWidth - header.clientWidth : 0,
      headerRight: r ? Math.round(r.right) : 0,
      viewport: doc.clientWidth,
      // The widest element outside a scroll container, to name the offender in a failure.
      offender: (() => {
        let worst = "", right = doc.clientWidth;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const rect = el.getBoundingClientRect();
          if (!rect.width || getComputedStyle(el).position === "fixed") continue;
          let p = el.parentElement, clipped = false;
          while (p && p !== document.body) {
            if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) { clipped = true; break; }
            p = p.parentElement;
          }
          if (!clipped && rect.right > right + 0.5) { right = rect.right; worst = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`; }
        }
        return worst;
      })(),
    };
  });
}

for (const width of [320, 360, 390]) {
  test.describe(`phone ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    for (const [persona, routes] of [["officer", OFFICER_ROUTES], ["employee", EMPLOYEE_ROUTES]] as const) {
      for (const route of routes) {
        test(`${persona} ${route} does not pan sideways`, async ({ page }) => {
          await signIn(page, persona);
          // Measure the settled page: streamed sections and skeletons change width while loading.
          await page.goto(route, { waitUntil: "networkidle" });
          await page.locator("header.tb").waitFor();
          const m = await measure(page);
          expect(m.headerOverflow, "top bar content wider than the bar").toBeLessThanOrEqual(1);
          expect(m.headerRight, "top bar wider than the screen").toBeLessThanOrEqual(m.viewport + 1);
          expect(m.overflow, `document wider than the screen (${m.offender})`).toBeLessThanOrEqual(4);
          // Search and the account menu stay reachable on the phone.
          await expect(page.locator("header.tb .tb-search")).toBeVisible();
          await expect(page.locator("header.tb [data-ask-trigger]")).toBeVisible();
        });
      }
    }
  });
}
