import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateDdoForm } from "./CreateDdoForm";

describe("CreateDdoForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires DDO code and name before opening the confirm dialog", () => {
    render(<CreateDdoForm />);
    fireEvent.click(screen.getByText("Save DDO"));
    expect(screen.getByText("DDO code and name are required.")).toBeInTheDocument();
  });

  it("saves a DDO on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ddoCode: "DDO02", name: "New DDO", departmentIds: [] }), { status: 201 }),
    );

    render(<CreateDdoForm />);
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO02" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "New DDO" } });
    fireEvent.click(screen.getByText("Save DDO"));

    await waitFor(() => expect(screen.getByText("Save this DDO?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm save"));

    await waitFor(() => {
      expect(screen.getByText(/DDO02 — New DDO saved/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateDdoForm />);
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO03" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Another DDO" } });
    fireEvent.click(screen.getByText("Save DDO"));

    await waitFor(() => expect(screen.getByText("Save this DDO?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm save"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
