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
// The loaded-case state also renders these two client components; they need a
// NextIntlClientProvider and carry their own copy, which is not what this file
// is about (the page's own server-rendered breadcrumbs / headings are).
vi.mock("./_components/CaseActions", () => ({ CaseActions: () => null }));
vi.mock("@/app/_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: () => null }));

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
    const nav = screen.getByRole("navigation", { name: hi.disciplinaryDetail.breadcrumbLabel });
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

  it("breadcrumbLabel exists in both catalogues and the Hindi value is actually translated", () => {
    expect(en.disciplinaryDetail.breadcrumbLabel).toBe("Breadcrumb");
    expect(hi.disciplinaryDetail.breadcrumbLabel).toBeTruthy();
    expect(hi.disciplinaryDetail.breadcrumbLabel).not.toBe(en.disciplinaryDetail.breadcrumbLabel);
    expect(hi.disciplinaryDetail.breadcrumbLabel).toMatch(/[\u0900-\u097F]/); // Devanagari, not Latin
  });

  it("page.tsx takes every nav's accessible name from messages, with no aria-label string literal (grep guard)", () => {
    const page = readFileSync(join(DIR, "page.tsx"), "utf8");
    expect(page).not.toMatch(/aria-label="/);
    expect(page.match(/<nav aria-label=\{t\("breadcrumbLabel"\)\}/g)).toHaveLength(3);
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

describe("disciplinary case detail: breadcrumb navigation label comes from messages in every page state (GAP-HR-DISCIPLINARY-DETAIL-07)", () => {
  const CASE = {
    id: "c1", tenantId: "t1", employeeId: "emp-1", caseNo: "DC/2026/0007", proceedingType: "major",
    status: "inquiry_appointed", allegation: "x", createdBy: "u1", version: 1,
  };

  type State = { name: string; caseResult: unknown };
  const STATES: State[] = [
    { name: "case not found (404)", caseResult: { data: null, source: "error", status: 404 } },
    { name: "load error (500)", caseResult: { data: null, source: "error", status: 500 } },
    { name: "case loaded", caseResult: { data: CASE, source: "api" } },
  ];

  function mockCaseLoaders(caseResult: unknown) {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/disciplinary-cases/") && url.includes("/events")) return Promise.resolve({ data: [], source: "api" });
      if (url.includes("/disciplinary-cases/")) return Promise.resolve(caseResult);
      if (url.includes("/employees/")) return Promise.resolve({ data: { id: "emp-1", employeeId: "E-100", name: "A. Kumar" }, source: "api" });
      return Promise.resolve({ data: null, source: "error", status: 404 });
    });
  }

  beforeEach(() => {
    mockLocale = "en";
    fetchJsonMock.mockReset();
  });

  for (const { name, caseResult } of STATES) {
    it(`${name}: en nav is named from en.json`, async () => {
      mockCaseLoaders(caseResult);
      render(await DisciplinaryCaseDetailPage({ params: { id: "c1" } }));
      expect(screen.getByRole("navigation", { name: en.disciplinaryDetail.breadcrumbLabel })).toBeInTheDocument();
    });

    it(`${name}: hi nav is named from hi.json and the English literal is gone`, async () => {
      mockLocale = "hi";
      mockCaseLoaders(caseResult);
      render(await DisciplinaryCaseDetailPage({ params: { id: "c1" } }));
      expect(screen.getByRole("navigation", { name: hi.disciplinaryDetail.breadcrumbLabel })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
      expect(document.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    });
  }
});
