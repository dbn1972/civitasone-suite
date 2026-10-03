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

  it("surfaces a clerk-safe message on the confirm dialog, never a raw status code (UX-020)", async () => {
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
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-VEHICLES-05
  it("rejects a malformed registration number and accepts OD02AB1234", () => {
    render(<RegisterVehicleForm />);
    const reg = screen.getByLabelText(/^Registration No\./);
    fireEvent.change(reg, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Vehicle" }));
    expect(screen.getByText(/Enter a valid registration number/)).toBeInTheDocument();

    fireEvent.change(reg, { target: { value: "od 02-ab 1234" } });
    fireEvent.change(screen.getByLabelText(/^Make/), { target: { value: "Tata" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "Nexon" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Vehicle" }));
    expect(screen.queryByText(/Enter a valid registration number/)).not.toBeInTheDocument();
    expect(screen.getByText("Register this vehicle?")).toBeInTheDocument();
  });

  it("upper-cases and strips separators on blur, and posts the normalised plate", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "v" } }), { status: 202 }));
    render(<RegisterVehicleForm />);
    const reg = screen.getByLabelText(/^Registration No\./) as HTMLInputElement;
    fireEvent.change(reg, { target: { value: "od-02 ab1234" } });
    fireEvent.blur(reg);
    expect(reg.value).toBe("OD02AB1234");
    expect(screen.getByText("e.g. OD02AB1234")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Make/), { target: { value: "Tata" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "Nexon" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Vehicle" }));
    await screen.findByText("Register this vehicle?");
    fireEvent.click(screen.getByText("Register vehicle"));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(JSON.parse(String(spy.mock.calls[0]![1]!.body)).registrationNo).toBe("OD02AB1234");
  });

  it("surfaces the server's duplicate-registration message in the dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "DUPLICATE_REGISTRATION", message: "a vehicle with this registration number is already registered" }), { status: 409 }),
    );
    render(<RegisterVehicleForm />);
    fireEvent.change(screen.getByLabelText(/^Registration No\./), { target: { value: "OD02AB1234" } });
    fireEvent.change(screen.getByLabelText(/^Make/), { target: { value: "Tata" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "Nexon" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Vehicle" }));
    await screen.findByText("Register this vehicle?");
    fireEvent.click(screen.getByText("Register vehicle"));
    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-VEHICLES-04
  it("offers CNG (not Cng) in the fuel type dropdown", () => {
    render(<RegisterVehicleForm />);
    expect(screen.getByRole("option", { name: "CNG" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Cng" })).not.toBeInTheDocument();
  });
});
