import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { TenderActions } from "./TenderActions";

const TENDER_ID = "tttttttt-1111-2222-3333-444444444444";
const AWARD_ID = "awardawa-5555-6666-7777-888888888888";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("TenderActions — award finalization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("guards the DAO award-finalize behind a confirm dialog and reports it as SUBMITTED (L4 + L3: 202 != done)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: AWARD_ID, status: "accepted" }), { status: 202 }));

    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={AWARD_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "DAO Finalize Award" }));
    // Confirm dialog gates it — nothing sent yet.
    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("This will finalize the work award at the DAO level. Ensure DAO approval is obtained before proceeding.")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe(`/api/proxy/v1/works/tenders/award/${AWARD_ID}/dao-finalize`);

    // Truthful async wording — not a false "finalized".
    await waitFor(() =>
      expect(
        screen.getByText("Award DAO finalization submitted. It will show as finalized once processed."),
      ).toBeInTheDocument(),
    );
  });
});

/**
 * UX-016: each of the three independent actions here (quotation, award,
 * award-finalize) used to fall back to
 * `await res.text().catch(() => "Request failed")` verbatim on failure —
 * the same class of raw-text leak useFormError closes fleet-wide (UX-003).
 */
describe("TenderActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw server text, when adding a quotation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Request failed", { status: 500 }));
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add Quotation" }));
    fireEvent.change(screen.getByPlaceholderText("Enter contractor name"), {
      target: { value: "ACME Builders" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Quotation" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Request failed$/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when creating an award fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 409, headers: { "content-type": "application/json" } }),
    );
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Create Award" }));
    fireEvent.change(screen.getByPlaceholderText("Awarded contractor"), {
      target: { value: "ACME Builders" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Award" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });
});
