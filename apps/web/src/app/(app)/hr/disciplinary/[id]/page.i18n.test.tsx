/**
 * GAP-HR-DISCIPLINARY-DETAIL-07: the breadcrumbs, back label, loading text and
 * the load-error / e-office wording are all next-intl keys now, in BOTH en and
 * hi (hi.json used to have no `disciplinaryDetail` namespace at all, so a
 * Hindi session fell through to next-intl's missing-message path).
 *
 * The suite-wide next-intl/server mock is English-only, so this file brings its
 * own locale-switchable one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

let mockLocale: "en" | "hi" = "en";
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const enMessages = (await import("@/messages/en.json")).default;
  const hiMessages = (await import("@/messages/hi.json")).default;
  return {
    getTranslations: async (arg?: string | { namespace?: string }) => {
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      return createTranslator({
        locale: mockLocale,
        messages: mockLocale === "hi" ? hiMessages : enMessages,
        namespace,
      } as Parameters<typeof createTranslator>[0]);
    },
    getLocale: async () => mockLocale,
    getMessages: async () => (mockLocale === "hi" ? hiMessages : enMessages),
  };
});

vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["hr_admin"],
  getSessionUserId: () => "u1",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import DisciplinaryCaseDetailPage from "./page";
import Loading from "./loading";

const DIR = join(process.cwd(), "src/app/(app)/hr/disciplinary/[id]");

describe("disciplinary case detail: locale-aware breadcrumbs and loading text (GAP-HR-DISCIPLINARY-DETAIL-07)", () => {
  beforeEach(() => {
    mockLocale = "en";
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
  });

  it("renders English breadcrumbs as real links in en", async () => {
    render(await DisciplinaryCaseDetailPage({ params: { id: "c1" } }));
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toHaveTextContent("HR");
    expect(nav).toHaveTextContent("Disciplinary");
    expect(nav).toHaveTextContent("Not found");
    expect(screen.getByRole("link", { name: "HR" })).toHaveAttribute("href", "/hr");
    expect(screen.getByRole("link", { name: "Disciplinary" })).toHaveAttribute("href", "/hr/disciplinary");
  });

  it("translates the breadcrumbs, heading and empty state when the locale is hi", async () => {
    mockLocale = "hi";
    render(await DisciplinaryCaseDetailPage({ params: { id: "c1" } }));
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toHaveTextContent(hi.disciplinaryDetail.crumbDisciplinary);
    expect(nav).toHaveTextContent(hi.disciplinaryDetail.crumbNotFound);
    expect(nav).not.toHaveTextContent("Not found");
    expect(screen.getByText(hi.disciplinaryDetail.notFoundEmptyTitle)).toBeInTheDocument();
    expect(screen.queryByText(en.disciplinaryDetail.notFoundEmptyTitle)).not.toBeInTheDocument();
  });

  it("translates the loading skeleton's heading and sub-text per locale", async () => {
    render(await Loading());
    expect(screen.getByText(en.disciplinaryDetail.loadingSub)).toBeInTheDocument();
    mockLocale = "hi";
    render(await Loading());
    expect(screen.getByText(hi.disciplinaryDetail.loadingSub)).toBeInTheDocument();
  });

  it("hi.json carries every disciplinaryDetail key en.json does, and no stray ones", () => {
    expect(Object.keys(hi.disciplinaryDetail).sort()).toEqual(Object.keys(en.disciplinaryDetail).sort());
  });

  it("every hi value for a key with an ICU placeholder keeps the same placeholders", () => {
    const enNs = en.disciplinaryDetail as Record<string, string>;
    const hiNs = hi.disciplinaryDetail as Record<string, string>;
    for (const key of Object.keys(enNs)) {
      const ph = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");
      expect(ph(hiNs[key]!), key).toBe(ph(enNs[key]!));
    }
  });

  it("page.tsx and loading.tsx contain no literal English UI props or text (grep guard)", () => {
    const page = readFileSync(join(DIR, "page.tsx"), "utf8");
    const loading = readFileSync(join(DIR, "loading.tsx"), "utf8");
    // area / subject / module props must come from t(), never a string literal
    expect(page).not.toMatch(/\barea="[^"]+"/);
    expect(page).not.toMatch(/\bmodule="[^"]+"/);
    expect(page).not.toMatch(/subject=\{`/);
    // the e-office department key is a named system identifier, not inline copy
    expect(page).not.toMatch(/\bdept="[^"]+"/);
    expect(loading).not.toContain("Loading case details");
    expect(loading).not.toContain(">Disciplinary Case<");
  });
});
