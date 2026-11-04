/**
 * UAT gigw-content (GIGW 3.0): every GIGW public page renders its complete
 * content in English and Hindi, with one h1, headings in order, the
 * department identity and contacts from config (labelled demonstration
 * defaults / "To be configured before go-live") and a "Last reviewed" date.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { NextRequest } from "next/server";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { middleware } from "@/middleware";
import { GIGW_CONFIG_KEYS } from "@/lib/gigw/departmentConfig";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "hi" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator: create } = await import("next-intl");
  const en = (await import("@/messages/en.json")).default;
  const hi = (await import("@/messages/hi.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      create({ locale: state.locale, messages: (state.locale === "hi" ? hi : en) as never, namespace: namespace as never }),
  };
});

import { renderGigwPage } from "./renderGigwPage";
import { GIGW_PAGE_LINKS, GIGW_PAGE_SPECS, SCREEN_READERS, type GigwBlock, type GigwSlug } from "./gigwContent";

const LOCALES = { en: enMessages, hi: hiMessages } as const;
type Locale = keyof typeof LOCALES;
const SLUGS = Object.keys(GIGW_PAGE_SPECS) as GigwSlug[];
const ENV_KEYS = [...Object.values(GIGW_CONFIG_KEYS), "NEXT_PUBLIC_BUILD_TIME", "NEXT_PUBLIC_CONTENT_UPDATED_AT"];
const PLACEHOLDER = "[Content to be " + "supplied";

function tr(locale: Locale) {
  const t = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "gigw" as never }) as unknown as (k: string, v?: Record<string, string>) => string;
  const dept = t("defaultDepartment");
  return (k: string) => t(k, { department: dept, date: "" });
}

/** Every message key a block uses, and its h3 headings. */
function walk(blocks: GigwBlock[], keys: string[], h3: string[]) {
  for (const b of blocks) {
    if ("p" in b) keys.push(b.p);
    else if ("ul" in b) keys.push(...b.ul);
    else if ("ol" in b) keys.push(...b.ol);
    else if ("links" in b) keys.push(...b.links.map((l) => l.label));
    else if ("h3" in b) { h3.push(b.h3); keys.push(b.h3); walk(b.blocks, keys, h3); }
  }
}

function headingLevels(container: HTMLElement) {
  return [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
}

async function renderPage(slug: GigwSlug, locale: Locale) {
  state.locale = locale;
  return render(await renderGigwPage(slug));
}

beforeEach(() => { process.env.NEXT_PUBLIC_BUILD_TIME = "2026-11-04T05:00:00.000Z"; });
afterEach(() => { cleanup(); state.locale = "en"; for (const k of ENV_KEYS) delete process.env[k]; });

describe("GIGW page content (en + hi)", () => {
  it("the spec uses only keys that exist in both catalogues", () => {
    for (const spec of Object.values(GIGW_PAGE_SPECS)) {
      const keys = [spec.title, ...(spec.intro ? [spec.intro] : []), ...spec.sections.map((s) => s.heading)];
      for (const s of spec.sections) walk(s.blocks, keys, []);
      for (const k of keys) {
        expect((enMessages.gigw as Record<string, string>)[k], k).toBeTruthy();
        expect((hiMessages.gigw as Record<string, string>)[k], k).toBeTruthy();
      }
    }
    for (const r of SCREEN_READERS) expect((hiMessages.gigw as Record<string, string>)[r.description], r.id).toBeTruthy();
  });

  for (const locale of ["en", "hi"] as const) {
    it.each(SLUGS)(`%s renders its title, every section and its text (${locale})`, async (slug) => {
      const t = tr(locale);
      const spec = GIGW_PAGE_SPECS[slug];
      const { container } = await renderPage(slug, locale);

      const h1s = container.querySelectorAll("h1");
      expect(h1s, slug).toHaveLength(1);
      expect(h1s[0]).toHaveTextContent(t(spec.title));
      expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(spec.sections.map((s) => t(s.heading)));
      const h3: string[] = [];
      const keys: string[] = [];
      for (const s of spec.sections) walk(s.blocks, keys, h3);
      expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(h3.map(t));

      // headings start at h1 and never skip a level
      const levels = headingLevels(container);
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, `${slug} heading ${i}`).toBeLessThanOrEqual(1);

      const text = container.textContent ?? "";
      if (spec.intro) expect(text).toContain(t(spec.intro));
      for (const k of keys) expect(text, `${slug} ${k}`).toContain(t(k));
      expect(text).not.toContain(PLACEHOLDER);
      expect(container.querySelector("[data-deferred-content]")).toBeNull();
      expect(container.querySelector("a[href^=\"mailto:\"]")).toBeNull();

      const reviewed = container.querySelector("[data-gigw-reviewed]");
      expect(reviewed).toHaveTextContent(locale === "en" ? "Last reviewed: 04 Nov 2026" : "अंतिम समीक्षा: 04 Nov 2026");
    });
  }

  it("Hindi pages are in Hindi, not English", async () => {
    for (const slug of SLUGS) {
      const { container } = await renderPage(slug, "hi");
      const en = tr("en");
      for (const s of GIGW_PAGE_SPECS[slug].sections) expect(container.textContent, `${slug} ${s.id}`).not.toContain(en(s.heading));
      cleanup();
    }
  });
});

describe("department identity and contacts come from config", () => {
  it("unset: demonstration names and \"To be configured before go-live\", never an invented contact", async () => {
    const { container } = await renderPage("contact-us", "en");
    const g = enMessages.gigw as Record<string, string>;
    expect(container.querySelector("[data-gigw-default=\"NEXT_PUBLIC_GIGW_OWNER\"]")).toHaveTextContent("CivitasOne Demonstration Department (UAT)");
    expect(container.querySelector("[data-gigw-default=\"NEXT_PUBLIC_GIGW_WIM_DESIGNATION\"]")).toHaveTextContent("Web Information Manager, CivitasOne Demonstration Department");
    for (const key of ["NEXT_PUBLIC_GIGW_WIM_EMAIL", "NEXT_PUBLIC_GIGW_WIM_PHONE", "NEXT_PUBLIC_GIGW_ADDRESS", "NEXT_PUBLIC_GIGW_HELPDESK_EMAIL",
      "NEXT_PUBLIC_GIGW_HELPDESK_PHONE", "NEXT_PUBLIC_GIGW_HELPDESK_HOURS", "NEXT_PUBLIC_GIGW_PIO_CONTACT"]) {
      expect(container.querySelector(`[data-gigw-unset="${key}"]`), key).toHaveTextContent(g.toBeConfigured!);
    }
    expect(container.textContent).not.toMatch(/\[at\]\w/);
    const wim = within(container.querySelector("#gigw-web-information-manager")!.closest("section")!);
    expect(wim.getByText(g.fieldEmail!)).toBeInTheDocument();
  });

  it("unset (Hindi): the Hindi demonstration names and the Hindi \"to be configured\" text", async () => {
    const { container } = await renderPage("contact-us", "hi");
    expect(container.querySelector("[data-gigw-default=\"NEXT_PUBLIC_GIGW_OWNER\"]")).toHaveTextContent("CivitasOne प्रदर्शन विभाग (यूएटी)");
    expect(container.querySelector("[data-gigw-unset=\"NEXT_PUBLIC_GIGW_WIM_EMAIL\"]")).toHaveTextContent("गो-लाइव से पूर्व निर्धारित किया जाना है");
  });

  it("the department name fills {department} in the page text", async () => {
    await renderPage("about", "en");
    expect(screen.getByText(/^CivitasOne Demonstration Department \(UAT\) uses this portal/)).toBeInTheDocument();
    cleanup();
    process.env.NEXT_PUBLIC_GIGW_OWNER = "Department of Testing, Government of Example";
    const { container } = await renderPage("about", "hi");
    expect(container.textContent).toContain("Department of Testing, Government of Example अपना कार्यालयीन कार्य");
    expect(container.textContent).not.toContain("प्रदर्शन विभाग");
  });

  it("configured: values are shown, e-mail written as [at]/[dot], no placeholder left", async () => {
    process.env.NEXT_PUBLIC_GIGW_WIM_DESIGNATION = "Joint Director (IT)";
    process.env.NEXT_PUBLIC_GIGW_WIM_EMAIL = "wim@dept.example";
    process.env.NEXT_PUBLIC_GIGW_WIM_PHONE = "+91-00-0000-0000";
    process.env.NEXT_PUBLIC_GIGW_ADDRESS = "Example Bhawan, Example City";
    process.env.NEXT_PUBLIC_GIGW_HELPDESK_EMAIL = "help@dept.example";
    process.env.NEXT_PUBLIC_GIGW_HELPDESK_PHONE = "1800-000-0000";
    process.env.NEXT_PUBLIC_GIGW_HELPDESK_HOURS = "09:30 to 18:00, Monday to Friday";
    process.env.NEXT_PUBLIC_GIGW_PIO_CONTACT = "Under Secretary (RTI)";
    const { container } = await renderPage("contact-us", "en");
    expect(container.textContent).toContain("wim[at]dept[dot]example");
    expect(container.textContent).toContain("help[at]dept[dot]example");
    expect(container.textContent).not.toContain("wim@dept.example");
    for (const v of ["Joint Director (IT)", "+91-00-0000-0000", "Example Bhawan, Example City", "1800-000-0000", "09:30 to 18:00, Monday to Friday", "Under Secretary (RTI)"]) {
      expect(container.textContent, v).toContain(v);
    }
    expect(container.querySelector("[data-gigw-unset]")).toBeNull();
    expect(container.querySelector("[data-gigw-default=\"NEXT_PUBLIC_GIGW_WIM_DESIGNATION\"]")).toBeNull();
  });

  it("\"Last reviewed\": the department review date wins over the build date; with neither it says so", async () => {
    process.env.NEXT_PUBLIC_GIGW_REVIEWED_AT = "2026-10-01";
    let { container } = await renderPage("privacy-policy", "en");
    expect(container.querySelector("[data-gigw-reviewed]")).toHaveTextContent("Last reviewed: 01 Oct 2026");
    cleanup();
    delete process.env.NEXT_PUBLIC_GIGW_REVIEWED_AT;
    delete process.env.NEXT_PUBLIC_BUILD_TIME;
    ({ container } = await renderPage("privacy-policy", "hi"));
    expect(container.querySelector("[data-gigw-reviewed]")).toHaveTextContent((hiMessages.gigw as Record<string, string>).lastReviewedPending!);
  });
});

describe("screen reader access", () => {
  it.each(["en", "hi"] as const)("a captioned table of screen readers with descriptions (%s)", async (locale) => {
    const t = tr(locale);
    await renderPage("screen-reader-access", locale);
    const table = screen.getByRole("table", { name: t("srTableCaption") });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([t("srColName"), t("srColDescription"), t("srColType")]);
    for (const r of SCREEN_READERS) {
      const row = within(table).getByRole("rowheader", { name: r.name });
      expect(row).toHaveAttribute("lang", "en");
      expect(row.closest("tr")).toHaveTextContent(t(r.description));
      expect(row.closest("tr")).toHaveTextContent(t(r.kind));
    }
    for (const name of ["NVDA (NonVisual Desktop Access)", "JAWS (Job Access With Speech)", "Windows Narrator", "VoiceOver", "TalkBack"]) {
      expect(within(table).getByRole("rowheader", { name })).toBeInTheDocument();
    }
  });
});

describe("website policies and sitemap", () => {
  it("the umbrella page links to every policy page", async () => {
    await renderPage("website-policies", "en");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const p of ["/privacy-policy", "/terms-and-conditions", "/hyperlink-policy", "/copyright-policy", "/disclaimer",
      "/content-contribution-policy", "/content-archival-policy", "/content-review-policy", "/accessibility-statement"]) {
      expect(hrefs, p).toContain(p);
    }
  });

  it("the sitemap lists every GIGW page except itself", async () => {
    await renderPage("sitemap", "en");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const l of GIGW_PAGE_LINKS) if (l.href !== "/sitemap") expect(hrefs, l.href).toContain(l.href);
  });

  it.each(["/content-contribution-policy", "/content-archival-policy", "/content-review-policy", "/accessibility-statement", "/screen-reader-access", "/website-policies"])(
    "%s is public (no login redirect)",
    async (path) => {
      const res = await middleware(new NextRequest(new URL(path, "http://localhost:3000")));
      expect(res.headers.get("location") ?? "").not.toContain("/auth/login");
    },
  );
});
