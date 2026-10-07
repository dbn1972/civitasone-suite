import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import IndentsPage from "./page";

// Capture the path the loader fetched so we can assert the offset/limit the
// page passed through for server paging (GAP-PROCUREMENT-INDENTS-01).
let lastPath = "";
function route(payload: unknown, source: "api" | "error" = "api") {
  lastPath = "";
  fetchJsonMock.mockImplementation(
    (path: unknown, _empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
      lastPath = typeof path === "string" ? path : "";
      const mapped = options?.mapResponse ? options.mapResponse(payload) : payload;
      return Promise.resolve({ data: source === "error" ? [] : mapped, source });
    },
  );
}

function indent(over: Record<string, unknown>) {
  return {
    id: over.id ?? "ind-x",
    indentNo: over.indentNo ?? "IND-X",
    requestedBy: over.requestedBy ?? "Ram Kumar",
    department: over.department ?? "IT",
    itemCount: 1,
    totalMinor: 100000,
    indentDate: "2026-09-01",
    status: over.status ?? "pending",
    ...over,
  };
}

describe("IndentsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("INDENTS-02: on a failed load, stats read '—' (not 0) and a retry is offered", async () => {
    route({}, "error");
    render(await IndentsPage({ searchParams: {} }));
    expect(screen.getByText("Pending Approval").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Tender Required").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Approved").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("INDENTS-02: a genuine empty (non-error) still shows 0 and the empty state", async () => {
    route({ data: [] });
    render(await IndentsPage({ searchParams: {} }));
    expect(screen.getByText("Pending Approval").closest(".stat")).toHaveTextContent("0");
    expect(screen.getByText("No indents yet")).toBeInTheDocument();
  });

  it("INDENTS-03: a tender_required indent is counted in a visible 'Tender Required' stat", async () => {
    route({ data: [indent({ id: "a", status: "tender_required" }), indent({ id: "b", status: "tender_required" })] });
    const { container } = render(await IndentsPage({ searchParams: {} }));
    // Scope to the stat tile (the DataTable status cell also reads "Tender Required").
    const statLabel = Array.from(container.querySelectorAll(".stat .lab")).find((el) => el.textContent === "Tender Required");
    expect(statLabel).toBeTruthy();
    expect(statLabel!.closest(".stat")).toHaveTextContent("2");
  });

  it("INDENTS-01: a full page shows a truncation notice and a Next link", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => indent({ id: `i${i}`, indentNo: `IND-${i}` }));
    route({ data: rows });
    render(await IndentsPage({ searchParams: {} }));
    expect(screen.getByText(/Showing the first 100 indents/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/i })).toHaveAttribute("href", "/procurement/indents?page=2");
  });

  it("INDENTS-01: page 2 passes offset=100 to the loader", async () => {
    route({ data: [indent({ id: "p2" })] });
    render(await IndentsPage({ searchParams: { page: "2" } }));
    expect(lastPath).toContain("offset=100");
    expect(lastPath).toContain("limit=100");
  });

  it("INDENTS-04: a UUID-shaped requestedBy renders '—', never the raw UUID", async () => {
    const uuid = "00000000-1111-4000-8000-000000000002";
    route({ data: [indent({ id: "u1", indentNo: "IND-U1", requestedBy: uuid })] });
    render(await IndentsPage({ searchParams: {} }));
    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
  });
});
