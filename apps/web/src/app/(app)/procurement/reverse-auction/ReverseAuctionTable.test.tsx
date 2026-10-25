import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { ReverseAuctionTable } from "./ReverseAuctionTable";
import type { ReverseAuction } from "../../../_data/loaders";

const mockedHook = vi.mocked(useSeededResource);

type Prov = "live" | "cached" | "error-no-data";
function seed(data: ReverseAuction[], provenance: Prov) {
  mockedHook.mockReturnValue({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  } as unknown as ReturnType<typeof useSeededResource>);
}

const AID = "aaaa1111-2222-4000-8000-000000000001";
const ROWS: ReverseAuction[] = [
  {
    id: AID, auctionNo: "AUC/2026/001", indentRef: "IND-01", item: "Laptops",
    startPrice: 1844.5, currentLowest: 1500,
    startPriceMinor: "18450050", currentLowestMinor: "15000000", savingsMinor: "3450050",
    bidders: 3, timeRemaining: "", endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(), status: "Live",
  },
];

describe("ReverseAuctionTable (GAP-PROCUREMENT-REVERSE-AUCTION-01/02/03/05)", () => {
  beforeEach(() => {
    mockedHook.mockReset();
    pushMock.mockReset();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: ROWS }), { status: 200 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders paise-exact money with 2 decimals (not ₹1,84,500.5) and a savings column", () => {
    seed(ROWS, "live");
    render(<ReverseAuctionTable auctions={ROWS} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("₹1,84,500.50")).toBeInTheDocument();
    expect(within(table).getByText("₹1,50,000.00")).toBeInTheDocument();
    // savings 3450050 paise → ₹34,500.50
    expect(within(table).getByText("₹34,500.50")).toBeInTheDocument();
  });

  it("shows a Total Savings tile (BigInt sum) and a non-money Total Events count", () => {
    seed(ROWS, "live");
    render(<ReverseAuctionTable auctions={ROWS} source="api" />);
    expect(screen.getByText("Total Savings").closest(".stat")).toHaveTextContent("₹34,500.50");
    expect(screen.getByText("Total Events").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Live Auctions").closest(".stat")).toHaveTextContent("1");
  });

  it("links a row to the auction detail using the auction id", () => {
    seed(ROWS, "live");
    render(<ReverseAuctionTable auctions={ROWS} source="api" />);
    const link = screen.getByRole("link", { name: /Open AUC\/2026\/001/i });
    expect(link).toHaveAttribute("href", `/procurement/reverse-auction/${AID}`);
  });

  it("renders a live countdown derived from endsAt (not the empty server string)", () => {
    seed(ROWS, "live");
    render(<ReverseAuctionTable auctions={ROWS} source="api" />);
    // ~2h remaining → "1h 59m .." or "2h 0m .."; assert an hour+minute shape.
    expect(screen.getByRole("table").textContent).toMatch(/\dh \d+m/);
  });

  it("on error with no cache shows a retry error and '—' tiles, never 'No auctions found'", () => {
    seed([], "error-no-data");
    render(<ReverseAuctionTable auctions={[]} source="error" />);
    expect(screen.queryByText(/No auctions found/i)).not.toBeInTheDocument();
    expect(screen.getByText("Total Savings").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});

describe("ReverseAuctionTable live refresh ordering (CLOS3-S3-12)", () => {
  beforeEach(() => {
    mockedHook.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("applies the newest refresh even when an older request resolves last, and aborts the superseded one", async () => {
    seed(ROWS, "live");
    const pending: Array<{ resolve: (r: Response) => void; signal: AbortSignal | undefined }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
      new Promise<Response>((resolve) => { pending.push({ resolve, signal: init?.signal ?? undefined }); }),
    );
    render(<ReverseAuctionTable auctions={ROWS} source="api" />);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal?.aborted).toBe(true);

    const body = (item: string) => new Response(JSON.stringify({ data: [{ ...ROWS[0]!, item }] }), { status: 200 });
    await act(async () => { pending[1]!.resolve(body("NEWER-ITEM")); await Promise.resolve(); });
    await act(async () => { pending[0]!.resolve(body("OLDER-ITEM")); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByRole("table").textContent).toContain("NEWER-ITEM");
    expect(screen.getByRole("table").textContent).not.toContain("OLDER-ITEM");
  });
});
