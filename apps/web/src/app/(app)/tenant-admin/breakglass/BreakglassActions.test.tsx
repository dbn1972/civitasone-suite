import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { BreakglassActions } from "./BreakglassActions";

describe("BreakglassActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when closing the session fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("session already closed by another operator", { status: 409 }),
    );

    render(<BreakglassActions id="bg-1" requester="A. Officer" />);
    fireEvent.click(screen.getByRole("button", { name: "Close session" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for closing/i), { target: { value: "resolved" } });
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Close session");
    fireEvent.click(confirmBtn!);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/already closed by another/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });
});
