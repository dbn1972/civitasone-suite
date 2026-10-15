import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { MigrationPanel } from "./MigrationPanel";

const EFILE_ID = "9f9f9f9f-0000-4000-8000-00000000abcd";
const row = (over: Record<string, unknown>) => ({
  id: "m1", legacyFileNo: "F/OLD/001", subject: "Old register", dept: "Admin", pageCount: 4,
  scanRef: null, efileId: null, status: "registered", createdAt: "2026-10-01T00:00:00Z", ...over,
});

describe("MigrationPanel — GAP-ESTAB-MIGRATION-04", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("Given a row linked to an eFile, Then the link text is the file number (not a generic label or an id prefix) and points at the file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [row({ efileId: EFILE_ID, efileNo: "EST/2026/114", status: "linked" })] }), { status: 200 }));
    render(<MigrationPanel />);
    const link = await screen.findByRole("link", { name: "EST/2026/114" });
    expect(link).toHaveAttribute("href", `/estab/files/${EFILE_ID}`);
    expect(document.body.textContent).not.toContain("9f9f9f9f");
  });

  it("Given a linked row whose number the service did not return, Then it falls back to Open eFile, never an id fragment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [row({ efileId: EFILE_ID, efileNo: null, status: "linked" })] }), { status: 200 }));
    render(<MigrationPanel />);
    expect(await screen.findByRole("link", { name: "Open eFile" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("9f9f9f9f");
  });

  it("Given the form is submitted empty, Then three distinct field messages show and nothing is posted", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    render(<MigrationPanel />);
    await screen.findByText("No legacy files registered yet.");
    fireEvent.click(screen.getByRole("button", { name: "Register file" }));
    expect(await screen.findByText("Legacy file number is required.")).toBeInTheDocument();
    expect(screen.getByText("Department is required.")).toBeInTheDocument();
    expect(screen.getByText("Subject must be at least 3 characters.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });

  it("Given a valid form, When Register is clicked, Then a confirmation shows the entered values and nothing posts until confirmed", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_i, init) =>
      new Response(JSON.stringify((init as RequestInit | undefined)?.method === "POST" ? { status: "accepted" } : []), { status: 200 }));
    render(<MigrationPanel />);
    await screen.findByText("No legacy files registered yet.");
    fireEvent.change(screen.getByLabelText(/Legacy file no/), { target: { value: "F/OLD/007" } });
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Old register" } });
    fireEvent.click(screen.getByRole("button", { name: "Register file" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("F/OLD/007");
    expect(dialog.textContent).toContain("Old register");
    const posts = () => spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts()).toHaveLength(0);

    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Register file")!);
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it("Given the clerk cancels the confirmation, Then nothing is posted", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    render(<MigrationPanel />);
    await screen.findByText("No legacy files registered yet.");
    fireEvent.change(screen.getByLabelText(/Legacy file no/), { target: { value: "F/OLD/008" } });
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Another" } });
    fireEvent.click(screen.getByRole("button", { name: "Register file" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });
});
