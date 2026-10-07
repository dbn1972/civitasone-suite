import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// next/navigation is globally mocked in vitest.setup.ts

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

import DakRegistryPage from "./page";

const RECEIVED_ROW = {
  id: "d1", dakNo: "DAK/2026/001", fromAddress: "Home Ministry",
  subject: "Confidential memo", receivedAt: "2026-10-01", status: "received",
  fileId: null, fileRef: null, barcode: "B001", sourceSection: null,
};

describe("DAK-01: open-file requires classification dialog", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("opens a dialog when 'Open file' is clicked, requiring dept + classification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    const btn = await screen.findByRole("button", { name: "Open file" });
    fireEvent.click(btn);
    // The dialog title names the DAK; a department input and classification select appear
    expect(await screen.findByText(/Open file from DAK DAK\/2026\/001/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ADMIN/i)).toBeInTheDocument();
    const classSelect = document.querySelector("select[required]") as HTMLSelectElement;
    expect(classSelect).toBeTruthy();
    // classification options include confidential and top_secret, not a default
    expect(classSelect.querySelector('option[value="confidential"]')).toBeTruthy();
    expect(classSelect.value).toBe(""); // forced choice, no default "public"
  });

  it("posts the chosen classification and dept, not hard-coded 'public'/'ADMIN'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("open-file")) return Promise.resolve(jsonResponse({ id: "file-new" }));
      return Promise.resolve(jsonResponse({ data: [RECEIVED_ROW] }));
    });

    render(<DakRegistryPage />);
    const btn = await screen.findByRole("button", { name: "Open file" });
    fireEvent.click(btn);
    await screen.findByText(/Open file from DAK DAK\/2026\/001/i);

    // Fill dept and classification
    const deptInput = screen.getByPlaceholderText(/ADMIN/i);
    fireEvent.change(deptInput, { target: { value: "Finance" } });
    const classSelect = document.querySelector("select[required]") as HTMLSelectElement;
    fireEvent.change(classSelect, { target: { value: "confidential" } });
    // Confirm
    const confirm = screen.getByRole("button", { name: /Open the file/i });
    fireEvent.click(confirm);

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("open-file"));
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.classification).toBe("confidential");
      expect(body.dept).toBe("Finance");
    });
  });
});

describe("DAK-02: clerk-safe errors", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a human-readable error (not raw JSON) on a failed register", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // load
      .mockResolvedValueOnce(new Response('{"code":"VALIDATION_FAILED"}', { status: 400 })); // register

    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByText("Register DAK")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/From/i), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: "Test sub" } });
    fireEvent.click(screen.getByRole("button", { name: "Register DAK" }));

    await waitFor(() => {
      const alertRegion = screen.getByRole("alert");
      expect(alertRegion.textContent).not.toMatch(/VALIDATION_FAILED/);
    });
  });
});

describe("DAK-03: form has mode and received date fields", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders Mode and Received date fields in the register form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByLabelText(/Mode/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/Received date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Urgency/i)).toBeInTheDocument();
  });
});

describe("DAK-04: truncation notice at 100 rows", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows 'Showing latest 100' notice when exactly 100 rows are loaded", async () => {
    const bigData = Array.from({ length: 100 }, (_, i) => ({
      ...RECEIVED_ROW, id: `d${i}`, dakNo: `DAK/2026/${i}`,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: bigData }));
    render(<DakRegistryPage />);
    expect(await screen.findByText(/Showing latest 100 entries/i)).toBeInTheDocument();
  });

  it("does not show the notice for fewer than 100 rows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    await screen.findByText("DAK/2026/001");
    expect(screen.queryByText(/Showing latest/i)).not.toBeInTheDocument();
  });
});

describe("DAK-05: StatusPill humanisation + success msg with number", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses StatusPill with no explicit label override (humanises internally)", async () => {
    const row = { ...RECEIVED_ROW, status: "file_opened" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [row] }));
    render(<DakRegistryPage />);
    // StatusPill with status="file_opened" should internally humanize to "File Opened"
    await screen.findByText("DAK/2026/001");
    // The status cell should NOT show raw "file_opened"
    expect(screen.queryByText("file_opened")).not.toBeInTheDocument();
  });

  it("shows null sourceSection as '—' not 'manual'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    await screen.findByText("DAK/2026/001");
    // Source column for null sourceSection should be "—"
    expect(screen.queryByText("manual")).not.toBeInTheDocument();
  });
});
