import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PackLibraryClient } from "./PackLibraryClient";
import type { DomainPackRow } from "../_data/designerLoader";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const domain: DomainPackRow = {
  id: "d1",
  domainPackKey: "municipal-in-v1",
  name: "Municipal India v1",
  sector: "municipal",
  jurisdiction: "IN",
  version: 1,
  packCount: 2,
};

const okPack = {
  id: "p1",
  packKey: "pack:tl",
  domainPackKey: "municipal-in-v1",
  name: "Trade License",
  servicePattern: "certificate",
  feeModel: "flat",
  hoaCode: "4201",
  statutoryReferences: [],
  manifest: {},
  version: 1,
  status: "published",
};

function stubFetch(opts: { ok?: boolean; status?: number; data?: unknown[] }) {
  const { ok = true, status = 200, data = [] } = opts;
  return vi.fn(async () =>
    ({
      ok,
      status,
      json: async () => ({ data }),
    }) as Response,
  );
}

describe("PackLibraryClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch({ ok: true, data: [okPack] }));
  });

  afterEach(() => vi.unstubAllGlobals());

  // GAP-DESIGNER-LIBRARY-01: 500 response renders error, not "No packs match".
  it("renders error state when fetch returns 500", async () => {
    vi.stubGlobal("fetch", stubFetch({ ok: false, status: 500 }));
    render(<PackLibraryClient domainPacks={[domain]} />);

    await waitFor(() =>
      expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No packs match/)).not.toBeInTheDocument();
  });

  // GAP-DESIGNER-LIBRARY-01: network reject ends loading state.
  it("renders error state when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<PackLibraryClient domainPacks={[domain]} />);

    await waitFor(() =>
      expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument(),
    );
    // Loading text should have disappeared.
    expect(screen.queryByText("Loading packs…")).not.toBeInTheDocument();
  });

  // GAP-DESIGNER-LIBRARY-01: retry button refetches packs.
  it("shows Try again button on error that refetches when clicked", async () => {
    const failFetch = stubFetch({ ok: false, status: 500 });
    vi.stubGlobal("fetch", failFetch);
    render(<PackLibraryClient domainPacks={[domain]} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument());

    // Now stub success and click retry.
    vi.stubGlobal("fetch", stubFetch({ ok: true, data: [okPack] }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Trade License")).toBeInTheDocument());
    expect(screen.queryByText(/couldn.t load/)).not.toBeInTheDocument();
  });

  // GAP-DESIGNER-LIBRARY-04: Clear filters and result count.
  it("shows result count and Clear filters button", async () => {
    render(<PackLibraryClient domainPacks={[domain]} />);

    await waitFor(() => expect(screen.getByText("Trade License")).toBeInTheDocument());
    expect(screen.getByText(/1 of 1 pack/)).toBeInTheDocument();

    // No Clear filters when filters are all "all".
    expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();
  });

  it("shows Clear filters when a filter is active and clears on click", async () => {
    render(<PackLibraryClient domainPacks={[domain]} />);

    await waitFor(() => expect(screen.getByText("Trade License")).toBeInTheDocument());

    // Change sector filter
    const sectorSelect = screen.getByLabelText("Sector");
    fireEvent.change(sectorSelect, { target: { value: "municipal" } });

    expect(screen.getByText("Clear filters")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear filters"));

    // After clear, the Clear button should disappear.
    expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();
  });

  // GAP-DESIGNER-LIBRARY-05: domain-packs-failed notice.
  it("shows domain-packs-failed notice when prop is true", async () => {
    render(<PackLibraryClient domainPacks={[]} domainPacksFailed />);

    await waitFor(() =>
      expect(screen.getByText(/domain pack details/i)).toBeInTheDocument(),
    );
  });

  // GAP-DESIGNER-LIBRARY-02: preview uses dialog role (Modal).
  it("preview opens in a dialog with aria-modal", async () => {
    render(<PackLibraryClient domainPacks={[domain]} />);

    await waitFor(() => expect(screen.getByText("Trade License")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import as draft" })).toBeInTheDocument();
  });
});
