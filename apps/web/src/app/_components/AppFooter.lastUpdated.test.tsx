/**
 * A-N2 (UAT post-b14, GIGW 3.0 last-updated / owner identity).
 *
 * "Last updated" is real: it comes from the build time that next.config.mjs
 * bakes in as NEXT_PUBLIC_BUILD_TIME (an owner-set NEXT_PUBLIC_CONTENT_UPDATED_AT
 * still wins). The owning department is NOT invented: it is department config
 * (NEXT_PUBLIC_GIGW_OWNER) with a labelled demonstration default until set.
 * The public site footer (GIGW pages) now carries the same identity line.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { AppFooter, GIGW_FOOTER_LINKS } from "./AppFooter";
import { contentLastUpdated } from "@/lib/gigw/siteIdentity";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

import MarketingLayout from "@/app/(marketing)/layout";

function withIntl(ui: React.ReactElement, locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ENV = ["NEXT_PUBLIC_GIGW_OWNER", "NEXT_PUBLIC_CONTENT_UPDATED_AT", "NEXT_PUBLIC_BUILD_TIME"] as const;

describe("contentLastUpdated", () => {
  it("prefers the owner-set content date, then the build time", () => {
    expect(contentLastUpdated("2026-10-01", "2026-11-04T05:00:00.000Z")).toBe("2026-10-01");
    expect(contentLastUpdated(undefined, "2026-11-04T05:00:00.000Z")).toBe("2026-11-04T05:00:00.000Z");
    expect(contentLastUpdated("  ", " 2026-11-04T05:00:00.000Z ")).toBe("2026-11-04T05:00:00.000Z");
  });

  it("ignores values that are not dates", () => {
    expect(contentLastUpdated("soon", "2026-11-04T05:00:00.000Z")).toBe("2026-11-04T05:00:00.000Z");
    expect(contentLastUpdated(undefined, "not-a-date")).toBeNull();
    expect(contentLastUpdated(undefined, undefined)).toBeNull();
  });
});

describe("app footer last updated (A-N2)", () => {
  afterEach(() => { for (const k of ENV) delete process.env[k]; });

  it("shows the build date as last updated when no content date is configured", () => {
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-11-04T05:00:00.000Z";
    const { container } = withIntl(<AppFooter />);
    expect(screen.getByText(/Last updated: 04 Nov 2026/)).toBeInTheDocument();
    expect(container.querySelector("[data-gigw-unset=\"NEXT_PUBLIC_BUILD_TIME\"]")).toBeNull();
  });

  it("shows the labelled demonstration department until NEXT_PUBLIC_GIGW_OWNER is set", () => {
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-11-04T05:00:00.000Z";
    const { container } = withIntl(<AppFooter />);
    const owner = container.querySelector("[data-gigw-default=\"NEXT_PUBLIC_GIGW_OWNER\"]");
    expect(owner).toHaveTextContent("Owned and maintained by CivitasOne Demonstration Department (UAT)");
    expect(container.textContent).not.toContain("[Content to be " + "supplied");
  });

  it("shows the configured department (en and hi), without the default", () => {
    process.env.NEXT_PUBLIC_GIGW_OWNER = "Department of Testing";
    const en = withIntl(<AppFooter />);
    expect(en.container).toHaveTextContent("Owned and maintained by Department of Testing");
    expect(en.container.querySelector("[data-gigw-default]")).toBeNull();
    en.unmount();
    const hi = withIntl(<AppFooter />, "hi");
    expect(hi.container).toHaveTextContent("स्वामित्व और रखरखाव: Department of Testing");
  });

  it("links to the sitemap, contact us and feedback pages", () => {
    withIntl(<AppFooter />);
    for (const href of ["/sitemap", "/contact-us", "/feedback"]) {
      expect(GIGW_FOOTER_LINKS.map((l) => l.href)).toContain(href);
    }
    for (const l of GIGW_FOOTER_LINKS) {
      expect(screen.getByRole("link", { name: (enMessages.shell as Record<string, string>)[l.key] })).toHaveAttribute("href", l.href);
    }
  });
});

describe("public site footer (A-N1 / A-N2)", () => {
  afterEach(() => { for (const k of ENV) delete process.env[k]; });

  it("uses the footer tokens, never the 2.42:1 text-gray-400", () => {
    const { container } = withIntl(<MarketingLayout><div /></MarketingLayout>);
    const footer = container.querySelector("footer")!;
    expect(footer).toHaveClass("site-foot");
    expect(footer.querySelector("[class*=\"text-gray-\"]")).toBeNull();
  });

  it("carries the identity line and links to every GIGW page", () => {
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-11-04T05:00:00.000Z";
    const { container } = withIntl(<MarketingLayout><div /></MarketingLayout>);
    const footer = container.querySelector("footer")!;
    expect(footer).toHaveTextContent(/Last updated: 04 Nov 2026/);
    expect(footer.querySelector("[data-gigw-default=\"NEXT_PUBLIC_GIGW_OWNER\"]")).toHaveTextContent("CivitasOne Demonstration Department (UAT)");
    const hrefs = [...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const p of ["/accessibility-statement", "/screen-reader-access", "/website-policies", "/sitemap", "/contact-us",
      "/feedback", "/help-desk", "/privacy-policy", "/terms-and-conditions", "/hyperlink-policy", "/copyright-policy", "/disclaimer", "/about",
      "/content-contribution-policy", "/content-archival-policy", "/content-review-policy"]) {
      expect(hrefs, p).toContain(p);
    }
  });

  it("WCAG 1.4.10: below sm the sandbox link moves into the mobile menu, so the header fits 320 px", () => {
    const { container } = withIntl(<MarketingLayout><div /></MarketingLayout>);
    const header = container.querySelector("header")!;
    const inBar = header.querySelector("nav > div:last-child > a[href=\"/sandbox\"]");
    expect(inBar).toHaveClass("hidden", "sm:inline-block");
    fireEvent.click(header.querySelector("button")!);
    const menuLinks = [...header.querySelectorAll("a[href=\"/sandbox\"]")].filter((a) => a !== inBar);
    expect(menuLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("PR #2457 review (WCAG 3.1.2): on Hindi pages the English header and footer text is marked lang=\"en\"", () => {
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-11-04T05:00:00.000Z";
    const { container } = withIntl(<MarketingLayout><div /></MarketingLayout>, "hi");
    const langOf = (el: Element) => el.closest("[lang]")?.getAttribute("lang") ?? null;
    const header = container.querySelector("header")!;
    expect(header).toHaveAttribute("lang", "en");
    for (const name of ["Products", "Pricing", "Docs", "Sign In"]) expect(langOf(screen.getAllByText(name)[0]!), name).toBe("en");
    const footer = container.querySelector("footer")!;
    for (const text of ["Features", "Modules", "Documentation", "Careers", "Made in India"]) {
      const el = [...footer.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent?.includes(text))!;
      expect(langOf(el), text).toBe("en");
    }
    expect(langOf([...footer.querySelectorAll("span")].find((e) => e.textContent?.startsWith("© 2026"))!)).toBe("en");
    // translated parts stay in the page language
    const about = [...footer.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/about")!;
    expect(about).toHaveTextContent("हमारे बारे में");
    expect(langOf(about)).toBeNull();
    expect(footer).toHaveTextContent("अंतिम अद्यतन: 4 नवंबर 2026");
  });
});

