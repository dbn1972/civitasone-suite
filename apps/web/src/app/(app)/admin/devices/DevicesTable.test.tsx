import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { DevicesTable, type DeviceRow } from "./DevicesTable";

const dev = (over: Partial<DeviceRow>): DeviceRow => ({
  id: "d1", deviceName: "Pixel 8", platform: "android", osVersion: "14", appVersion: "1.0",
  trustStatus: "trusted", flaggedReason: "", lastSeen: "2026-09-01T10:00:00Z", loginCount: 3, employeeName: "Asha Rao",
  ...over,
});

describe("DevicesTable", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    refreshMock.mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });
  afterEach(() => vi.restoreAllMocks());

  // GAP-ADMIN-DEVICES-03
  it("Block asks for a reason, then PATCHes /block with it and refreshes", async () => {
    render(<DevicesTable items={[dev({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Phone lost" } });
    fireEvent.click(screen.getByRole("button", { name: "Block device" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("/api/proxy/v1/hrms/devices/d1/block");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Phone lost" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("a blocked device offers Unblock (no reason box) and PATCHes /unblock", async () => {
    render(<DevicesTable items={[dev({ trustStatus: "blocked" })]} />);
    expect(screen.queryByRole("button", { name: "Block" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unblock device" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("/api/proxy/v1/hrms/devices/d1/unblock");
  });

  it("a 403 shows an error and does not refresh", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 403 }));
    render(<DevicesTable items={[dev({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Block device" }));
    expect(await screen.findByText(/don't have permission/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-ADMIN-DEVICES-04
  it("filters by trust status", () => {
    render(<DevicesTable items={[dev({ id: "a", deviceName: "Alpha" }), dev({ id: "b", deviceName: "Bravo", trustStatus: "flagged" })]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Flagged" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("paginates 25 rows per page", () => {
    const many = Array.from({ length: 30 }, (_, i) => dev({ id: `x${i}`, deviceName: `Dev-${String(i).padStart(2, "0")}` }));
    render(<DevicesTable items={many} />);
    expect(screen.getByText("Dev-00")).toBeInTheDocument();
    expect(screen.queryByText("Dev-29")).not.toBeInTheDocument();
  });

  it("records the CSV export and leaves the id/Actions column out of the file", async () => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    const blobs: Blob[] = [];
    (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mockImplementation((b: Blob) => { blobs.push(b); return "blob:mock"; });
    render(<DevicesTable items={[dev({ id: "secret-row-id" })]} />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("/api/proxy/v1/hrms/devices/export-audit");
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ rowCount: 1, filtered: false });
    const csv = await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.readAsText(blobs[0] as Blob); });
    expect(csv).not.toContain("secret-row-id");
    expect(csv).not.toContain("Actions");
  });

  // GAP-ADMIN-DEVICES-05
  it("shows Last Active as a formatted IST date-time, not the raw ISO string", () => {
    render(<DevicesTable items={[dev({ lastSeen: "2026-09-01T10:00:00Z" })]} />);
    expect(screen.queryByText("2026-09-01T10:00:00Z")).not.toBeInTheDocument();
    expect(screen.getByText("01/09/2026 15:30")).toBeInTheDocument();
  });

  it("humanizes the flag reason", () => {
    render(<DevicesTable items={[dev({ trustStatus: "flagged", flaggedReason: "no_screen_lock" })]} />);
    expect(screen.getByText(/no screen lock/i)).toBeInTheDocument();
  });

  it("the Block confirm text does not claim a sign-out that does not happen", async () => {
    render(<DevicesTable items={[dev({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(await screen.findByText(/next check-in/)).toBeInTheDocument();
    expect(screen.getByText(/keep working until they expire/)).toBeInTheDocument();
    expect(screen.queryByText(/signed out/)).not.toBeInTheDocument();
  });

  it("export audit records only whether a search was active, not the search text", async () => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    render(<DevicesTable items={[dev({ deviceName: "Pixel 8" })]} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Pixel" } });
    fireEvent.click(screen.getByText("⬇ CSV"));
    const body = String((fetchSpy.mock.calls[0]![1] as RequestInit).body);
    expect(JSON.parse(body)).toEqual({ rowCount: 1, filtered: true });
    expect(body).not.toContain("Pixel");
  });
});
