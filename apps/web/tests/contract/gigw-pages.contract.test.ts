/**
 * Contract: every GIGW 3.0 page is public and answers 200 without login.
 *
 * UAT post-b14 (a11y-post-b14-11032009 gigw.jsonl): 15 of the GIGW paths the
 * accessibility harness probes still returned 404. The list below is the
 * harness list (~/orch-logs/a11y-post-b14-tools/a11y.js, gigw phase) minus the
 * signed-in app routes it also probes (/help, /help/contact, /helpdesk), plus
 * the public /contact enquiry page. For each path this checks that:
 *   - a (marketing) route file exists for it (so Next serves 200, not 404),
 *   - the middleware lets an anonymous request through (no login redirect),
 *   - the page renders one h1 and its metadata title, and
 *   - owner-specific sections are clearly marked placeholders, never invented.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { NextRequest } from "next/server";
import type { ReactElement } from "react";
import enMessages from "@/messages/en.json";
import { middleware } from "@/middleware";

vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) =>
    (enMessages as unknown as Record<string, Record<string, string>>)[ns]?.[key] ?? key,
}));

type PageModule = {
  default: (props?: never) => Promise<ReactElement> | ReactElement;
  generateMetadata?: () => Promise<{ title?: unknown }>;
};

const PAGES: Record<string, () => Promise<PageModule>> = {
  "/accessibility-statement": () => import("@/app/(marketing)/accessibility-statement/page"),
  "/accessibility": () => import("@/app/(marketing)/accessibility/page"),
  "/screen-reader-access": () => import("@/app/(marketing)/screen-reader-access/page"),
  "/website-policies": () => import("@/app/(marketing)/website-policies/page"),
  "/policies": () => import("@/app/(marketing)/policies/page"),
  "/sitemap": () => import("@/app/(marketing)/sitemap/page"),
  "/site-map": () => import("@/app/(marketing)/site-map/page"),
  "/contact-us": () => import("@/app/(marketing)/contact-us/page"),
  "/feedback": () => import("@/app/(marketing)/feedback/page"),
  "/privacy": () => import("@/app/(marketing)/privacy/page"),
  "/privacy-policy": () => import("@/app/(marketing)/privacy-policy/page"),
  "/terms": () => import("@/app/(marketing)/terms/page"),
  "/terms-and-conditions": () => import("@/app/(marketing)/terms-and-conditions/page"),
  "/hyperlink-policy": () => import("@/app/(marketing)/hyperlink-policy/page"),
  "/copyright-policy": () => import("@/app/(marketing)/copyright-policy/page"),
  "/disclaimer": () => import("@/app/(marketing)/disclaimer/page"),
  "/about": () => import("@/app/(marketing)/about/page"),
  "/help-desk": () => import("@/app/(marketing)/help-desk/page"),
};

/** The 15 paths that were 404 in the post-b14 retest. */
const WERE_404 = [
  "/accessibility", "/sitemap", "/site-map", "/contact-us", "/feedback", "/privacy", "/privacy-policy",
  "/terms", "/terms-and-conditions", "/policies", "/hyperlink-policy", "/copyright-policy",
  "/disclaimer", "/about", "/help-desk",
];

const PUBLIC_PATHS = [...Object.keys(PAGES), "/contact"];
const APP_DIR = join(__dirname, "../../src/app");
const gigw = enMessages.gigw as Record<string, string>;

async function anonymous(path: string) {
  return middleware(new NextRequest(new URL(path, "http://localhost:3000")));
}

describe("GIGW pages contract (UAT post-b14)", () => {
  it("covers every path that was 404 in the retest", () => {
    expect(WERE_404).toHaveLength(15);
    for (const p of WERE_404) expect(PAGES[p], p).toBeDefined();
  });

  it.each(PUBLIC_PATHS)("%s has a public (marketing) route file", (path) => {
    expect(existsSync(join(APP_DIR, "(marketing)", path.slice(1), "page.tsx")), path).toBe(true);
  });

  it.each(PUBLIC_PATHS)("%s answers 200 to an anonymous request (no login redirect)", async (path) => {
    const res = await anonymous(path);
    expect(res.headers.get("location"), path).toBeNull();
    expect(res.status).toBe(200);
  });

  it.each(Object.keys(PAGES))("%s renders one h1 and a page title", async (path) => {
    const mod = await PAGES[path]!();
    const ui = await mod.default();
    const { container } = render(ui);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent ?? "").not.toMatch(/could not be found|404/i);
    const meta = await mod.generateMetadata?.();
    expect(String(meta?.title ?? ""), path).toMatch(/\| CivitasOne$/);
    cleanup();
  });

  it("alias paths render the same page as their canonical path", async () => {
    const pairs: [string, string][] = [
      ["/accessibility", "/accessibility-statement"], ["/policies", "/website-policies"],
      ["/site-map", "/sitemap"], ["/privacy", "/privacy-policy"], ["/terms", "/terms-and-conditions"],
    ];
    for (const [alias, canonical] of pairs) {
      const a = render(await (await PAGES[alias]!()).default()).container.innerHTML;
      cleanup();
      const c = render(await (await PAGES[canonical]!()).default()).container.innerHTML;
      cleanup();
      expect(a, alias).toBe(c);
    }
  });

  it("owner-specific sections are marked department placeholders, and only those", async () => {
    const ownerOnly = ["/about", "/contact-us"];
    for (const path of ownerOnly) {
      const { container } = render(await (await PAGES[path]!()).default());
      expect(container.querySelector("[data-deferred-content=\"page\"]"), path).toHaveTextContent(gigw.pendingNotice);
      const marked = container.querySelectorAll("[data-deferred-content]:not([data-deferred-content=\"page\"])");
      expect(marked.length, path).toBeGreaterThan(0);
      for (const m of marked) expect(m).toHaveTextContent(gigw.pendingDepartment);
      cleanup();
    }
    expect(gigw.pendingDepartment).toBe("[Content to be supplied by the department]");
  });

  it("standard-wording pages say so, and mark every department-specific section", async () => {
    for (const path of ["/privacy-policy", "/terms-and-conditions", "/hyperlink-policy", "/copyright-policy", "/feedback", "/help-desk"]) {
      const { container } = render(await (await PAGES[path]!()).default());
      expect(container.querySelector("[data-deferred-content=\"page\"]"), path).toHaveTextContent(gigw.standardNotice);
      for (const m of container.querySelectorAll("[data-deferred-content]:not([data-deferred-content=\"page\"])")) {
        expect(m, path).toHaveTextContent(gigw.pendingDepartment);
      }
      cleanup();
    }
  });

  it("the sitemap links to every public GIGW page and to sign in", async () => {
    render(await (await PAGES["/sitemap"]!()).default());
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const p of ["/", "/accessibility-statement", "/screen-reader-access", "/website-policies", "/privacy-policy",
      "/terms-and-conditions", "/hyperlink-policy", "/copyright-policy", "/disclaimer", "/about", "/contact-us",
      "/help-desk", "/feedback", "/auth/login"]) {
      expect(hrefs, p).toContain(p);
    }
    cleanup();
  });
});
