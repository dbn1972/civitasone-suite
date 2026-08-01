import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FetchBillForm } from "./FetchBillForm";

describe("FetchBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires an assessee identifier before submitting", () => {
    render(<FetchBillForm />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch Bill" }));
    expect(screen.getByText(/Enter the assessee identifier/)).toBeInTheDocument();
  });

  it("submits the fetch-bill request (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { messageId: "msg-1" } }), { status: 202 }),
    );

    render(<FetchBillForm />);
    fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch Bill" }));

    await waitFor(() => {
      expect(screen.getByText(/message ID msg-1/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BBPS_DISABLED", message: "BBPS not enabled" } }), { status: 403 }),
    );

    render(<FetchBillForm />);
    fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch Bill" }));

    await waitFor(() => {
      expect(screen.getByText(/BBPS_DISABLED: BBPS not enabled/)).toBeInTheDocument();
    });
  });
});
