import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssessmentCreateForm } from "./AssessmentCreateForm";

const ASSESSEE_ID = "11111111-1111-1111-1111-111111111111";
const RATE_HEAD_ID = "22222222-2222-2222-2222-222222222222";

const ASSESSEES = [
  { id: ASSESSEE_ID, ownerName: "Ravi Kumar", identifierNo: "PMC-0001", assesseeType: "residential" },
];
const RATE_HEADS = [{ id: RATE_HEAD_ID, code: "PT", name: "Property Tax" }];

function renderForm() {
  return render(<AssessmentCreateForm assessees={ASSESSEES} rateHeads={RATE_HEADS} />);
}

function fillValidForm() {
  // GAP-REVENUE-ASSESSMENTS-02: no raw UUID typing — pick by name.
  fireEvent.change(screen.getByLabelText(/Assessee/), { target: { value: ASSESSEE_ID } });
  fireEvent.change(screen.getByLabelText(/Rate Head/), { target: { value: RATE_HEAD_ID } });
  fireEvent.change(screen.getByLabelText(/Financial Year/), { target: { value: "2026-27" } });
  fireEvent.change(screen.getByLabelText(/Base Value/), { target: { value: "850000" } });
}

describe("AssessmentCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("offers assessees and rate heads by name — no free-text UUID field (ADJUSTMENTS-02)", () => {
    renderForm();
    // Options are labelled by name, not UUID.
    expect(screen.getByRole("option", { name: "Ravi Kumar — PMC-0001" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Property Tax (PT)" })).toBeInTheDocument();
    // The pickers are <select>, not free-text inputs with UUID placeholders.
    expect((screen.getByLabelText(/Assessee/) as HTMLElement).tagName).toBe("SELECT");
    expect((screen.getByLabelText(/Rate Head/) as HTMLElement).tagName).toBe("SELECT");
  });

  it("validates the financial year format before opening the confirm dialog", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Assessee/), { target: { value: ASSESSEE_ID } });
    fireEvent.change(screen.getByLabelText(/Rate Head/), { target: { value: RATE_HEAD_ID } });
    fireEvent.change(screen.getByLabelText(/Financial Year/), { target: { value: "bad-fy" } });
    fireEvent.change(screen.getByLabelText(/Base Value/), { target: { value: "850000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
    expect(screen.getByText("Financial year must be in YYYY-YY format, e.g. 2026-27.")).toBeInTheDocument();
  });

  it("creates an assessment on confirm and names the assessee, not a UUID (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "accepted" } }), { status: 202 }),
    );

    renderForm();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
    await waitFor(() => expect(screen.getByText("Create this assessment?")).toBeInTheDocument());
    // Confirm dialog names the owner, not the raw UUID (appears in option + dialog).
    expect(screen.getAllByText("Ravi Kumar — PMC-0001").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText("Create assessment"));

    await waitFor(() => {
      expect(screen.getByText(/Assessment for FY 2026-27 submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "rateHeadId not found" } }), { status: 400 }),
    );

    renderForm();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
    await waitFor(() => expect(screen.getByText("Create this assessment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create assessment"));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/VALIDATION_FAILED: rateHeadId not found/)).not.toBeInTheDocument();
  });
});
