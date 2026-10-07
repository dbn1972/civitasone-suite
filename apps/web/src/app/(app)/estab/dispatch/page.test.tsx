import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// next/navigation globally mocked in vitest.setup.ts

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

import DispatchRegistryPage from "./page";

const ROW = {
  id: "ds1", dispatchNo: "DIS/2026/001", toAddress: "District Collector",
  subject: "Transfer order", mode: "speed_post", status: "dispatched",
  fileId: "file-123", dispatchedAt: "2026-10-01", deliveryStatus: "pending",
};

describe("DISPATCH-01: file link column", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders a 'View file' link when fileId is set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    const link = await screen.findByRole("link", { name: /View file/i });
    expect(link).toHaveAttribute("href", "/estab/files/file-123");
  });

  it("renders '—' when fileId is null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...ROW, fileId: null }] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.queryByRole("link", { name: /View file/i })).not.toBeInTheDocument();
  });
});

describe("DISPATCH-02: record acknowledgement", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows an Acknowledge button for dispatched-but-undelivered rows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    expect(await screen.findByRole("button", { name: /Acknowledge/i })).toBeInTheDocument();
  });

  it("POSTs delivery with the POD remarks when confirmed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("delivery")) return Promise.resolve(jsonResponse({ id: "ds1", status: "accepted" }, 202));
      return Promise.resolve(jsonResponse({ data: [ROW] }));
    });
    render(<DispatchRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Acknowledge/i }));
    const dialog = await screen.findByRole("alertdialog");
    const textarea = dialog.querySelector("textarea");
    fireEvent.change(textarea!, { target: { value: "SPEEDPOST-ABC123" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Mark delivered");
    fireEvent.click(confirm!);

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("delivery"));
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.dispatchId).toBe("ds1");
      expect(body.deliveryStatus).toBe("delivered");
      expect(body.deliveryProof).toBe("SPEEDPOST-ABC123");
    });
  });

  it("shows '✔ Delivered' for already-delivered rows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...ROW, deliveryStatus: "delivered" }] }));
    render(<DispatchRegistryPage />);
    expect(await screen.findByText(/Delivered/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Acknowledge/i })).not.toBeInTheDocument();
  });
});

describe("DISPATCH-03: humanized mode + date copy", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("humanizes the mode (speed_post → Speed Post)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.getByText("Speed Post")).toBeInTheDocument();
    expect(screen.queryByText("speed_post")).not.toBeInTheDocument();
  });

  it("shows 'Not yet dispatched' for a null date", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...ROW, dispatchedAt: null, status: "pending" }] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.getByText(/Not yet dispatched/i)).toBeInTheDocument();
  });
});

describe("DISPATCH-04: truncation notice", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the notice when exactly 100 rows are returned", async () => {
    const big = Array.from({ length: 100 }, (_, i) => ({ ...ROW, id: `d${i}`, dispatchNo: `DIS/${i}` }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: big }));
    render(<DispatchRegistryPage />);
    expect(await screen.findByText(/Showing latest 100 entries/i)).toBeInTheDocument();
  });

  it("does not show the notice for fewer than 100 rows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.queryByText(/Showing latest/i)).not.toBeInTheDocument();
  });
});
