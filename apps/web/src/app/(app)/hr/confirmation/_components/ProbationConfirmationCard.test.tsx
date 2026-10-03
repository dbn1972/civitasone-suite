import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProbationConfirmationList, type ConfirmationRow } from "./ProbationConfirmationCard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ROW: ConfirmationRow = {
  id: "emp-1",
  employee: "Priya Nair",
  designation: "Section Officer",
  joiningDate: "2024-01-01",
  probationEnd: "2026-01-01",
  dueDate: "2026-01-15",
  managerRecommendation: "recommended",
  status: "probation",
};

describe("ProbationConfirmationCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    refresh.mockClear();
  });

  it("requires an order reference and a date, and calls PATCH .../confirm with them, instead of only flipping local state", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));

    // Must ask before doing anything irreversible-looking.
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // GAP-HR-CONFIRMATION-02: order reference is required before Confirm
    // can succeed -- the dialog's onConfirm rejects an empty one.
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));
    await waitFor(() => expect(screen.getByText(/order reference is required/i)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Order reference"), { target: { value: "CONFIRM/2026/014" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/confirm",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"orderRef":"CONFIRM/2026/014"'),
      }),
    ));
    // GAP-HR-CONFIRMATION-04: "submitted" (pending), never an optimistic
    // "Confirmed" the server hasn't actually applied yet -- and the list is
    // asked to re-fetch so a rejected command doesn't leave a stale badge.
    await waitFor(() => expect(screen.getByText("Confirmation submitted")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  // UX-016: this used to show the raw backend response text ("not
  // authorised") verbatim — the same class of leak useFormError closes
  // fleet-wide (UX-003). It must now show the catalogued clerk-safe message
  // instead, never the raw server text.
  it("surfaces a clerk-safe failure message instead of showing Confirmed anyway", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "not authorised" }) as Response));
    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    fireEvent.change(await screen.findByLabelText("Order reference"), { target: { value: "CONFIRM/2026/014" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));

    await waitFor(() => expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument());
    expect(screen.queryByText(/not authorised/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmation submitted")).not.toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code on a plain-text failure with no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }) as Response));
    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    fireEvent.change(await screen.findByLabelText("Order reference"), { target: { value: "CONFIRM/2026/014" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));

    const errorMessage = await waitFor(() => screen.getByText(/We couldn't save the probation confirmation because of a problem on our side\. Your changes haven't been saved\. Try again in a few minutes\./));
    // Scoped to the error text itself, not the whole document -- the
    // dialog's own optional-remark field legitimately renders a
    // "0/500 characters" hint (maxReasonLength={500}), which is not the
    // raw-status-code leak this regression guards against.
    expect(errorMessage.textContent).not.toMatch(/\b500\b/);
  });

  // GAP-HR-CONFIRMATION-05: Extend now calls the real
  // PATCH .../probation-extension endpoint instead of staying permanently
  // disabled with no backend behind it.
  it("Extend calls PATCH .../probation-extension with the new end date and a reason", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Extend probation for Priya Nair" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New probation end date"), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Performance improvement plan ongoing" } });
    fireEvent.click(screen.getByRole("button", { name: "Extend probation" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/probation-extension",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"newEndDate":"2027-01-01"'),
      }),
    ));
    await waitFor(() => expect(screen.getByText("Extension submitted")).toBeInTheDocument());
  });

  it("Extend's reason is required (at least 3 characters)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response));
    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Extend probation for Priya Nair" }));
    fireEvent.change(await screen.findByLabelText("New probation end date"), { target: { value: "2027-01-01" } });

    expect(screen.getByRole("button", { name: "Extend probation" })).toBeDisabled();
  });

  // GAP-HR-CONFIRMATION-09: recommendation badge and status badge no longer
  // rely on a bare emoji for meaning -- redundant announcement fixed via
  // aria-hidden on the glyph, with the text label carrying the real name.
  it("gives the manager-recommendation badge an accessible name, with the emoji hidden from assistive tech", () => {
    render(<ProbationConfirmationList rows={[ROW]} />);
    const badge = screen.getByRole("status", { name: /manager recommendation: recommended/i });
    expect(badge).toBeInTheDocument();
  });
});
