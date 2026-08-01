import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssessmentCreateForm } from "./AssessmentCreateForm";

const ASSESSEE_ID = "11111111-1111-1111-1111-111111111111";
const RATE_HEAD_ID = "22222222-2222-2222-2222-222222222222";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Assessee ID/), { target: { value: ASSESSEE_ID } });
  fireEvent.change(screen.getByLabelText(/Rate Head ID/), { target: { value: RATE_HEAD_ID } });
  fireEvent.change(screen.getByLabelText(/Financial Year/), { target: { value: "2026-27" } });
  fireEvent.change(screen.getByLabelText(/Base Value/), { target: { value: "850000" } });
}

describe("AssessmentCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("validates the financial year format before opening the confirm dialog", () => {
    render(<AssessmentCreateForm />);
    fireEvent.change(screen.getByLabelText(/Assessee ID/), { target: { value: ASSESSEE_ID } });
    fireEvent.change(screen.getByLabelText(/Rate Head ID/), { target: { value: RATE_HEAD_ID } });
    fireEvent.change(screen.getByLabelText(/Financial Year/), { target: { value: "bad-fy" } });
    fireEvent.change(screen.getByLabelText(/Base Value/), { target: { value: "850000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
    expect(screen.getByText("Financial year must be in YYYY-YY format, e.g. 2026-27.")).toBeInTheDocument();
  });

  it("creates an assessment on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "accepted" } }), { status: 202 }),
    );

    render(<AssessmentCreateForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
    await waitFor(() => expect(screen.getByText("Create this assessment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create assessment"));

    await waitFor(() => {
      expect(screen.getByText(/Assessment for FY 2026-27 submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "rateHeadId not found" } }), { status: 400 }),
    );

    render(<AssessmentCreateForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
    await waitFor(() => expect(screen.getByText("Create this assessment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create assessment"));

    await waitFor(() => {
      expect(screen.getByText(/VALIDATION_FAILED: rateHeadId not found/)).toBeInTheDocument();
    });
  });
});
