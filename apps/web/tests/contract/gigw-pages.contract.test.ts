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
 *   - (UAT gigw-content) the pages carry real content: no placeholder text is
 *     left anywhere in the web app, and every page shows a "Last reviewed" date.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { NextRequest } from "next/server";
import type { ReactElement } from "react";
import enMessages from "@/messages/en.json";
import { middleware } from "@/middleware";

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => {
    const { createTranslator } = await import("next-intl");
    return createTranslator({ locale: "en", messages: enMessages as never, namespace: namespace as never });
  },
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
  // UAT gigw-content: the content policies listed on /website-policies.
  "/content-contribution-policy": () => import("@/app/(marketing)/content-contribution-policy/page"),
  "/content-archival-policy": () => import("@/app/(marketing)/content-archival-policy/page"),
  "/content-review-policy": () => import("@/app/(marketing)/content-review-policy/page"),
};

/** The 15 paths that were 404 in the post-b14 retest. */
const WERE_404 = [
  "/accessibility", "/sitemap", "/site-map", "/contact-us", "/feedback", "/privacy", "/privacy-policy",
  "/terms", "/terms-and-conditions", "/policies", "/hyperlink-policy", "/copyright-policy",
  "/disclaimer", "/about", "/help-desk",
];

const PUBLIC_PATHS = [...Object.keys(PAGES), "/contact"];
const APP_DIR = join(__dirname, "../../src/app");
const WEB_DIR = join(__dirname, "../..");

// Built by concatenation so this file does not match its own scan.
const PLACEHOLDERS = ["[Content to be " + "supplied", "Content to be " + "supplied", "[सामग्री " + "लंबित", "सामग्री विभाग द्वारा उपलब्ध " + "कराई जानी है"];

function textFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".turbo")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) textFiles(p, out);
    else if (/\.(tsx?|mjs|cjs|js|json|css|md)$/.test(name)) out.push(p);
  }
  return out;
}

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

  it("no placeholder text is left anywhere in the web app (UAT gigw-content)", () => {
    const files = [...textFiles(join(WEB_DIR, "src")), ...textFiles(join(WEB_DIR, "tests")), join(WEB_DIR, ".env.example")];
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const p of PLACEHOLDERS) if (text.includes(p)) hits.push(`${file.slice(WEB_DIR.length)}: ${p}`);
    }
    expect(hits).toEqual([]);
  });

  it.each(Object.keys(PAGES))("%s has real content and a \"Last reviewed\" date, no placeholder", async (path) => {
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-11-04T05:00:00.000Z";
    const { container } = render(await (await PAGES[path]!()).default());
    const text = container.textContent ?? "";
    for (const p of PLACEHOLDERS) expect(text, path).not.toContain(p);
    expect(container.querySelector("[data-deferred-content]"), path).toBeNull();
    expect(container.querySelectorAll("h2").length, path).toBeGreaterThanOrEqual(3);
    expect(container.querySelector("[data-gigw-reviewed]"), path).toHaveTextContent("Last reviewed: 04 Nov 2026");
    delete process.env.NEXT_PUBLIC_BUILD_TIME;
    cleanup();
  });

  it("the sitemap links to every public GIGW page and to sign in", async () => {
    render(await (await PAGES["/sitemap"]!()).default());
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const p of ["/", "/accessibility-statement", "/screen-reader-access", "/website-policies", "/privacy-policy",
      "/terms-and-conditions", "/hyperlink-policy", "/copyright-policy", "/disclaimer", "/about", "/contact-us",
      "/help-desk", "/feedback", "/auth/login", "/content-contribution-policy", "/content-archival-policy", "/content-review-policy"]) {
      expect(hrefs, p).toContain(p);
    }
    cleanup();
  });
});
