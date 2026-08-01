import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RegisterVehicleForm } from "./RegisterVehicleForm";

describe("RegisterVehicleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires registration number, make, and model before opening the confirm dialog", () => {
    render(<RegisterVehicleForm />);
    fireEvent.click(screen.getByRole("button", { name: "Register Vehicle" }));
    expect(screen.getByText("Registration number is required.")).toBeInTheDocument();
  });

  it("registers a vehicle on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "veh-1", status: "accepted" } }), { status: 202 }),
    );

    render(<RegisterVehicleForm />);
    fireEvent.change(screen.getByLabelText(/^Registration No\./), { target: { value: "DL01AB1234" } });
    fireEvent.change(screen.getByLabelText(/^Make/), { target: { value: "Tata" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "Nexon" } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: "2023" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Vehicle" }));

    await waitFor(() => expect(screen.getByText("Register this vehicle?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register vehicle"));

    await waitFor(() => {
      expect(screen.getByText(/registered/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RegisterVehicleForm />);
    fireEvent.change(screen.getByLabelText(/^Registration No\./), { target: { value: "DL01AB1234" } });
    fireEvent.change(screen.getByLabelText(/^Make/), { target: { value: "Tata" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "Nexon" } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: "2023" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Vehicle" }));
    await waitFor(() => expect(screen.getByText("Register this vehicle?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register vehicle"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
