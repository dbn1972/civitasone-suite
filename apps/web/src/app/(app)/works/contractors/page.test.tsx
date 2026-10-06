import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Captures the url + raw payload per call; applies the real `mapResponse` the
// page passes (the production fetchJson maps the API body before returning),
// so these tests exercise mapContractors (masking, numeric rating) end to end.
const fetchCalls: Array<{ url: string; payload: unknown; result: Record<string, unknown> }> = [];
let nextResult: { payload?: unknown; source: string; status?: number } = { payload: [], source: "api" };
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (url: string, empty: unknown, opts: { mapResponse?: (p: unknown) => unknown }) => {
    const { payload, source, status } = nextResult;
    const data = source === "error" ? empty : opts.mapResponse ? opts.mapResponse(payload) ?? empty : payload;
    const result = { data, source, ...(status ? { status } : {}) };
    fetchCalls.push({ url, payload, result });
    return Promise.resolve(result);
  },
}));

const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ContractorsPage from "./page";

const ID = "11111111-2222-4000-8000-000000000001";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: "ABC Constructions",
    registrationNo: "PWD/A/2024/001",
    pan: "AAAPZ1234C",
    phone: "9876543210",
    performanceRating: 4.5,
    ratingCount: 3,
    active: true,
    ...overrides,
  };
}

describe("ContractorsPage", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    nextResult = { payload: [], source: "api" };
    rolesMock.mockReset();
    rolesMock.mockReturnValue([]);
  });

  // GAP-WORKS-CONTRACTORS-03: request an explicit pageSize so stats aren't
  // computed off a silent partial first page.
  it("requests the contractor list with pageSize=100", async () => {
    nextResult = { payload: [row()], source: "api" };
    rolesMock.mockReturnValue(["works_admin"]);
    render(await ContractorsPage());
    expect(fetchCalls[0].url).toContain("pageSize=100");
  });

  // GAP-WORKS-CONTRACTORS-01: the Name cell links to the detail page.
  it("links each contractor row's name to /works/contractors/<id>", async () => {
    nextResult = { payload: [row()], source: "api" };
    render(await ContractorsPage());
    const link = screen.getByRole("link", { name: /Open ABC Constructions/i });
    expect(link).toHaveAttribute("href", `/works/contractors/${ID}`);
  });

  // GAP-WORKS-CONTRACTORS-02 (PII): the full PAN/phone never reach the list DOM.
  it("masks PAN and phone in the register", async () => {
    nextResult = { payload: [row()], source: "api" };
    render(await ContractorsPage());
    expect(document.body.textContent).not.toContain("AAAPZ1234C");
    expect(document.body.textContent).not.toContain("9876543210");
    expect(screen.getByText("AAAPZ****C")).toBeInTheDocument();
  });

  // GAP-WORKS-CONTRACTORS-04: rating is numeric (sorts correctly) and status is a pill.
  it("renders a coloured status pill and a numeric rating column", async () => {
    nextResult = {
      payload: [
        row({ id: "a", name: "Alpha", performanceRating: 4, ratingCount: 2 }),
        row({ id: "b", name: "Beta", performanceRating: 5, ratingCount: 1 }),
        row({ id: "c", name: "Gamma", performanceRating: null, ratingCount: 0, active: false }),
      ],
      source: "api",
    };
    render(await ContractorsPage());
    const table = within(screen.getByRole("table"));
    expect(table.getByText("4")).toBeInTheDocument();
    expect(table.getByText("5")).toBeInTheDocument();
    // Status cellType renders a coloured pill, not the raw "active"/"inactive" literal.
    expect(table.getAllByText("Active").length).toBeGreaterThan(0);
    expect(table.getByText("Inactive")).toBeInTheDocument();
    expect(document.querySelector(".pill.good")).toBeTruthy();
    expect(document.querySelector(".pill.mut")).toBeTruthy();
  });

  // GAP-WORKS-CONTRACTORS-03 (FAILMASK): error state, not a zeroed empty register.
  it("renders a load error (with retry) instead of a zeroed empty register on fetch error", async () => {
    nextResult = { source: "error", status: 500 };
    render(await ContractorsPage());
    expect(screen.queryByText("No contractors registered")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
  });

  // GAP-WORKS-CONTRACTORS-05 (ROLEGATE): Register button only for write roles.
  it("hides the Register button for a read-only role and shows it for works_admin", async () => {
    nextResult = { payload: [row()], source: "api" };

    rolesMock.mockReturnValue(["works_viewer"]);
    const { unmount } = render(await ContractorsPage());
    expect(screen.queryByRole("link", { name: /Register contractor/i })).not.toBeInTheDocument();
    unmount();

    rolesMock.mockReturnValue(["works_admin"]);
    render(await ContractorsPage());
    expect(screen.getByRole("link", { name: /Register contractor/i })).toHaveAttribute(
      "href",
      "/works/contractors/new",
    );
  });
});
