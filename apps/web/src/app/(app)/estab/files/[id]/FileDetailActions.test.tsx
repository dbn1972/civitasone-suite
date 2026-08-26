import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { FileDetailActions } from "./FileDetailActions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const urlOf = (args: unknown[]): string => (typeof args[0] === "string" ? args[0] : "");

describe("FileDetailActions — irreversible actions are confirm-gated (L4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT sign the note on a bare click — it opens a ConfirmDialog, and only POSTs after confirming", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // operators load on mount
      .mockResolvedValueOnce(jsonResponse({})); // sign action (only after confirm)

    render(<FileDetailActions fileId="file-1" draftNotingId="note-1" status="active" />);

    // Let the mount fetch (operators) settle.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Sign note (green)" }));

    // A single click must NOT fire the irreversible sign request.
    expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/sign"))).toBe(false);

    // Instead a confirmation dialog appears...
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Sign note",
    );
    expect(confirmBtn).toBeTruthy();

    // ...and only confirming actually signs.
    fireEvent.click(confirmBtn!);
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/notings/note-1/sign"))).toBe(true),
    );
  });

  it("does NOT refer the file on a bare click — it opens a ConfirmDialog first", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "op-1",
              employeeId: "00000000-0000-0000-0000-000000000001",
              division: "Admin",
              section: null,
              deskRole: "section_officer",
              canInitiate: true,
              active: true,
            },
          ],
        }),
      ) // operators
      .mockResolvedValueOnce(jsonResponse({})); // move (only after confirm)

    render(<FileDetailActions fileId="file-1" draftNotingId="note-1" status="active" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Refer back" }));

    expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/move"))).toBe(false);

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Refer file",
    );
    expect(confirmBtn).toBeTruthy();

    fireEvent.click(confirmBtn!);
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/files/file-1/move"))).toBe(true),
    );
  });
});
