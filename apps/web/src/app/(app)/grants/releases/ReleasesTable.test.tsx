import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: <T,>(_key: string, initialData: T) => ({
    data: initialData,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { ReleasesTable } from "./ReleasesTable";
import type { GrantRelease } from "@civitasone/types";

const ROW: GrantRelease = {
  id: "rel-1",
  releaseNo: "REL-2026-09",
  grantNo: "GR-2026-04",
  granteeName: "District Panchayat, Nashik",
  amount: 15000000, // paise on the wire (₹1,50,000.00) — money is bigint paise end to end
  releaseDate: "2026-10-01",
  bankRef: undefined,
  status: "pending",
} as unknown as GrantRelease;

describe("ReleasesTable", () => {
  // GAP-GRANTS-RELEASES-02: the Approve action is hidden by default (no backend
  // endpoint) — never a button that fakes a money-release approval.
  it("does not render an Approve button when the feature is disabled", () => {
    render(<ReleasesTable releases={[ROW]} source="api" canApprove={true} />);
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  // GAP-GRANTS-RELEASES-04: rows link to the disbursement detail route.
  it("links rows to /grants/disbursements/{id}", () => {
    render(<ReleasesTable releases={[ROW]} source="api" />);
    const link = screen.getByRole("link", { name: /Open REL-2026-09/ });
    expect(link).toHaveAttribute("href", "/grants/disbursements/rel-1");
  });

  // GAP-GRANTS-RELEASES-03 / DISBURSEMENTS-DETAIL-02 (money unit): amount is
  // MINOR units (paise) on the wire and rendered with formatMoney, matching the
  // disbursement detail page. 15000000 paise => ₹1,50,000.00; it must NOT be
  // treated as rupees (which would 100x it to ₹1,50,00,000.00).
  it("renders the amount from paise, matching the detail page", () => {
    render(<ReleasesTable releases={[ROW]} source="api" />);
    expect(screen.getByText("₹1,50,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹1,50,00,000.00")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-RELEASES-06: a pending release shows "Awaiting bank ref", not a bare "—".
  it("shows 'Awaiting bank ref' for a pending release with no bank ref", () => {
    render(<ReleasesTable releases={[ROW]} source="api" />);
    expect(screen.getByText("Awaiting bank ref")).toBeInTheDocument();
  });
});

// The Approve column is feature-flagged (NEXT_PUBLIC_GRANTS_RELEASE_APPROVE is
// read at module load). Re-import the table with the flag on so the retained
// approve + clerk-safe-error paths stay guarded.
describe("ReleasesTable with the approve flag on", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_GRANTS_RELEASE_APPROVE", "1");
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function openApproveDialog() {
    const { ReleasesTable: Flagged } = await import("./ReleasesTable");
    render(<Flagged releases={[ROW]} source="api" canApprove={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText(/Approve release REL-2026-09\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Approval reference \/ reason/), { target: { value: "GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve release" }));
  }

  it("approves a pending release against the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await openApproveDialog();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/releases/rel-1/approve");
  });

  // UX-016: never show the raw server text, only the catalogued clerk-safe copy.
  it("shows a clerk-safe error, not the raw server text, when the approval fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("route not implemented", { status: 404 }));
    await openApproveDialog();
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("route not implemented")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
