import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { FileDetailActions, isFileReadOnly } from "./FileDetailActions";

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

describe("FileDetailActions — officer of record is never client-supplied (security fix)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send an officerId when saving a yellow note — the server derives the actor", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // operators load on mount
      .mockResolvedValueOnce(jsonResponse({})); // save yellow note

    render(<FileDetailActions fileId="file-1" status="active" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Yellow note (draft)"), {
      target: { value: "Recommending approval" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save yellow note" }));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/notings"))).toBe(true),
    );

    const notingCall = fetchSpy.mock.calls.find((c) => urlOf(c).includes("/notings"))!;
    const sentBody = JSON.parse((notingCall[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty("officerId");
    expect(sentBody.body).toBe("Recommending approval");
  });

  it("blocks 'Refer back' with a helpful error when no valid officer is available (no phantom-officer fallback)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })); // operators load — none enrolled, toOfficer stays ""

    render(<FileDetailActions fileId="file-1" draftNotingId="note-1" status="active" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Refer back" }));

    // Before the fix, an empty toOfficer fell back to the phantom officer
    // constant, which "looked" like a valid UUID and let the action proceed.
    // Now an empty target must fail validation — no dialog, no /move request.
    expect(await screen.findByText(/Pick an officer or enter a valid officer ID/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/move"))).toBe(false);
  });
});

describe("FileDetailActions — write controls hidden on terminal register states (GAP-ESTAB-FILES-DETAIL-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("isFileReadOnly is true for archived/disposed and false for active/pending", () => {
    expect(isFileReadOnly("archived")).toBe(true);
    expect(isFileReadOnly("disposed")).toBe(true);
    expect(isFileReadOnly("active")).toBe(false);
    expect(isFileReadOnly("pending")).toBe(false);
    // The dead "closed" value from the audit snapshot is NOT read-only here.
    expect(isFileReadOnly("closed")).toBe(false);
  });

  for (const status of ["archived", "disposed"]) {
    it(`renders a read-only notice and no Submit/Sign/Refer buttons when status is ${status}`, () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
      render(<FileDetailActions fileId="file-1" draftNotingId="note-1" status={status} />);

      expect(screen.queryByRole("button", { name: "Submit for approval" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Sign note (green)" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Refer back" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Save yellow note" })).toBeNull();
      expect(screen.getByText(new RegExp(`This file is ${status}`))).toBeInTheDocument();
    });
  }

  for (const status of ["active", "pending"]) {
    it(`keeps Submit/Sign/Refer available when status is ${status}`, async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
      render(<FileDetailActions fileId="file-1" draftNotingId="note-1" status={status} />);
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      expect(screen.getByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign note (green)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Refer back" })).toBeInTheDocument();
    });
  }
});

describe("FileDetailActions — disabled Submit/Sign explain why (GAP-ESTAB-FILES-DETAIL-07)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows 'Save a yellow note first' when there is no draft note", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<FileDetailActions fileId="file-1" status="active" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(screen.getByText(/Save a yellow note first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign note (green)" })).toBeDisabled();
  });

  it("hides the helper once a draft note exists", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<FileDetailActions fileId="file-1" draftNotingId="note-1" status="active" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(screen.queryByText(/Save a yellow note first/)).toBeNull();
    expect(screen.getByRole("button", { name: "Submit for approval" })).not.toBeDisabled();
  });
});
