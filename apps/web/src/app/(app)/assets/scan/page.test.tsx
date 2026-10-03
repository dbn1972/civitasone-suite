import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MobileScanPage from "./page";
import { scanFailureMessage, scanNetworkMessage } from "./scanErrors";

async function lookup(tag = "AST-1") {
  fireEvent.change(screen.getByLabelText("Asset tag / barcode"), { target: { value: tag } });
  fireEvent.click(screen.getByRole("button", { name: "Lookup asset" }));
}

describe("MobileScanPage", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  // GAP-ASSETS-SCAN-01 / 03
  it("is titled and described as a lookup (not field verification) and links to verification sessions", () => {
    render(<MobileScanPage />);
    expect(screen.getByRole("heading", { name: "Asset Lookup" })).toBeInTheDocument();
    expect(screen.queryByText(/Field verification/)).not.toBeInTheDocument();
    expect(screen.queryByText("Barcode Scan")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verification sessions" })).toHaveAttribute("href", "/assets/verification");
  });

  // GAP-ASSETS-SCAN-02
  it("a 500 is a retryable load error, not 'not found'; a 404 is not found; a 403 is a permission message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<MobileScanPage />);
    fetchSpy.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await lookup();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).not.toMatch(/No asset with this tag/);
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await lookup("X");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No asset with this tag/));
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    await lookup("Y");
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toMatch(/No asset with this tag/));
  });

  it("a network failure shows plain copy, not the browser's raw message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<MobileScanPage />);
    await lookup();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).not.toMatch(/Failed to fetch/);
  });

  // GAP-ASSETS-SCAN-04 / 05
  it("shows a humanised status pill, paise book value, a client-side Open asset link, and selects the field for the next scan", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a-1", code: "IT/1", name: "Laptop", barcode: "AST-1", status: "under_maintenance", bookValue: 1234500 }), { status: 200 }));
    render(<MobileScanPage />);
    await lookup();
    await waitFor(() => expect(screen.getByText("Laptop")).toBeInTheDocument());
    expect(screen.queryByText("under_maintenance")).not.toBeInTheDocument();
    expect(screen.getByText(/Under Maintenance/i)).toBeInTheDocument();
    expect(screen.getByText("₹12,345.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open asset" })).toHaveAttribute("href", "/assets/a-1");
    expect(document.activeElement).toBe(screen.getByLabelText("Asset tag / barcode"));
  });

  it("source uses next/link (not a raw anchor) and no raw Error('Asset not found')", () => {
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(src).toContain('from "next/link"');
    expect(src).not.toMatch(/<a\s/);
    expect(src).not.toContain("Asset not found");
  });
});

describe("scanErrors", () => {
  it("maps status codes", () => {
    expect(scanFailureMessage(404).retryable).toBe(false);
    expect(scanFailureMessage(404).message).toMatch(/No asset with this tag/);
    expect(scanFailureMessage(401).message).not.toMatch(/No asset/);
    expect(scanFailureMessage(500).retryable).toBe(true);
    expect(scanNetworkMessage().length).toBeGreaterThan(0);
  });
});
