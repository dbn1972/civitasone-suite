import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

// The optional work picker (GAP-WORKS-CONTRACTORS-DETAIL-04) searches works through this adapter.
const WORK = "00000000-1111-4000-8000-000000000001";
vi.mock("@/lib/entityAdapters/workProposal", () => ({
  searchWorkProposals: vi.fn(async () => [{ id: "00000000-1111-4000-8000-000000000001", label: "WRK-1", sublabel: "Road" }]),
  resolveWorkProposals: vi.fn(async () => [{ id: "00000000-1111-4000-8000-000000000001", label: "WRK-1", sublabel: "Road" }]),
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

  // GAP-WORKS-CONTRACTORS-DETAIL-04: an optional link to the work the rating is about.
  it("sends the chosen work as workId, and sends none when no work is picked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    render(<ContractorRatingForm contractorId="c-1" currentRating={0} ratingCount={0} canRate />);

    // 1) no work picked -> body carries no workId
    fireEvent.click(screen.getByRole("button", { name: /Rate 5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));
    let dialog = await screen.findByRole("alertdialog");
    fillReason(dialog, "Completed ahead of schedule");
    let confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit") as HTMLButtonElement;
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).not.toHaveProperty("workId");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    // 2) pick a work by its number -> body carries its id
    const picker = screen.getByRole("combobox", { name: /Work this rating is about/i });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "WRK" } });
    fireEvent.mouseDown(await screen.findByText("WRK-1"));
    fireEvent.click(screen.getByRole("button", { name: /Rate 4 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));
    dialog = await screen.findByRole("alertdialog");
    fillReason(dialog, "Good finish on the retaining wall");
    confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit") as HTMLButtonElement;
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string)).toMatchObject({ rating: 4, workId: WORK });
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-04: works-service answers a repeat rating inside the cooling-off period with
  // 409 RATING_COOLDOWN (flat envelope); the dialog stays open and shows the catalogued sentence.
  it("keeps the dialog open and shows the cooling-off message on a real 409 RATING_COOLDOWN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "RATING_COOLDOWN", message: "x", correlationId: "c", retryable: false }), {
        status: 409, headers: { "content-type": "application/json" },
      }),
    );
    render(<ContractorRatingForm contractorId="c-1" currentRating={0} ratingCount={0} canRate />);
    fireEvent.click(screen.getByRole("button", { name: /Rate 2 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));
    const dialog = await screen.findByRole("alertdialog");
    fillReason(dialog, "Safety lapses reported twice");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit") as HTMLButtonElement;
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(dialog.textContent).toMatch(/rated this contractor recently/i));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/\b409\b/);
    expect(dialog.textContent).not.toMatch(/RATING_COOLDOWN/);
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

  // GAP-WORKS-CONTRACTORS-DETAIL-04: self-cooldown warning, driven by the period the SERVER reports.
  it("warns, and holds Submit back, when the same viewer rated within the configured cooling-off period", () => {
    render(
      <ContractorRatingForm
        contractorId="c-1"
        currentRating={4}
        ratingCount={1}
        canRate
        lastRatedAt={new Date().toISOString()}
        lastRatedBy="viewer-1"
        viewerId="viewer-1"
        cooldownDays={45}
      />,
    );
    expect(screen.getByText(/rated this contractor within the last 45 days/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rate 4 stars/i }));
    expect(screen.getByRole("button", { name: "Submit Rating" })).toBeDisabled();
  });

  it("shows no warning and keeps Submit enabled when no cooling-off period is configured (cooldownDays 0 / absent)", () => {
    const recent = { lastRatedAt: new Date().toISOString(), lastRatedBy: "viewer-1", viewerId: "viewer-1" };
    const { unmount } = render(<ContractorRatingForm contractorId="c-1" currentRating={4} ratingCount={1} canRate {...recent} />);
    expect(screen.queryByText(/rated this contractor within the last/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rate 4 stars/i }));
    expect(screen.getByRole("button", { name: "Submit Rating" })).not.toBeDisabled();
    unmount();
    render(<ContractorRatingForm contractorId="c-1" currentRating={4} ratingCount={1} canRate {...recent} cooldownDays={0} />);
    expect(screen.queryByText(/rated this contractor within the last/i)).not.toBeInTheDocument();
  });

  it("no warning when the last rating is older than the period, or was made by someone else", () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { unmount } = render(
      <ContractorRatingForm contractorId="c-1" currentRating={4} ratingCount={1} canRate
        lastRatedAt={old} lastRatedBy="viewer-1" viewerId="viewer-1" cooldownDays={30} />,
    );
    expect(screen.queryByText(/rated this contractor within the last/i)).not.toBeInTheDocument();
    unmount();
    render(
      <ContractorRatingForm contractorId="c-1" currentRating={4} ratingCount={1} canRate
        lastRatedAt={new Date().toISOString()} lastRatedBy="someone-else" viewerId="viewer-1" cooldownDays={30} />,
    );
    expect(screen.queryByText(/rated this contractor within the last/i)).not.toBeInTheDocument();
  });
});
