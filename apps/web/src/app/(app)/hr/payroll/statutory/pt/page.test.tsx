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
const pendingVersion = { id: "11111111-1111-4111-8111-111111111111", kind: "version", stateCode: "MH", effectiveFrom: "2027-04-01", slabs: [slab], reason: "Revised Schedule", makerId: "maker-1", createdAt: "2026-10-01T00:00:00Z" };
const payload = {
  today: "2026-10-03", viewerId: "viewer-9", makerChecker: true, pending: [] as unknown[], lastFinalisedMonth: "2026-08", earliestEffectiveFrom: "2026-09-01",
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

  it("maker != checker: another administrator's pending version is listed with Approve / Reject; your own is not approvable", async () => {
    loaded({ ...payload, pending: [pendingVersion, { ...pendingVersion, id: "22222222-2222-4222-8222-222222222222", makerId: "viewer-9", effectiveFrom: "2027-07-01" }] });
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH" } }));
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(1);
    expect(screen.getByText("Requested by another administrator")).toBeInTheDocument();
    expect(screen.getByText("Requested by you")).toBeInTheDocument();
    expect(screen.getByText("Waiting for a different payroll administrator to approve this.")).toBeInTheDocument();
    expect(screen.queryByText(/maker-1|viewer-9/)).not.toBeInTheDocument(); // never raw ids
  });

  it("a payroll_officer sees pending requests but no approve / reject / switch controls", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
    loaded({ ...payload, pending: [pendingVersion] });
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH" } }));
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByText("Second approver for professional tax changes")).not.toBeInTheDocument();
  });

  it("shows the second-approver switch to payroll_admin: ON by default, with a request-to-turn-off action", async () => {
    loaded();
    renderPage(await ProfessionalTaxPage({ searchParams: { state: "MH" } }));
    expect(screen.getByText("Second approver for professional tax changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request to turn off" })).toBeInTheDocument();
  });

  it("a load failure is an error state, never an empty timeline", async () => {
    fetchJsonMock.mockResolvedValue({ data: { today: "", viewerId: "", makerChecker: true, pending: [], lastFinalisedMonth: null, earliestEffectiveFrom: null, states: [] }, source: "error" });
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
