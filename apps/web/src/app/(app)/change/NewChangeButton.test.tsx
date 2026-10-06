import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { NewChangeButton } from "./NewChangeButton";

/**
 * GAP-CHANGE-HOME-02 (DS Modal with focus trap / ESC / focus-return) and
 * GAP-CHANGE-HOME-04 (emergency-type helper copy). The old overlay was a
 * hand-rolled fixed div with only Escape handling and no dialog semantics.
 */
describe("NewChangeButton (GAP-CHANGE-HOME-02 / -04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("opens an accessible dialog (role=dialog, aria-modal) with the title focused", async () => {
    render(<NewChangeButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Raise change" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Raise change request")).toBeInTheDocument();
  });

  it("shows the expedited-CAB helper text only when type is emergency (GAP-CHANGE-HOME-04)", async () => {
    render(<NewChangeButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Raise change" }));
    await screen.findByRole("dialog");
    expect(screen.queryByText(/expedited CAB review/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "emergency" } });
    expect(screen.getByText(/expedited CAB review/i)).toBeInTheDocument();
  });

  it("blocks submit (no fetch) until title and description meet the minimums", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewChangeButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Raise change" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Raise change" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the change-request endpoint and navigates to the new change on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-123" }), { status: 202 }),
    );
    render(<NewChangeButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Raise change" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Upgrade gateway" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Roll out v2 across finance." } });
    fireEvent.click(screen.getByRole("button", { name: "Raise change" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/change/new-123"));
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain("/api/proxy/v1/admin/change/requests");
  });
});
