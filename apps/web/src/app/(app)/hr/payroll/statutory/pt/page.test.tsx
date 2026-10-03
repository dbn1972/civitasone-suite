import { describe, it, expect, vi, beforeEach } from "vitest";

// Role gate: default every test to payroll_admin; the gate tests override per call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: getSessionRolesMock,
}));
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ProfessionalTaxPage from "./page";

function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const slab = { fromMinor: 0, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: null };
const payload = {
  today: "2026-10-03", lastFinalisedMonth: "2026-08", earliestEffectiveFrom: "2026-09-01",
  states: [{
    stateCode: "MH",
    versions: [
      { stateCode: "MH", effectiveFrom: "1900-01-01", effectiveTo: "2025-03-31", status: "past", legacy: true, reason: "Migrated from unversioned slabs", backDated: false, createdAt: null, slabs: [slab] },
      { stateCode: "MH", effectiveFrom: "2025-04-01", effectiveTo: null, status: "current", legacy: false, reason: null, backDated: false, createdAt: null, slabs: [{ ...slab, taxMinor: 25000, februaryTaxMinor: 30000 }] },
    ],
  }],
};
const loaded = (data = payload) => fetchJsonMock.mockImplementation((_p: string, _e: unknown, opts: { mapResponse: (x: unknown) => unknown }) => Promise.resolve({ data: opts.mapResponse(data), source: "api" }));

describe("ProfessionalTaxPage (versioned slabs)", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("without a state: asks for one, lists nothing, still shows the annual cap note", async () => {
    loaded();
    renderPage(await ProfessionalTaxPage({}));
    expect(screen.getByText("Select a state")).toBeInTheDocument();
    expect(screen.getByText(/Article 276\(2\)/)).toBeInTheDocument();
    expect(screen.queryByText("Version timeline", { exact: false })).not.toBeInTheDocument();
  });

  it("shows the version timeline with effective from / to and status, and the in-force slabs read-only", async () => {
    loaded();
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH" } }));
    expect(screen.getByText(/Version timeline — Maharashtra \(MH\)/)).toBeInTheDocument();
    expect(screen.getByText("Since the beginning")).toBeInTheDocument();
    expect(screen.getByText("Open-ended")).toBeInTheDocument();
    expect(screen.getByText("31 Mar 2025")).toBeInTheDocument();
    expect(screen.getByText("In force")).toBeInTheDocument();
    expect(screen.getByText("Superseded")).toBeInTheDocument();
    expect(screen.getByText("No upper bound")).toBeInTheDocument();
    // February amount of the selected (current) version
    expect(screen.getByText(/300\.00/)).toBeInTheDocument();
    expect(screen.getByText(/This version is read-only/)).toBeInTheDocument();
  });

  it("?version= shows a past version read-only with its recorded reason", async () => {
    loaded();
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH", version: "1900-01-01" } }));
    expect(screen.getByText(/Reason recorded: Migrated from unversioned slabs/)).toBeInTheDocument();
  });

  it("the old 'takes effect immediately' copy is gone; the new-version form is offered to payroll_admin", async () => {
    loaded();
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH" } }));
    expect(screen.queryByText(/immediately/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Create a new version — Maharashtra \(MH\)/)).toBeInTheDocument();
    expect(screen.getByText(/Earlier versions are never altered/)).toBeInTheDocument();
  });

  it("a payroll_officer can read the timeline but is not offered the create form (API is admin-only)", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
    loaded();
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH" } }));
    expect(screen.getByText(/Version timeline/)).toBeInTheDocument();
    expect(screen.queryByText(/Create a new version/)).not.toBeInTheDocument();
  });

  it("a state with no versions shows the empty state and the form to create the first one", async () => {
    loaded();
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "KA" } }));
    expect(screen.getAllByText("No slab versions for this state").length).toBeGreaterThan(0);
    expect(screen.getByText(/Create a new version — Karnataka \(KA\)/)).toBeInTheDocument();
  });

  it("a load failure is an error state, never an empty timeline", async () => {
    fetchJsonMock.mockResolvedValue({ data: { today: "", lastFinalisedMonth: null, earliestEffectiveFrom: null, states: [] }, source: "error" });
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH" } }));
    expect(screen.queryByText("Select a state")).not.toBeInTheDocument();
    expect(screen.queryByText("No slab versions for this state")).not.toBeInTheDocument();
    expect(screen.queryByText(/Version timeline/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-PT-01: employee/manager get Access restricted without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    renderPage(await ProfessionalTaxPage({}));
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

// en + hi must carry the same keys and the same placeholders (the Hindi page
// itself renders through next-intl/server, which these tests mock to English).
describe("pt / ptVersionForm messages: en and hi are in step", () => {
  const placeholders = (v: unknown) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const ns of ["pt", "ptVersionForm"] as const) {
    it(`${ns}: same keys, same placeholders, no leftover English-only copy`, async () => {
      const hi = (await import("@/messages/hi.json")).default as unknown as Record<string, Record<string, string>>;
      const en = enMessages as unknown as Record<string, Record<string, string>>;
      expect(Object.keys(hi[ns]!).sort()).toEqual(Object.keys(en[ns]!).sort());
      for (const k of Object.keys(en[ns]!)) {
        expect(placeholders(hi[ns]![k]), `${ns}.${k}`).toBe(placeholders(en[ns]![k]));
      }
      expect(hi[ns]!.title ?? hi[ns]!.formTitle).not.toBe(en[ns]!.title ?? en[ns]!.formTitle);
    });
  }
  it("the retired 'takes effect immediately' namespace is gone from both locales", async () => {
    const hi = (await import("@/messages/hi.json")).default as unknown as Record<string, unknown>;
    expect("ptSlabForm" in hi).toBe(false);
    expect("ptSlabForm" in (enMessages as unknown as Record<string, unknown>)).toBe(false);
  });
});
