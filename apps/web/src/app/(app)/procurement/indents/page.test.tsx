import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import IndentsPage from "./page";
import { PENDING_INDENT_STATUSES } from "../drillThrough";

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
    render(await IndentsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Pending Approval").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Tender Required").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Approved").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("INDENTS-02: a genuine empty (non-error) still shows 0 and the empty state", async () => {
    route({ data: [] });
    render(await IndentsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Pending Approval").closest(".stat")).toHaveTextContent("0");
    expect(screen.getByText("No indents yet")).toBeInTheDocument();
  });

  it("INDENTS-03: a tender_required indent is counted in a visible 'Tender Required' stat", async () => {
    route({ data: [indent({ id: "a", status: "tender_required" }), indent({ id: "b", status: "tender_required" })] });
    const { container } = render(await IndentsPage({ searchParams: Promise.resolve({}) }));
    // Scope to the stat tile (the DataTable status cell also reads "Tender Required").
    const statLabel = Array.from(container.querySelectorAll(".stat .lab")).find((el) => el.textContent === "Tender Required");
    expect(statLabel).toBeTruthy();
    expect(statLabel!.closest(".stat")).toHaveTextContent("2");
  });

  it("INDENTS-01: a full page shows a truncation notice and a Next link", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => indent({ id: `i${i}`, indentNo: `IND-${i}` }));
    route({ data: rows });
    render(await IndentsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/Showing the first 100 indents/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/i })).toHaveAttribute("href", "/procurement/indents?page=2");
  });

  it("INDENTS-01: page 2 passes offset=100 to the loader", async () => {
    route({ data: [indent({ id: "p2" })] });
    render(await IndentsPage({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(lastPath).toContain("offset=100");
    expect(lastPath).toContain("limit=100");
  });

  it("INDENTS-04: a UUID-shaped requestedBy renders '—', never the raw UUID", async () => {
    const uuid = "00000000-1111-4000-8000-000000000002";
    route({ data: [indent({ id: "u1", indentNo: "IND-U1", requestedBy: uuid })] });
    render(await IndentsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
  });
});

describe("IndentsPage status drill-through (GAP-PROCUREMENT-DASHBOARD-02)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  const mixed = () => ({
    data: [
      indent({ id: "d", indentNo: "IND-DRAFT", status: "draft" }),
      indent({ id: "p", indentNo: "IND-PENDING", status: "pending" }),
      indent({ id: "a", indentNo: "IND-APPROVED", status: "approved" }),
      indent({ id: "t", indentNo: "IND-TENDER", status: "tender_required" }),
    ],
  });

  it("the dashboard's 'Pending Indents' filter (draft + pending) lists exactly those indents", async () => {
    route(mixed());
    render(await IndentsPage({ searchParams: Promise.resolve({ status: PENDING_INDENT_STATUSES.join(",") }) }));
    expect(screen.getByText("IND-DRAFT")).toBeInTheDocument();
    expect(screen.getByText("IND-PENDING")).toBeInTheDocument();
    expect(screen.queryByText("IND-APPROVED")).not.toBeInTheDocument();
    expect(screen.queryByText("IND-TENDER")).not.toBeInTheDocument();
    expect(screen.queryByText("No indents in this status")).not.toBeInTheDocument();
    expect(screen.getByText("Indents — Draft, Pending Approval")).toBeInTheDocument();
  });

  it("the raw service status 'pending' (older links) means Pending Approval, not an empty list", async () => {
    route(mixed());
    render(await IndentsPage({ searchParams: Promise.resolve({ status: "pending" }) }));
    expect(screen.getByText("IND-PENDING")).toBeInTheDocument();
    expect(screen.queryByText("IND-DRAFT")).not.toBeInTheDocument();
    expect(screen.queryByText("No indents in this status")).not.toBeInTheDocument();
  });

  it("a single status still filters as before, and an unknown status says so", async () => {
    route(mixed());
    const { unmount } = render(await IndentsPage({ searchParams: Promise.resolve({ status: "tender_required" }) }));
    expect(screen.getByText("IND-TENDER")).toBeInTheDocument();
    expect(screen.queryByText("IND-DRAFT")).not.toBeInTheDocument();
    unmount();

    route(mixed());
    render(await IndentsPage({ searchParams: Promise.resolve({ status: "no_such_status" }) }));
    expect(screen.getByText("No indents in this status")).toBeInTheDocument();
  });
});

// GAP-PROCUREMENT-DASHBOARD-02 (rework): the status filter must be applied by the
// server BEFORE paging. This fake service honours status/limit/offset the way
// procurement-service does (raw statuses, SQL filter, then page), so a filter
// applied only to the one fetched page would be caught here.
describe("IndentsPage status drill-through across pages (GAP-PROCUREMENT-DASHBOARD-02)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  let paths: string[] = [];
  function serverRoute(all: Array<Record<string, unknown>>) {
    paths = [];
    fetchJsonMock.mockImplementation(
      (path: unknown, _empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
        const url = new URL(String(path), "http://service.test");
        paths.push(String(path));
        const wanted = url.searchParams.get("status")?.split(",") ?? null;
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const matching = wanted ? all.filter((r) => wanted.includes(String(r.status))) : all;
        const payload = { data: matching.slice(offset, offset + limit) };
        return Promise.resolve({ data: options?.mapResponse ? options.mapResponse(payload) : payload, source: "api" });
      },
    );
  }

  // 120 approved indents sort first; the 6 draft/pending ones sit past the first 100.
  const tenant = () => [
    ...Array.from({ length: 120 }, (_, i) => indent({ id: `a${i}`, indentNo: `IND-A${String(i).padStart(3, "0")}`, status: "approved" })),
    indent({ id: "d1", indentNo: "IND-Z-DRAFT-1", status: "draft" }),
    indent({ id: "d2", indentNo: "IND-Z-DRAFT-2", status: "draft" }),
    indent({ id: "d3", indentNo: "IND-Z-DRAFT-3", status: "draft" }),
    indent({ id: "p1", indentNo: "IND-Z-PENDING-1", status: "pending" }),
    indent({ id: "p2", indentNo: "IND-Z-PENDING-2", status: "pending" }),
    indent({ id: "p3", indentNo: "IND-Z-PENDING-3", status: "pending" }),
  ];

  it("lists the draft and pending indents even when none is on the first unfiltered page", async () => {
    serverRoute(tenant());
    render(await IndentsPage({ searchParams: Promise.resolve({ status: PENDING_INDENT_STATUSES.join(",") }) }));
    for (const no of ["IND-Z-DRAFT-1", "IND-Z-DRAFT-2", "IND-Z-DRAFT-3", "IND-Z-PENDING-1", "IND-Z-PENDING-2", "IND-Z-PENDING-3"]) {
      expect(screen.getByText(no)).toBeInTheDocument();
    }
    expect(screen.queryByText("No indents in this status")).not.toBeInTheDocument();
    // The list was asked for the raw service statuses, first page of the FILTERED set.
    const listed = paths.find((p) => p.includes("status="));
    expect(listed).toBeDefined();
    expect(new URL(listed!, "http://service.test").searchParams.get("status")).toBe("draft,pending");
    expect(listed).toContain("limit=100");
    expect(listed).toContain("offset=0");
  });

  it("keeps the stat tiles on the unfiltered page rather than zeroing them under a filter", async () => {
    serverRoute(tenant());
    const { container } = render(await IndentsPage({ searchParams: Promise.resolve({ status: PENDING_INDENT_STATUSES.join(",") }) }));
    const tile = (label: string) => Array.from(container.querySelectorAll(".stat .lab")).find((el) => el.textContent === label)!.closest(".stat");
    expect(tile("Approved")).toHaveTextContent("100");
    expect(tile("On this page")).toHaveTextContent("100");
    expect(paths.some((p) => !p.includes("status="))).toBe(true);
  });

  it("sends the service's own status for a list status (pending_approval is pending)", async () => {
    serverRoute(tenant());
    render(await IndentsPage({ searchParams: Promise.resolve({ status: "pending_approval" }) }));
    expect(screen.getByText("IND-Z-PENDING-1")).toBeInTheDocument();
    expect(screen.queryByText("IND-Z-DRAFT-1")).not.toBeInTheDocument();
    const listed = paths.find((p) => p.includes("status="))!;
    expect(new URL(listed, "http://service.test").searchParams.get("status")).toBe("pending");
  });

  it("makes one request when there is no filter", async () => {
    serverRoute(tenant());
    render(await IndentsPage({ searchParams: Promise.resolve({}) }));
    expect(paths).toHaveLength(1);
    expect(paths[0]).not.toContain("status=");
  });

  it("a full filtered page offers Next, carrying the filter", async () => {
    serverRoute(Array.from({ length: 130 }, (_, i) => indent({ id: `d${i}`, indentNo: `IND-D${String(i).padStart(3, "0")}`, status: "draft" })));
    render(await IndentsPage({ searchParams: Promise.resolve({ status: "draft" }) }));
    expect(screen.getByRole("link", { name: /Next/i })).toHaveAttribute("href", "/procurement/indents?status=draft&page=2");
  });

  it("an empty page past the end of a filtered list still offers a way back", async () => {
    serverRoute(tenant());
    render(await IndentsPage({ searchParams: Promise.resolve({ status: PENDING_INDENT_STATUSES.join(","), page: "2" }) }));
    expect(screen.getByText("No indents on this page")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Indent pages" });
    expect(nav).toHaveTextContent("Page 2");
    expect(screen.getByRole("link", { name: /Previous/i })).toHaveAttribute(
      "href",
      "/procurement/indents?status=draft%2Cpending_approval",
    );
    expect(screen.queryByRole("link", { name: /Next/i })).not.toBeInTheDocument();
  });

  it("an empty first page has no pager, just the clear-filter way out", async () => {
    serverRoute(tenant());
    render(await IndentsPage({ searchParams: Promise.resolve({ status: "rejected" }) }));
    expect(screen.getByText("No indents in this status")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Indent pages" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filter" })).toBeInTheDocument();
  });
});
