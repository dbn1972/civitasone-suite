import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking convention as hr/disciplinary/page.test.tsx: control the
// session role directly at the roleGuard module boundary.
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import GrievancePage from "./page";

const COUNTS = { total: 5, open: 2, underInquiry: 2, disposed: 1 };
const ROW = {
  id: "11111111-1111-1111-1111-111111111111", caseNo: "GRV/2026/0001", employee: "A. Kumar",
  department: "Revenue", category: "facilities", filedDate: "2026-01-01", assignedToName: null, status: "registered",
};

describe("GrievancePage (real register)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  // GAP-HR-GRIEVANCE-04/05: role gate before any fetch.
  it("shows permission-denied for a role the backend would reject, and never fetches", async () => {
    mockRoles = ["employee"];
    render(await GrievancePage({}));
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // GAP-HR-GRIEVANCE-03: the Ref column is the stored GRV/YYYY/NNNN, never a UUID slice.
  it("renders the stored case number, links the row to its detail page, and shows the coarse category", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [ROW], total: 1, counts: COUNTS }, source: "api" });
    render(await GrievancePage({}));
    expect(screen.getByText("GRV/2026/0001")).toBeInTheDocument();
    expect(screen.queryByText("11111111")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GRV\/2026\/0001|A\. Kumar|Open/ })).toHaveAttribute("href", "/hr/grievance/11111111-1111-1111-1111-111111111111");
    expect(screen.getByText("Facilities")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  // GAP-HR-GRIEVANCE-02: a Register action exists for HR roles.
  it("offers a Register grievance action", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [], total: 0, counts: { total: 0, open: 0, underInquiry: 0, disposed: 0 } }, source: "api" });
    render(await GrievancePage({}));
    expect(screen.getByRole("link", { name: "Register grievance" })).toHaveAttribute("href", "/hr/grievance/new");
  });

  // GAP-HR-GRIEVANCE-06: stat cards come from the server's whole-register
  // counts and reconcile to Total; the list request is bounded + offset.
  it("shows the server's counts (not the page's rows) in the stat cards", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [ROW], total: 5, counts: COUNTS }, source: "api" });
    render(await GrievancePage({}));
    const val = (label: string) =>
      Array.from(document.querySelectorAll(".stat")).find((el) => el.textContent?.includes(label))?.querySelector(".val")?.textContent;
    expect(val("Total Cases")).toBe("5");
    expect(val("Open")).toBe("2");
    expect(val("Under Inquiry")).toBe("2");
    expect(val("Disposed")).toBe("1");
    expect(Number(val("Open")) + Number(val("Under Inquiry")) + Number(val("Disposed"))).toBe(Number(val("Total Cases")));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("limit=50&offset=0");
  });

  it("steps to the next server batch via ?page=", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [ROW], total: 120, counts: COUNTS }, source: "api" });
    render(await GrievancePage({ searchParams: { page: "2" } }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("offset=50");
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/hr/grievance?page=1");
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/hr/grievance?page=3");
  });

  it("shows permission-denied (not a generic retry) for a live 403, via LoadErrorState, with dash stat cards", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [], total: 0, counts: { total: 0, open: 0, underInquiry: 0, disposed: 0 } },
      source: "error", status: 403, errorMessage: undefined,
    });
    render(await GrievancePage({}));
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
