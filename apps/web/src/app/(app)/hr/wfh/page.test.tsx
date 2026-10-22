import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

/**
 * CRITICAL fix regression coverage: /hr/wfh's only "+ New Request" button
 * used to link to /hr/workforce/wfh, which is role-gated to hr_admin/
 * hr_officer/manager/super_admin -- excluding `employee` entirely, even
 * though WFH is inherently self-initiated by the employee. This page now
 * embeds the create form directly (self-service prefilled for a plain
 * employee, admin picker for HR/manager -- same getEmployees-then-
 * getMyProfile resolution as leave/apply/page.tsx) and an approve/reject
 * action column for HR/manager (mirroring RegularisationTable).
 */
let mockRoles: string[] = ["employee"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const getEmployeesMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getEmployees: (...args: unknown[]) => getEmployeesMock(...args),
  getMyProfile: (...args: unknown[]) => getMyProfileMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import WfhPage from "./page";

// This page embeds real (unmocked) "use client" components -- WFHRequestForm
// and WfhRequestsTable -- which call useTranslations() directly. Unlike the
// page's own getTranslations() (mocked globally in vitest.setup.ts), a
// client-side useTranslations() needs a real NextIntlClientProvider in the
// tree, same pattern as leave/apply/page.test.tsx.
function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

const MOCK_REQUESTS = [
  { id: "w1", employeeId: "e1", employeeName: "Sunita Rao", fromDate: "2026-08-18", toDate: "2026-08-19", reason: "Project work", status: "approved" },
  { id: "w2", employeeId: "e2", employeeName: "Kartik Das", fromDate: "2026-08-20", toDate: "2026-08-20", reason: "Travel", status: "pending" },
];

describe("WfhPage (/hr/wfh)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getEmployeesMock.mockReset();
    getMyProfileMock.mockReset();
    mockRoles = ["employee"];
  });

  it("is reachable by the employee role and renders a real create form, not a permission wall", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" }); // 403 for `employee`, normalized to empty
    getMyProfileMock.mockResolvedValue({ data: { id: "emp-self", name: "Self Employee", department: "IT", employeeNo: "E-1", status: "active", designation: "Officer" }, source: "api" });

    await render(WfhPage());

    expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: /work from home request form/i })).toBeInTheDocument();
    // Self-service: the employee picker is hidden entirely (prefilled to "me").
    expect(screen.queryByLabelText(/employee id/i)).not.toBeInTheDocument();
  });

  // GAP-HR-WORKFORCE-WFH-NEW-01: /hr/workforce/wfh/new redirects here with a
  // "#new-request" fragment so a visitor following a "/new" link lands
  // scrolled to the form, not just the top of the list page -- this anchor
  // element is what that fragment targets.
  it("wraps the New Request card in an #new-request anchor target", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getMyProfileMock.mockResolvedValue({ data: { id: "emp-self", name: "Self Employee", department: "IT", employeeNo: "E-1", status: "active", designation: "Officer" }, source: "api" });

    const { container } = await render(WfhPage());

    const anchor = container.querySelector("#new-request");
    expect(anchor).not.toBeNull();
    expect(anchor?.querySelector("form")).not.toBeNull();
  });

  it("shows a clear message instead of a broken form for an employee with no linked profile", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });

    await render(WfhPage());

    expect(screen.queryByRole("form", { name: /work from home request form/i })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/no employee record/i);
  });

  it("gives hr_admin the employee picker (file on behalf of)", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({
      data: [{ id: "e1", name: "Sunita Rao", department: "Finance", status: "active" }],
      source: "api",
    });

    await render(WfhPage());

    expect(getMyProfileMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
  });

  it("does not show Approve/Reject controls for a plain employee", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getMyProfileMock.mockResolvedValue({ data: { id: "e2", name: "Kartik Das", department: "IT", employeeNo: "E-2", status: "active", designation: "Officer" }, source: "api" });

    await render(WfhPage());

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it("shows Approve/Reject controls for a pending request to a manager", async () => {
    mockRoles = ["manager"];
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    getEmployeesMock.mockResolvedValue({
      data: [{ id: "e1", name: "Sunita Rao", department: "Finance", status: "active" }],
      source: "api",
    });

    await render(WfhPage());

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  // GAP-HR-WFH-01: the weekly-cap banner is driven by the figure the SERVER
  // enforces (GET /v1/hrms/wfh-eligibility -- days used in the ISO week), not by
  // a second copy of the rule computed here from the request rows. The old page
  // counted ROWS whose fromDate fell in the week, so one Mon-Fri request counted
  // as 1 and a Mon-Tue request as 1 too.
  describe("weekly-cap banner comes from the server's day count (GAP-HR-WFH-01)", () => {
    afterEach(() => vi.unstubAllGlobals());

    function stubEligibility(weeklyWfhCount: number) {
      vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        String(url).includes("/wfh-eligibility")
          ? new Response(JSON.stringify({ payLevel: 8, maxPayLevel: 9, enforceGazettedExclusion: true, weeklyWfhCount, weeklyCap: 2 }), { status: 200 })
          : new Response("{}", { status: 404 }),
      ));
    }
    function selfService() {
      fetchJsonMock.mockResolvedValue({
        data: [{ id: "w1", employeeId: "emp-self", employeeName: "Self Employee", fromDate: "2026-08-17", toDate: "2026-08-17", reason: "WFH 1", status: "approved" }],
        source: "api",
      });
      getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
      getMyProfileMock.mockResolvedValue({ data: { id: "emp-self", name: "Self Employee", department: "IT", employeeNo: "E-1", status: "active", designation: "Officer" }, source: "api" });
    }

    it("shows the cap banner and disables submit when the server reports the weekly limit used", async () => {
      selfService();
      stubEligibility(2);
      await render(WfhPage());
      expect(await screen.findByTestId("weekly-cap-error")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    });

    it("does not infer the cap from the number of rows: one request on file + server says 1 day used -> no banner", async () => {
      selfService();
      stubEligibility(1);
      await render(WfhPage());
      await waitFor(() => expect(screen.queryByTestId("paylevel-warning")).toBeNull());
      expect(screen.queryByTestId("weekly-cap-error")).toBeNull();
      expect(screen.getByRole("button", { name: /submit request/i })).not.toBeDisabled();
    });
  });

  // GAP-HR-WFH-02: POST /v1/hrms/wfh-requests allows HR staff + employee only.
  // A manager-only session used to be shown the roster picker and a form whose
  // submit could only ever answer 403.
  describe("who is shown the filing form (GAP-HR-WFH-02)", () => {
    it("a manager-only session sees NO form -- an explanation -- but keeps Approve/Reject", async () => {
      mockRoles = ["manager"];
      fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
      getEmployeesMock.mockResolvedValue({ data: [{ id: "e1", name: "Sunita Rao", department: "Finance", status: "active" }], source: "api" });

      await render(WfhPage());

      expect(screen.queryByRole("form", { name: /work from home request form/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/employee id/i)).not.toBeInTheDocument();
      expect(screen.getByRole("note")).toHaveTextContent(/filed by the employee or by HR/i);
      expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
      // No roster / profile lookups are made for a role that cannot file.
      expect(getEmployeesMock).not.toHaveBeenCalled();
      expect(getMyProfileMock).not.toHaveBeenCalled();
    });

    it("a manager who is ALSO an employee files for themselves only: prefilled own profile, no roster picker", async () => {
      mockRoles = ["manager", "employee"];
      fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
      // The manager roster would load fine -- but the server pins non-HR filers to themselves, so it must not be offered.
      getEmployeesMock.mockResolvedValue({ data: [{ id: "e1", name: "Sunita Rao", department: "Finance", status: "active" }], source: "api" });
      getMyProfileMock.mockResolvedValue({ data: { id: "emp-self", name: "Self Manager", department: "IT", employeeNo: "E-9", status: "active", designation: "Officer" }, source: "api" });

      await render(WfhPage());

      expect(screen.getByRole("form", { name: /work from home request form/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/employee id/i)).not.toBeInTheDocument();
      expect(getMyProfileMock).toHaveBeenCalled();
      expect(getEmployeesMock).not.toHaveBeenCalled();
    });

    it("hr_officer and super_admin (the other backend HR_ROLES) get the form with the picker", async () => {
      for (const role of ["hr_officer", "super_admin"]) {
        mockRoles = [role];
        fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
        getEmployeesMock.mockResolvedValue({ data: [{ id: "e1", name: "Sunita Rao", department: "Finance", status: "active" }], source: "api" });
        const { unmount } = await render(WfhPage());
        expect(screen.getByRole("form", { name: /work from home request form/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
        unmount();
      }
    });
  });

  // GAP-HR-WFH-06: a failed load must read as "unknown" (em dash), not as a
  // fabricated 0 -- all four stat cards, matching sibling pages.
  it("GAP-HR-WFH-06: when the list fails to load every stat card shows the unknown dash, not 0", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getMyProfileMock.mockResolvedValue({ data: { id: "emp-self", name: "Self Employee", department: "IT", employeeNo: "E-1", status: "active", designation: "Officer" }, source: "api" });

    const { container } = await render(WfhPage());

    const values = [...container.querySelectorAll(".stat .val")].map((el) => el.textContent);
    expect(values).toEqual(["—", "—", "—", "—"]);
  });

  it("GAP-HR-WFH-06: with data, the stat cards show the real counts (0 is a real 0 there)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getMyProfileMock.mockResolvedValue({ data: { id: "emp-self", name: "Self Employee", department: "IT", employeeNo: "E-1", status: "active", designation: "Officer" }, source: "api" });

    const { container } = await render(WfhPage());

    const values = [...container.querySelectorAll(".stat .val")].map((el) => el.textContent);
    expect(values).toEqual(["0", "0", "0", "0"]);
  });
});
