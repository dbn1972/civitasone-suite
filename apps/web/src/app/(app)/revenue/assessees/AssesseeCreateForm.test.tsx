import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssesseeCreateForm } from "./AssesseeCreateForm";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Assessee Type/), { target: { value: "property" } });
  fireEvent.change(screen.getByLabelText(/Identifier No\./), { target: { value: "PROP-0099" } });
  fireEvent.change(screen.getByLabelText(/Owner \/ Holder Name/), { target: { value: "Ramesh Kumar" } });
  fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: "12 MG Road" } });
}

describe("AssesseeCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires assessee type, identifier, owner name, and address before opening the confirm dialog", () => {
    render(<AssesseeCreateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Register Assessee" }));
    expect(screen.getByText("Select an assessee type.")).toBeInTheDocument();
  });

  it("shows a DPDP purpose/consent note for contact PII (ASSESSEES-03)", () => {
    render(<AssesseeCreateForm />);
    expect(screen.getByText(/used only to send this assessee their bills/i)).toBeInTheDocument();
    expect(screen.getByText(/DPDP Act, 2023/)).toBeInTheDocument();
  });

  it("registers an assessee on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "accepted" } }), { status: 202 }),
    );

    render(<AssesseeCreateForm />);
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Register Assessee" }));
    await waitFor(() => expect(screen.getByText("Register this assessee?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register assessee"));

    await waitFor(() => {
      expect(screen.getByText('Assessee "Ramesh Kumar" submitted for registration.')).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "identifierNo is required" } }), { status: 400 }),
    );

    render(<AssesseeCreateForm />);
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Register Assessee" }));
    await waitFor(() => expect(screen.getByText("Register this assessee?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register assessee"));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/VALIDATION_FAILED: identifierNo is required/)).not.toBeInTheDocument();
  });
});
