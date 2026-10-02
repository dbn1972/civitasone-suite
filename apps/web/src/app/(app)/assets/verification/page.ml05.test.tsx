import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AssetVerificationPage from "./page";
import { isAtSessionLimit, summariseItems, SESSION_LIMIT } from "./sessions";

const LOCS = [{ id: "l1", code: "WH-2", name: "Central Warehouse" }];
const SESSION_ID = "9f8e7d6c-1111-4222-8333-444455556666";

function mockFetch(sessions: unknown[]) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "v1" }), { status: 202 });
    if (String(url).includes("/locations")) return new Response(JSON.stringify({ data: LOCS }), { status: 200 });
    return new Response(JSON.stringify({ data: sessions }), { status: 200 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("AssetVerificationPage ml-assets-05", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  // GAP-ASSETS-VERIFICATION-04
  it("defaults the date to today in IST (not UTC) and posts the chosen date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T20:00:00Z")); // 01:30 IST on 11 March
    const spy = mockFetch([]);
    render(<AssetVerificationPage />);
    const date = screen.getByLabelText("Verification date") as HTMLInputElement;
    expect(date.value).toBe("2026-03-11");
    await waitFor(() => expect(screen.getByRole("option", { name: "WH-2 · Central Warehouse" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Location to verify"), { target: { value: "Central Warehouse" } });
    fireEvent.change(date, { target: { value: "2026-03-05" } });
    fireEvent.click(screen.getAllByRole("button", { name: "+ New verification" })[0]!);
    await waitFor(() => expect(screen.getByText("Start a new verification session?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Scope / notes"), { target: { value: "FY26 stock-take" } });
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(spy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = spy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({ verificationDate: "2026-03-05" });
  });

  it("rejects a future verification date", async () => {
    mockFetch([]);
    render(<AssetVerificationPage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "WH-2 · Central Warehouse" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Location to verify"), { target: { value: "Central Warehouse" } });
    fireEvent.change(screen.getByLabelText("Verification date"), { target: { value: "2999-01-01" } });
    fireEvent.click(screen.getAllByRole("button", { name: "+ New verification" })[0]!);
    expect(screen.getByText("Verification date cannot be in the future.")).toBeInTheDocument();
    expect(screen.queryByText("Start a new verification session?")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-VERIFICATION-02 / 03 / 05
  it("labels the id column, links each row to its session, and links to condemnation", async () => {
    mockFetch([{ id: SESSION_ID, status: "draft", verificationDate: "2026-03-05", location: "Central Warehouse" }]);
    render(<AssetVerificationPage />);
    expect(await screen.findByText("Session ID")).toBeInTheDocument();
    expect(screen.getByTitle(SESSION_ID)).toHaveTextContent(SESSION_ID.slice(0, 8));
    expect(screen.getByRole("link", { name: /9f8e7d6c/ })).toHaveAttribute("href", `/assets/verification/${SESSION_ID}`);
    expect(screen.getByRole("link", { name: /Condemnation/ })).toHaveAttribute("href", "/assets/condemnation");
    expect(screen.queryByText(/Barcode-driven audit/)).not.toBeInTheDocument();
  });

  it("states the limit when the list is full", async () => {
    const rows = Array.from({ length: SESSION_LIMIT }, (_, i) => ({ id: `id-${i}-aaaaaaaa`, status: "draft", verificationDate: "2026-03-05", location: "X" }));
    mockFetch(rows);
    render(<AssetVerificationPage />);
    expect(await screen.findByText(`Showing the latest ${SESSION_LIMIT} sessions.`)).toBeInTheDocument();
  });

  // GAP-ASSETS-VERIFICATION-06
  it("shows a table skeleton while loading, not an hourglass empty state", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<AssetVerificationPage />);
    expect(screen.getByLabelText("Loading data…")).toBeInTheDocument();
    expect(screen.queryByText(/Loading verification sessions/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("⏳");
  });
});

describe("sessions helpers", () => {
  it("limit and summary", () => {
    expect(isAtSessionLimit(SESSION_LIMIT - 1)).toBe(false);
    expect(isAtSessionLimit(SESSION_LIMIT)).toBe(true);
    expect(summariseItems([
      { id: "1", assetId: "a", condition: "good", foundAtLocation: true },
      { id: "2", assetId: "b", condition: "poor", foundAtLocation: false },
      { id: "3", assetId: "c", condition: "good" },
    ])).toEqual({ total: 3, found: 2, missing: 1 });
  });
});
