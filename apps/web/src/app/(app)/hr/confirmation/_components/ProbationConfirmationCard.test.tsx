import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProbationConfirmationList, type ConfirmationRow } from "./ProbationConfirmationCard";

const ROW: ConfirmationRow = {
  id: "emp-1",
  employee: "Priya Nair",
  joiningDate: "2024-01-01",
  probationEnd: "2026-01-01",
  dueDate: "2026-01-15",
  managerRecommendation: "recommended",
  status: "on_probation",
};

describe("ProbationConfirmationCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires confirmation and actually calls PATCH .../confirm, instead of only flipping local state", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));

    // Must ask before doing anything irreversible-looking.
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/confirm",
      expect.objectContaining({ method: "PATCH" }),
    ));
    await waitFor(() => expect(screen.getByText("✅ Confirmed")).toBeInTheDocument());
  });

  // UX-016: this used to show the raw backend response text ("not
  // authorised") verbatim — the same class of leak useFormError closes
  // fleet-wide (UX-003). It must now show the catalogued clerk-safe message
  // instead, never the raw server text.
  it("surfaces a clerk-safe failure message instead of showing Confirmed anyway", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "not authorised" }) as Response));
    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm service" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/not authorised/i)).not.toBeInTheDocument();
    expect(screen.queryByText("✅ Confirmed")).not.toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code on a plain-text failure with no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }) as Response));
    render(<ProbationConfirmationList rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm service" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });

  it("Extend is disabled rather than faking a local-only state change (no backend endpoint exists for it)", () => {
    render(<ProbationConfirmationList rows={[ROW]} />);
    expect(screen.getByRole("button", { name: /extend probation for priya nair/i })).toBeDisabled();
  });
});
