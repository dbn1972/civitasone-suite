/**
 * A-N2 (UAT post-b14, GIGW 3.0 last-updated / owner identity).
 *
 * "Last updated" is real: it comes from the build time that next.config.mjs
 * bakes in as NEXT_PUBLIC_BUILD_TIME (an owner-set NEXT_PUBLIC_CONTENT_UPDATED_AT
 * still wins). The owning department is NOT invented: it stays an
 * owner-supplied config value (NEXT_PUBLIC_GIGW_OWNER) with a marked placeholder.
 * The public site footer (GIGW pages) now carries the same identity line.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(container.querySelector("[data-deferred-content=\"last-updated\"]")).toBeNull();
  });

  it("keeps the department as a marked, owner-supplied config placeholder", () => {
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-11-04T05:00:00.000Z";
    const { container } = withIntl(<AppFooter />);
    const owner = container.querySelector("[data-deferred-content=\"owner\"]");
    expect(owner).toHaveTextContent((enMessages.shell as Record<string, string>).footerOwnerPending);
    expect(owner).toHaveAttribute("data-owner-config", "NEXT_PUBLIC_GIGW_OWNER");
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
    expect(footer.querySelector("[data-deferred-content=\"owner\"]")).not.toBeNull();
    const hrefs = [...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const p of ["/accessibility-statement", "/screen-reader-access", "/website-policies", "/sitemap", "/contact-us",
      "/feedback", "/help-desk", "/privacy-policy", "/terms-and-conditions", "/hyperlink-policy", "/copyright-policy", "/disclaimer", "/about"]) {
      expect(hrefs, p).toContain(p);
    }
  });
});
