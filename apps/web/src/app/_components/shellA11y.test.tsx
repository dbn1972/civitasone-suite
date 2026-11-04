/**
 * UAT-P2-D3 / D4: shared shell accessibility fixes from the WCAG 2.1 AA /
 * GIGW 3.0 audit (~/orch-logs/a11y-audit-11021844) and the UX review quick
 * wins. One file per concern would scatter the audit IDs; they are grouped
 * here by finding.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { contrast } from "@/lib/contrast";
import { AccountMenu } from "./AccountMenu";
import { NotificationBell } from "./NotificationBell";
import { DarkModeToggle } from "./DarkModeToggle";
import { MobileNavToggle } from "./MobileNavToggle";
import { HeaderLanguageToggle, targetLocale } from "./HeaderLanguageToggle";
import { AppFooter, GIGW_FOOTER_LINKS } from "./AppFooter";
import { PageTitleSync, DEFAULT_DOCUMENT_TITLE, headingText } from "./PageTitleSync";
import { FeedbackWidget, SESSION_SHOWN_KEY } from "./FeedbackWidget";
import { formatDisplayText } from "@/lib/formatters";
import { DataTable } from "./ds/DataTable";

vi.mock("@/lib/sync/logout", () => ({ performLogout: vi.fn().mockResolvedValue(undefined) }));

function withIntl(ui: React.ReactElement, locale: "en" | "hi" = "en") {
  return rtlRender(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

async function axeViolations(container: Element) {
  const axe = (await import("axe-core")).default;
  // colour contrast needs a real layout engine; it is covered by the token test below.
  const out = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return out.violations.map((v) => v.id);
}

// ---------------------------------------------------------------- A11Y-03 / 07 / 08 tokens
describe("design tokens meet WCAG contrast (A11Y-03, A11Y-07, A11Y-08)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/civitas-ds.css"), "utf8");
  const rootBlock = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));
  const darkBlock = css.slice(css.indexOf("\n.dark{"), css.indexOf("}", css.indexOf("\n.dark{")));
  const token = (block: string, name: string): string => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
    if (!m) throw new Error(`token --${name} not found`);
    return m[1]!;
  };
  const tint = (hex: string, p: number) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return "#" + c.map((v) => Math.round(v * p + 255 * (1 - p)).toString(16).padStart(2, "0")).join("");
  };

  it("form-control boundary is >= 3:1 on white and on the page background (WCAG 1.4.11)", () => {
    const border = token(rootBlock, "control-border");
    expect(contrast(border, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(border, token(rootBlock, "bg"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(darkBlock, "control-border"), token(darkBlock, "panel"))).toBeGreaterThanOrEqual(3);
  });

  it("shared form controls use the boundary token, not the divider --line", () => {
    const style = readFileSync(join(process.cwd(), "src/app/_components/ds/_formControlStyle.ts"), "utf8");
    expect(style).toContain("var(--control-border");
    expect(css).toMatch(/\.dt-filter\{[^}]*border:1px solid var\(--control-border\)/);
    expect(css).toMatch(/\.cd-field input,\.cd-field textarea\{border:1px solid var\(--control-border\)/);
  });

  it("muted text is >= 4.5:1 on every tinted surface it sits on (the /admin/roles failure was 4.07:1)", () => {
    const mut = token(rootBlock, "mut");
    for (const bg of ["#ffffff", token(rootBlock, "bg"), token(rootBlock, "primary-soft"), token(rootBlock, "infobg")]) {
      expect(contrast(mut, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("indigo links and warn chips are >= 4.5:1 (estab approvals 4.46:1, admin org 4.42:1)", () => {
    expect(contrast(token(rootBlock, "indigo"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    const warn = token(rootBlock, "warn");
    expect(contrast(warn, tint(warn, 0.14))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(warn, token(rootBlock, "warnbg"))).toBeGreaterThanOrEqual(4.5);
  });

  it("--on-primary is defined in both themes and readable on --primary", () => {
    expect(contrast(token(rootBlock, "on-primary"), token(rootBlock, "primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(darkBlock, "on-primary"), token(darkBlock, "primary"))).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------- A11Y-05 / 17 drawer + targets
describe("off-canvas navigation (A11Y-05) and target size (A11Y-17)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/civitas-ds.css"), "utf8");

  it("the closed drawer is visibility:hidden at <=768px, so its links leave the Tab order", () => {
    expect(css).toMatch(/@media\(max-width:768px\)\{\.sb\{[^}]*visibility:hidden/);
    expect(css).toMatch(/\.app\.nav-open \.sb\{[^}]*visibility:visible/);
  });

  it("sidebar group toggles have a 28px minimum target", () => {
    expect(css).toMatch(/button\.sb-grp\{min-height:28px/);
  });

  it("Escape closes the open drawer and returns focus to the menu button", () => {
    document.body.innerHTML = "";
    const app = document.createElement("div");
    app.className = "app";
    app.innerHTML = '<aside id="app-sidebar"><a href="/dashboard">Dashboard</a></aside>';
    document.body.appendChild(app);
    rtlRender(<MobileNavToggle />, { container: app.appendChild(document.createElement("div")) });
    const btn = screen.getByRole("button", { name: "Open navigation menu" });
    fireEvent.click(btn);
    expect(app.classList.contains("nav-open")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Dashboard" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(app.classList.contains("nav-open")).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open navigation menu" }));
  });
});

// ---------------------------------------------------------------- A11Y-09 menus
describe("top-bar menus keyboard contract (A11Y-09)", () => {
  it("Account menu: focus moves in, arrows move, Escape closes and returns focus", () => {
    withIntl(<AccountMenu name="Priya" />);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(menu.contains(document.activeElement)).toBe(true);
    const first = document.activeElement;
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(first);
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Account menu: no menuitem wraps another control (no nested-interactive)", async () => {
    const { container } = withIntl(<AccountMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item.querySelector("button, a, select, input")).toBeNull();
    }
    expect(await axeViolations(container)).not.toContain("nested-interactive");
  });

  it("Notifications: Escape closes the popover and returns focus to the bell", () => {
    rtlRender(<NotificationBell notifications={[{ id: "1", title: "PO approved", time: "now", read: false }]} />);
    const bell = screen.getByTitle("Notifications");
    fireEvent.click(bell);
    const menu = screen.getByRole("menu", { name: "Notifications" });
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it("a click outside closes the Account menu", () => {
    withIntl(<AccountMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// ---------------------------------------------------------------- A11Y-11 icon buttons
describe("icon-only buttons have real names (A11Y-11)", () => {
  it("theme toggle names its state and action; the emoji is decoration", () => {
    rtlRender(<DarkModeToggle />);
    const btn = screen.getByRole("button", { name: "Theme: Light. Switch to Dark" });
    expect(btn.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("the bell renders an SVG icon, not an emoji", () => {
    rtlRender(<NotificationBell notifications={[]} />);
    const bell = screen.getByTitle("Notifications");
    expect(bell.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(bell.textContent).not.toContain("🔔");
  });
});

// ---------------------------------------------------------------- A11Y-10 / 20 language
describe("visible bilingual toggle + language of parts (A11Y-10, A11Y-20)", () => {
  it("in English the header offers हिन्दी, marked lang=hi, with a translated name", () => {
    withIntl(<HeaderLanguageToggle />);
    const btn = screen.getByRole("button", { name: "Switch language to हिन्दी" });
    expect(btn.querySelector('[lang="hi"]')).toHaveTextContent("हिन्दी");
  });

  it("in Hindi it offers English, marked lang=en, with a Hindi accessible name", () => {
    withIntl(<HeaderLanguageToggle />, "hi");
    const btn = screen.getByRole("button", { name: "भाषा बदलकर English करें" });
    expect(btn.querySelector('[lang="en"]')).toHaveTextContent("English");
    expect(targetLocale("ta")).toBe("en");
  });
});

// ---------------------------------------------------------------- A11Y-20 footer
describe("GIGW footer / contentinfo (A11Y-20, DEFERRED-content)", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_GIGW_OWNER;
    delete process.env.NEXT_PUBLIC_CONTENT_UPDATED_AT;
  });

  it("renders a contentinfo landmark with the compliance links and the demonstration defaults", async () => {
    const { container } = withIntl(<AppFooter />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    for (const l of GIGW_FOOTER_LINKS) {
      expect(screen.getByRole("link", { name: (enMessages.shell as Record<string, string>)[l.key] })).toHaveAttribute("href", l.href);
    }
    expect(container.querySelector('[data-gigw-default="NEXT_PUBLIC_GIGW_OWNER"]')).toHaveTextContent("CivitasOne Demonstration Department (UAT)");
    expect(container.querySelector('[data-gigw-unset="NEXT_PUBLIC_BUILD_TIME"]')).not.toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the owner and the last-updated date once configured", () => {
    process.env.NEXT_PUBLIC_GIGW_OWNER = "Department of Example, Ministry of Example";
    process.env.NEXT_PUBLIC_CONTENT_UPDATED_AT = "2026-11-03";
    withIntl(<AppFooter />, "hi");
    expect(screen.getByText(/Department of Example/)).toBeInTheDocument();
    expect(screen.getByText(/अंतिम अद्यतन: 3 नवंबर 2026/)).toBeInTheDocument();
  });

  it("every new shell / gigw string has a Hindi translation", () => {
    for (const ns of ["shell", "gigw"] as const) {
      const en = enMessages[ns] as Record<string, string>;
      const hi = hiMessages[ns] as Record<string, string>;
      expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
      for (const k of Object.keys(en)) expect(hi[k]).not.toBe(en[k]);
    }
  });
});

// ---------------------------------------------------------------- A11Y-02 titles
describe("unique page titles (A11Y-02)", () => {
  beforeEach(() => {
    document.title = DEFAULT_DOCUMENT_TITLE;
  });

  it("titles the document from the page heading, without help/icon glyphs", () => {
    rtlRender(
      <main id="main">
        <h1 id="page-heading">
          Digital File Tracking (eOffice<button type="button">?</button>)
        </h1>
        <PageTitleSync />
      </main>,
    );
    expect(document.title).toBe("Digital File Tracking (eOffice) | CivitasOne");
  });

  it("keeps a route's own metadata title", () => {
    document.title = "Help Centre | CivitasOne Docs";
    rtlRender(
      <main id="main">
        <h1 id="page-heading">Help</h1>
        <PageTitleSync />
      </main>,
    );
    expect(document.title).toBe("Help Centre | CivitasOne Docs");
  });

  it("follows a heading that streams in after first paint", async () => {
    vi.useFakeTimers();
    const { rerender } = rtlRender(
      <main id="main">
        <PageTitleSync />
      </main>,
    );
    rerender(
      <main id="main">
        <h1 id="page-heading">Purchase Orders</h1>
        <PageTitleSync />
      </main>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(document.title).toBe("Purchase Orders | CivitasOne");
    vi.useRealTimers();
  });

  it("headingText ignores aria-hidden icons", () => {
    const h = document.createElement("h1");
    h.innerHTML = '<span aria-hidden="true">📄</span> Vouchers';
    expect(headingText(h)).toBe("Vouchers");
  });
});

// ---------------------------------------------------------------- D4 feedback widget
describe("'Was this helpful?' no longer covers controls (GLB-01, A11Y-06)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("renders inline (not position:fixed) and only once per browser session", () => {
    const first = rtlRender(<FeedbackWidget />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const widget = screen.getByTestId("feedback-widget");
    expect(widget.style.position).not.toBe("fixed");
    expect(sessionStorage.getItem(SESSION_SHOWN_KEY)).toBeTruthy();
    first.unmount();
    rtlRender(<FeedbackWidget />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByTestId("feedback-widget")).toBeNull();
  });
});

// ---------------------------------------------------------------- D4 shared display formatter
describe("shared display formatter: raw ISO dates and enum codes (GLB-08, GLB-10)", () => {
  it("formats ISO dates and timestamps the Indian way", () => {
    expect(formatDisplayText("2026-11-03")).toBe("03 Nov 2026");
    expect(formatDisplayText("2026-11-03T04:15:00.000Z")).toMatch(/^03 Nov 2026/);
  });

  it("humanizes lower-case codes only in enum-like columns", () => {
    expect(formatDisplayText("proc_head", "currentStep")).toBe("Proc Head");
    expect(formatDisplayText("approved", "status")).toBe("Approved");
    expect(formatDisplayText("procurement_admin", "role")).toBe("procurement_admin");
    // names / references / non-enum columns are untouched
    expect(formatDisplayText("john_doe", "username")).toBe("john_doe");
    expect(formatDisplayText("PO/2026/0025", "status")).toBe("PO/2026/0025");
    expect(formatDisplayText("2026-27", "period")).toBe("2026-27");
    expect(formatDisplayText("not-a-date-2026-11-03")).toBe("not-a-date-2026-11-03");
  });

  it("DataTable applies it to plain cells", () => {
    rtlRender(
      <DataTable
        columns={[
          { key: "ref", label: "Reference" },
          { key: "stage", label: "Stage" },
          { key: "createdOn", label: "Created" },
        ]}
        rows={[{ id: "1", ref: "IND/2026/0001", stage: "pending_approval", createdOn: "2026-11-03" }]}
      />,
    );
    expect(screen.getByText("IND/2026/0001")).toBeInTheDocument();
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    expect(screen.getByText("03 Nov 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-11-03")).toBeNull();
  });
});

// ---------------------------------------------------------------- A11Y-08 theme on load
describe("saved theme is applied on every page load (A11Y-08)", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("ThemeInit applies a stored dark theme without the account menu being opened", async () => {
    const { ThemeInit } = await import("./ThemeInit");
    localStorage.setItem("civitas-theme", "dark");
    rtlRender(<ThemeInit />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("no stored value keeps the light default", async () => {
    const { ThemeInit } = await import("./ThemeInit");
    rtlRender(<ThemeInit />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
