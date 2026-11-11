import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

/**
 * UAT-P3 (DS-1 / DS-2 / DS-3): jsdom-safe layout guard for the shared top bar.
 *
 * jsdom has no layout engine, so this cannot measure widths. It instead pins
 * the CSS rules that make the bar fit, and adds up the fixed-width parts of
 * the bar (from the CSS values themselves) at 320 / 360 / 390 px to prove the
 * breadcrumb is always left room. The real measurement (document
 * scrollWidth <= clientWidth on app screens at the same widths) is the
 * Playwright test tests/e2e/shell-overflow.spec.ts.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/finance/budget/sanctions", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../NotificationBell", () => ({ NotificationBell: () => <button type="button" className="iconbtn">bell</button> }));
vi.mock("../ConnectionStatus", () => ({ ConnectionStatus: () => null }));

import { TopBar } from "./TopBar";

const css = readFileSync(join(process.cwd(), "src/app/civitas-ds.css"), "utf8");
const noPrint = css.replace(/@media print\{[\s\S]*?\n\}/g, "");

/** The body of the first `@media(max-width:Npx){...}` block that contains `marker`. */
function mediaBlock(width: number, marker: string): string {
  const re = new RegExp(`@media\\(max-width:${width}px\\)\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    const body = css.slice(m.index + m[0].length, i - 1);
    if (body.includes(marker)) return body;
  }
  throw new Error(`no @media(max-width:${width}px) block with ${marker}`);
}
const px = (block: string, re: RegExp): number => {
  const m = re.exec(block);
  if (!m) throw new Error(`not found: ${re}`);
  return Number(m[1]);
};

describe("top bar fits a phone (UAT-P3 DS-1)", () => {
  const phone = mediaBlock(768, ".tb-search .tb-search-label");
  const small = mediaBlock(480, ".tb-lang-slot");

  it("the breadcrumb can shrink and shows only the current page on phones", () => {
    expect(css).toMatch(/\.tb \.crumb\{[^}]*min-width:0[^}]*text-overflow:ellipsis/);
    expect(phone).toMatch(/\.tb \.crumb \.auto-crumb li:not\(:last-child\)\{display:none\}/);
  });

  it("search stays reachable as an icon button (it used to be display:none on phones)", () => {
    expect(css).not.toMatch(/@media\(max-width:768px\)\{[^@]*\.tb-search\{display:none\}/);
    expect(phone).toMatch(/\.tb-search\{flex:0 0 44px;width:44px/);
    expect(phone).toMatch(/\.tb-search \.tb-search-label,\.tb-search kbd\{display:none\}/);
  });

  it("the language toggle stays visible below 480 px as a 44 px compact button (GIGW 3.0), and Ask moves into the Account menu", () => {
    expect(small).not.toMatch(/\.tb-lang-slot\{display:none\}/);
    expect(small).toMatch(/\.tb-lang-slot \.tb-lang\{min-width:44px;min-height:44px/);
    expect(small).toMatch(/\.tb-lang \.tb-lang-long\{display:none\}/);
    expect(small).toMatch(/\.tb-lang \.tb-lang-short\{display:inline/);
    expect(small).toMatch(/\.iconbtn\.tb-ask\{display:none\}/);
    expect(small).toMatch(/\.am-ask\{display:block\}/);
    // outside the phone block the long label shows and the Account-menu Ask row is hidden
    expect(css).toMatch(/\n\.tb-lang \.tb-lang-short\{display:none\}/);
    expect(css).toMatch(/\n\.am-ask\{display:none\}/);
  });

  it.each([320, 360, 390])("leaves at least 48 px for the page title at %ipx", (vw) => {
    const block = vw <= 480 ? small : phone;
    const pad = px(block, /\.tb\{padding:0 (\d+)px/);
    const gap = px(block, /\.tb\{padding:0 \d+px;gap:(\d+)px/);
    const actionsGap = px(phone, /\.tb-actions\{gap:(\d+)px/);
    const control = px(phone, /\.tb-search\{flex:0 0 (\d+)px/); // menu, search, Ask, bell are all this size
    const avatar = px(css, /\.av\.sm\{width:(\d+)px/);
    // <= 480: the 44 px language toggle takes the place Ask had (Ask is in the Account menu).
    const languageToggle = vw <= 480 ? 0 : 44 + actionsGap;
    // [menu] gap [crumb] gap [search] gap [actions: Ask, bell, avatar (+ language)]
    const fixed = 2 * pad + 3 * gap + 2 * control + (2 * control + avatar + 2 * actionsGap) + languageToggle;
    expect(vw - fixed).toBeGreaterThanOrEqual(48);
  });

  it("renders Ask in the header (not floating) and wraps the language toggle for the phone rule", () => {
    const { container } = render(<TopBar languageToggle={<button type="button">हिन्दी</button>} />);
    const actions = container.querySelector(".tb-actions")!;
    expect(actions.querySelector("[data-ask-trigger]")).not.toBeNull();
    expect(actions.querySelector(".tb-lang-slot button")).toHaveTextContent("हिन्दी");
    expect(screen.getByRole("button", { name: "Ask CivitasOne" })).toHaveClass("tb-ask");
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
      expect(el.style.position).not.toBe("fixed");
    }
  });
});

describe("12 px text floor (UAT-P3 DS-2)", () => {
  it("defines the floor and the scale as tokens", () => {
    expect(css).toMatch(/--fs-min:12px;/);
    expect(css).toMatch(/--fs-xs:12px; --fs-sm:13px; --fs-md:14px; --fs-lg:16px; --fs-xl:20px; --fs-2xl:25px;/);
    expect(css).toMatch(/--r-xs:6px; --r-pill:999px;/);
  });

  it("no screen rule in the design CSS sets text below 12 px", () => {
    const sizes = [...noPrint.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.filter((s) => s < 12)).toEqual([]);
  });

  it("sort glyphs, pills, micro-labels and avatar initials use the scale", () => {
    expect(css).toMatch(/\.tbl th\.sortable \.sort-ind\{[^}]*font-size:var\(--fs-xs\)/);
    expect(css).toMatch(/\.pill\{[^}]*font-size:var\(--fs-xs\)/);
    expect(css).toMatch(/\.fld \.l\{[^}]*font-size:var\(--fs-xs\)/);
    expect(css).toMatch(/\.av\.sm\{[^}]*font-size:var\(--fs-xs\)/);
    expect(css).toMatch(/\.sb-grp\{[^}]*font-size:var\(--fs-xs\)/);
  });

  it("the shell components carry no inline text below 12 px", () => {
    const files = ["ds/Sidebar.tsx", "ds/TopBar.tsx", "GlobalSearch.tsx", "AutoBreadcrumb.tsx", "AccountMenu.tsx", "NotificationBell.tsx", "AskCivitasOne.tsx"];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), "src/app/_components", f), "utf8");
      const inline = [...src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1]));
      expect(inline.filter((s) => s < 12), f).toEqual([]);
      expect(src, f).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/);
    }
  });
});

describe("one breadcrumb (UAT-P3 NAV-05)", () => {
  it("an in-page trail that repeats the top-bar breadcrumb is not shown", () => {
    expect(css).toMatch(/#main nav\[data-dup-crumb\]\{display:none\}/);
    // the old language-dependent selector is gone (it hid trails only when aria-label was the English word)
    expect(css).not.toMatch(/nav\[aria-label="Breadcrumb"\]:has/);
  });

  it("every in-page trail that repeats the top-bar one is opted out in source, whatever its aria-label language", () => {
    const root = join(process.cwd(), "src/app");
    const marked = [
      "(app)/audit/_components/AuditBreadcrumb.tsx",
      "(app)/platform-admin/Breadcrumb.tsx",
      "(app)/legal/cases/[id]/page.tsx",
      "(app)/legal/opinions/[id]/page.tsx",
      "(app)/inspection/reports/[id]/page.tsx",
      "(app)/inspection/inspections/[id]/page.tsx",
      "(app)/finance/payments/[id]/page.tsx",
      "(app)/contracts/[id]/page.tsx",
      "(app)/hr/disciplinary/[id]/page.tsx",
      "(app)/hr/locations/[id]/page.tsx",
    ];
    for (const f of marked) expect(readFileSync(join(root, f), "utf8"), f).toContain("data-dup-crumb");
  });
});
