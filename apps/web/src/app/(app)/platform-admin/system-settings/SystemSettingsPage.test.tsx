import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SystemSettingsPage } from "./SystemSettingsPage";

describe("SystemSettingsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function startEditingGeneral() {
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  }

  it("saves the General section on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<SystemSettingsPage />);
    startEditingGeneral();
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => expect(screen.getByText(/general settings saved/i)).toBeInTheDocument());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/admin/settings/general");
    expect((init as RequestInit).method).toBe("PUT");
  });

  // UX-016: fakeSave used to build the error from `Server error (${status})`
  // verbatim. It must now show only the catalogued, clerk-safe copy — never
  // the raw HTTP status.
  it("shows a clerk-safe error, not the raw status text, when the save fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<SystemSettingsPage />);
    startEditingGeneral();
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/Server error \(500\)/)).not.toBeInTheDocument();
  });

  it("tolerates a 404 (settings API not yet implemented) as a successful no-op save", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    render(<SystemSettingsPage />);
    startEditingGeneral();
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => expect(screen.getByText(/general settings saved/i)).toBeInTheDocument());
  });
});
