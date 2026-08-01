import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssesseeCreateForm } from "./AssesseeCreateForm";

describe("AssesseeCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an owner/holder name before opening the confirm dialog", () => {
    render(<AssesseeCreateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Register Assessee" }));
    expect(screen.getByText("Owner / holder name is required.")).toBeInTheDocument();
  });

  it("registers an assessee on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "accepted" } }), { status: 202 }),
    );

    render(<AssesseeCreateForm />);
    fireEvent.change(screen.getByLabelText(/Owner \/ Holder Name/), { target: { value: "Ramesh Kumar" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Assessee" }));
    await waitFor(() => expect(screen.getByText("Register this assessee?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register assessee"));

    await waitFor(() => {
      expect(screen.getByText('Assessee "Ramesh Kumar" submitted for registration.')).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "name is required" } }), { status: 400 }),
    );

    render(<AssesseeCreateForm />);
    fireEvent.change(screen.getByLabelText(/Owner \/ Holder Name/), { target: { value: "Ramesh Kumar" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Assessee" }));
    await waitFor(() => expect(screen.getByText("Register this assessee?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register assessee"));

    await waitFor(() => {
      expect(screen.getByText(/VALIDATION_FAILED: name is required/)).toBeInTheDocument();
    });
  });
});
