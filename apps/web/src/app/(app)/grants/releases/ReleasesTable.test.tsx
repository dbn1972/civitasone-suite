import { describe, it, expect, vi, beforeEach } from "vitest";
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
  amount: "500000",
  releaseDate: "2026-10-01",
  bankRef: null,
  status: "pending",
} as unknown as GrantRelease;

describe("ReleasesTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("approves a pending release against the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<ReleasesTable releases={[ROW]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText(/Approve release REL-2026-09\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Approval reference \/ reason/), { target: { value: "GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve release" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/releases/rel-1/approve");
  });

  // UX-016: postAction used to build the error from `Action failed
  // (${status}). ${rawResponseText}` verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, when the approval fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("route not implemented", { status: 404 }));

    render(<ReleasesTable releases={[ROW]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText(/Approve release REL-2026-09\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Approval reference \/ reason/), { target: { value: "GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve release" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("route not implemented")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
