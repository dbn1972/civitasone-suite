import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewWorkOrderPage from "./page";

const ASSET = "11111111-2222-3333-4444-555555555555";
type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function mockFetch(opts: { searchStatus?: number; postStatus?: number } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/v1/asset/work-orders")) return new Response("{}", { status: opts.postStatus ?? 202 });
    if (url.includes(`/v1/asset/assets/${ASSET}`)) return new Response(JSON.stringify({ id: ASSET, code: "DG-062", name: "Generator" }), { status: 200 });
    if (url.includes("/v1/asset/assets")) {
      if (opts.searchStatus && opts.searchStatus !== 200) return new Response("{}", { status: opts.searchStatus });
      return new Response(JSON.stringify({ data: [{ id: ASSET, code: "DG-062", name: "Generator" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}

describe("NewWorkOrderPage", () => {
  beforeEach(() => { calls = []; search = ""; });
  afterEach(() => vi.restoreAllMocks());

  it("preselects Preventive from ?type= and titles the page accordingly (GAP-ASSETS-MAINTENANCE-01)", async () => {
    search = "type=preventive";
    mockFetch();
    render(<NewWorkOrderPage />);
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("preventive");
    expect(screen.getByRole("heading", { name: "Schedule Maintenance" })).toBeInTheDocument();
  });

  it("preselects Breakdown for the Log Job link and deep-links ?assetId= (GAP-ASSETS-MAINTENANCE-01 / NEW-01)", async () => {
    search = `type=breakdown&assetId=${ASSET}`;
    mockFetch();
    render(<NewWorkOrderPage />);
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("breakdown");
    await waitFor(() => expect(screen.getByRole("combobox", { name: /asset/i })).toHaveValue("DG-062 · Generator"));
  });

  it("submits the chosen type after confirmation and keeps a success message with a link (GAP-ASSETS-MAINTENANCE-NEW-03/-04)", async () => {
    search = `type=breakdown&assetId=${ASSET}`;
    mockFetch();
    render(<NewWorkOrderPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Log job" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Log job" }));
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false); // nothing is sent before confirm
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ assetId: ASSET, maintenanceType: "breakdown" });
    const status = await waitFor(() => {
      const el = screen.getAllByRole("status").find((n) => n.textContent?.includes("Done:"));
      if (!el) throw new Error("no success banner yet");
      return el;
    });
    expect(status.className).toContain("good");
    expect(screen.getByRole("link", { name: "View maintenance jobs" })).toHaveAttribute("href", "/assets/maintenance");
  });

  it("blocks a past date for a preventive job with an inline error and no request (GAP-ASSETS-MAINTENANCE-NEW-03)", async () => {
    search = `type=preventive&assetId=${ASSET}`;
    mockFetch();
    render(<NewWorkOrderPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Schedule job" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Scheduled date"), { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule job" }));
    expect(await screen.findByText(/cannot be scheduled in the past/)).toBeInTheDocument();
    expect(screen.getByLabelText("Scheduled date")).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("shows a distinct, labelled error banner when the save fails (GAP-ASSETS-MAINTENANCE-NEW-04)", async () => {
    search = `type=breakdown&assetId=${ASSET}`;
    mockFetch({ postStatus: 500 });
    render(<NewWorkOrderPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Log job" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Log job" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    const alert = await waitFor(() => {
      const el = screen.getAllByRole("alert").find((n) => n.textContent?.includes("Error:"));
      if (!el) throw new Error("no error banner yet");
      return el;
    });
    expect(alert.className).toContain("bad");
  });

  it("offers Retry when the asset search fails and recovers afterwards (GAP-ASSETS-MAINTENANCE-NEW-02)", async () => {
    mockFetch({ searchStatus: 500 });
    render(<NewWorkOrderPage />);
    fireEvent.change(screen.getByRole("combobox", { name: /asset/i }), { target: { value: "dg" } });
    const retry = await screen.findByRole("button", { name: /try again|retry/i });
    vi.restoreAllMocks();
    mockFetch();
    fireEvent.click(retry);
    expect(await screen.findByRole("combobox", { name: /asset/i })).toBeInTheDocument();
  });

  it("shows access-restricted, not a retry loop, on 403 (GAP-ASSETS-MAINTENANCE-NEW-02)", async () => {
    mockFetch({ searchStatus: 403 });
    render(<NewWorkOrderPage />);
    fireEvent.change(screen.getByRole("combobox", { name: /asset/i }), { target: { value: "dg" } });
    expect(await screen.findByText("Access restricted")).toBeInTheDocument();
  });
});
