import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AssetVerificationPage from "./page";

const LOCS = [{ id: "l1", code: "WH-2", name: "Central Warehouse" }, { id: "l2", code: "HQ", name: "HQ Block" }];

// GAP-ASSETS-VERIFICATION-01
describe("AssetVerificationPage location", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "v1", status: "accepted" }), { status: 202 });
      if (String(url).includes("/locations")) return new Response(JSON.stringify({ data: LOCS }), { status: 200 });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("requires a location before starting a session", async () => {
    render(<AssetVerificationPage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "WH-2 · Central Warehouse" })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "+ New verification" })[0]!);
    expect(screen.getByText("Choose the location being verified.")).toBeInTheDocument();
    expect(screen.queryByText("Start a new verification session?")).not.toBeInTheDocument();
  });

  it("creates the session with the chosen location and the typed scope", async () => {
    render(<AssetVerificationPage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "WH-2 · Central Warehouse" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Location to verify"), { target: { value: "Central Warehouse" } });
    fireEvent.click(screen.getAllByRole("button", { name: "+ New verification" })[0]!);
    await waitFor(() => expect(screen.getByText("Start a new verification session?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Scope / notes"), { target: { value: "Annual stock-take FY26" } });
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchSpy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({ location: "Central Warehouse", notes: "Annual stock-take FY26" });
  });

  it("has no hard-coded location literal", () => {
    expect(readFileSync(join(__dirname, "page.tsx"), "utf8")).not.toMatch(/location: "HQ Block"/);
  });

  it("shows a load error with Retry (not 'no locations') when the locations fetch fails, and recovers", async () => {
    let fail = true;
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response("{}", { status: 202 });
      if (String(url).includes("/locations")) {
        return fail ? new Response("boom", { status: 500 }) : new Response(JSON.stringify({ data: LOCS }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<AssetVerificationPage />);
    expect(await screen.findByText(/Couldn.t load locations/)).toBeInTheDocument();
    expect(screen.queryByText(/No locations set up yet|Create functional locations first/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Location to verify")).toBeDisabled();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("option", { name: "WH-2 · Central Warehouse" })).toBeInTheDocument();
    expect(screen.getByLabelText("Location to verify")).toBeEnabled();
  });

  it("says no locations are set up only when the list genuinely is empty", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      new Response(JSON.stringify({ data: String(url).includes("/locations") ? [] : [] }), { status: 200 }),
    );
    render(<AssetVerificationPage />);
    expect(await screen.findByText(/Create functional locations first/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load locations/)).not.toBeInTheDocument();
  });
});
