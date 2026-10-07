import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import { ContractorRatingForm } from "./ContractorRatingForm";

function fillReason(dialog: HTMLElement, text: string) {
  const textarea = dialog.querySelector("textarea");
  if (textarea) fireEvent.change(textarea, { target: { value: text } });
}

describe("ContractorRatingForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-04: Submit is gated on a reason (>=10 chars).
  it("requires a reason before the rating can be submitted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    render(<ContractorRatingForm contractorId="c-1" currentRating={0} ratingCount={0} canRate />);
    fireEvent.click(screen.getByRole("button", { name: /Rate 4 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit") as HTMLButtonElement;
    // Disabled with no reason.
    expect(confirmBtn.disabled).toBe(true);
    // Enabled + sends { rating, comment } once a reason is typed.
    fillReason(dialog, "On-time delivery, good quality");
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.rating).toBe(4);
    expect(body.comment).toBe("On-time delivery, good quality");
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-04: a 409 keeps the dialog open with the message.
  it("keeps the dialog open and shows the message on a 409 rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "cooldown" }), { status: 409, headers: { "content-type": "application/json" } }),
    );
    render(<ContractorRatingForm contractorId="c-1" currentRating={0} ratingCount={0} canRate />);
    fireEvent.click(screen.getByRole("button", { name: /Rate 3 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));
    const dialog = await screen.findByRole("alertdialog");
    fillReason(dialog, "Repeated quality issues on site");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit") as HTMLButtonElement;
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });

  it("shows a clerk-safe message, never the raw HTTP status, when submitting a rating fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(
      <ContractorRatingForm contractorId="c-1" currentRating={0} ratingCount={0} canRate />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rate 3 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));

    const dialog = await screen.findByRole("alertdialog");
    fillReason(dialog, "Did not meet the agreed scope");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit") as HTMLButtonElement;
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-04: self-cooldown warning.
  it("warns when the same viewer rated within the cooldown window", () => {
    render(
      <ContractorRatingForm
        contractorId="c-1"
        currentRating={4}
        ratingCount={1}
        canRate
        lastRatedAt={new Date().toISOString()}
        lastRatedBy="viewer-1"
        viewerId="viewer-1"
      />,
    );
    expect(screen.getByText(/rated this contractor within the last/i)).toBeInTheDocument();
  });
});
