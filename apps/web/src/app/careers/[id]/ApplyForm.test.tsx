import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApplyForm } from "./ApplyForm";

afterEach(() => vi.restoreAllMocks());

function fill() {
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Priya Das" } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "priya@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /submit application/i }));
}

describe("ApplyForm reference", () => {
  it("shows the server applicationNo, never a client-derived APP-<year> string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "11111111-2222-3333-4444-555555abc123", applicationNo: "REC/2026/0042", status: "applied" }), { status: 202 })));
    render(<ApplyForm jobOpeningId="job-1" />);
    fill();
    await waitFor(() => expect(screen.getByText("REC/2026/0042")).toBeTruthy());
    expect(screen.queryByText(/APP-\d{4}-ABC123/)).toBeNull();
    const link = screen.getByRole("link", { name: /track my application/i });
    expect(link.getAttribute("href")).toContain(encodeURIComponent("REC/2026/0042"));
  });

  it("falls back to an emailed-reference message when applicationNo is null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "11111111-2222-3333-4444-555555abc123", applicationNo: null }), { status: 202 })));
    render(<ApplyForm jobOpeningId="job-1" />);
    fill();
    await waitFor(() => expect(screen.getByText("Reference will be emailed")).toBeTruthy());
    expect(screen.queryByText(/APP-/)).toBeNull();
  });

  it("on 409 DUPLICATE_APPLICATION shows the existing applicationNo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "DUPLICATE_APPLICATION", message: "x", applicationNo: "REC/2026/0007" }), { status: 409 })));
    render(<ApplyForm jobOpeningId="job-1" />);
    fill();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("REC/2026/0007"));
  });
});
