import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewVehiclePage from "./page";

describe("NewVehiclePage — vehicle create (L1/L2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the vehicle to the real fleet endpoint on a valid submit", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "v1" }), { status: 202 }));

    render(<NewVehiclePage />);

    fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "DL 01 CA 1234" } });
    fireEvent.change(screen.getByLabelText(/Make .* model/), { target: { value: "Toyota Innova Crysta" } });
    fireEvent.change(screen.getByLabelText(/Fuel type/), { target: { value: "diesel" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("/estab/vehicles"));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toMatchObject({ regNo: "DL 01 CA 1234", makeModel: "Toyota Innova Crysta", fuelType: "diesel" });
      expect(body.allocatedTo).toBeUndefined();
    });
  });

  it("rejects an invalid allocated-to UUID without calling the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<NewVehiclePage />);

    fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "DL 01 CA 1234" } });
    fireEvent.change(screen.getByLabelText(/Make .* model/), { target: { value: "Toyota Innova" } });
    fireEvent.change(screen.getByLabelText(/Allocated to/), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
