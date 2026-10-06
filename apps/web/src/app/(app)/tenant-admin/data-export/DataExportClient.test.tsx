import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DataExportClient } from "./DataExportClient";
import type { DataExportRequest } from "@/app/_data/loaders";

const readyRow: DataExportRequest = {
  id: "ex-ready",
  type: "full",
  moduleFilter: null,
  format: "json",
  status: "ready",
  fileSizeBytes: 2048,
  createdAt: "2026-02-01T10:00:00Z",
  expiresAt: "2026-02-03T10:00:00Z",
  downloadUrl: "/api/proxy/v1/admin/data-export/ex-ready/download",
};

describe("DataExportClient — PII (01/02/03/05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("adds no 'processing' row and shows an error when the request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    render(<DataExportClient exports={[]} source="api" />);
    // full export requires a reason -> opens the confirm dialog
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Purpose for this export/i), { target: { value: "quarterly compliance audit" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Request export");
    fireEvent.click(confirm!);
    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't|could not|try again/i));
    expect(screen.queryByText("Processing")).toBeNull();
    expect(screen.getByText("No exports yet")).toBeTruthy();
  });

  it("requires a purpose before confirming a full export", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
    render(<DataExportClient exports={[]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Request export") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Purpose for this export/i), { target: { value: "audit reason long enough" } });
    expect(confirm.disabled).toBe(false);
  });

  it("renders a ready export as a real download link, not an inert button", () => {
    render(<DataExportClient exports={[readyRow]} source="api" />);
    const link = screen.getByRole("link", { name: /Download full export/i });
    expect(link.getAttribute("href")).toBe("/api/proxy/v1/admin/data-export/ex-ready/download");
    // aria-label uses a readable date, not a raw ISO string.
    expect(link.getAttribute("aria-label")).not.toMatch(/2026-02-01T10:00:00Z/);
  });

  it("renders status via a themed StatusPill", () => {
    render(<DataExportClient exports={[readyRow]} source="api" />);
    const pill = screen.getByText("Ready");
    expect(pill.className).toContain("pill");
  });
});
