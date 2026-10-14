import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import NewVehiclePage from "./page";

function okResponse(status = 202) {
  return new Response(JSON.stringify({ id: "v1" }), { status });
}

describe("NewVehiclePage — vehicle create", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("POSTs the vehicle (no allocatedTo when the picker is empty) and redirects + revalidates", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());

    render(<NewVehiclePage />);
    fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "dl 01 ca 1234" } });
    fireEvent.change(screen.getByLabelText(/Make & model/), { target: { value: "Toyota Innova Crysta" } });
    fireEvent.change(screen.getByLabelText(/Fuel type/), { target: { value: "diesel" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("/estab/vehicles"));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      // regNo is normalised to upper-case.
      expect(body).toMatchObject({ regNo: "DL 01 CA 1234", makeModel: "Toyota Innova Crysta", fuelType: "diesel" });
      expect(body.allocatedTo).toBeUndefined();
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("/estab/vehicles?added=")));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("GAP-ESTAB-VEHICLES-NEW-04: empty submit shows per-field errors, focuses Reg no, sets aria-invalid, and makes no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewVehiclePage />);

    fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));

    expect(await screen.findByText("Registration number is required.")).toBeTruthy();
    expect(screen.getByText("Make & model is required.")).toBeTruthy();
    const regNo = screen.getByLabelText(/Registration number/);
    expect(regNo).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(regNo);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The input points at its message through aria-describedby (GAP-ESTAB-VEHICLES-NEW-04).
    const describedBy = regNo.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(" ")[0]!)?.textContent).toContain("Registration number is required.");
  });

  it("GAP-ESTAB-VEHICLES-NEW-03: double-click fires only one POST (no duplicate registration)", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((res) => { resolveFetch = res; }),
    );
    render(<NewVehiclePage />);
    fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "DL 01 CA 1234" } });
    fireEvent.change(screen.getByLabelText(/Make & model/), { target: { value: "Toyota Innova" } });

    const btn = screen.getByRole("button", { name: "Add Vehicle" });
    fireEvent.click(btn);
    fireEvent.click(btn); // second click while first is in-flight
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveFetch(okResponse());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it("GAP-ESTAB-VEHICLES-NEW-03: the error banner stays visible (not auto-dismissed) after 6s", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
      render(<NewVehiclePage />);
      fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "DL 01 CA 1234" } });
      fireEvent.change(screen.getByLabelText(/Make & model/), { target: { value: "Toyota Innova" } });
      fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));

      await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      await vi.advanceTimersByTimeAsync(6000);
      expect(screen.getByRole("alert")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a clerk-safe message, never the raw backend text/status, when the create POST fails (UX-016)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("regNo already registered to another vehicle", { status: 409 }),
    );
    render(<NewVehiclePage />);
    fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "DL 01 CA 1234" } });
    fireEvent.change(screen.getByLabelText(/Make & model/), { target: { value: "Toyota Innova" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/changed by someone else|try again/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/already registered/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b409\b/);
  });

  it("GAP-ESTAB-VEHICLES-NEW-01: Given an electric vehicle, Then the POST carries exactly the keys the service validates and fuelType 'ev'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    render(<NewVehiclePage />);
    fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "dl 02 ev 9" } });
    fireEvent.change(screen.getByLabelText(/Make & model/), { target: { value: "Tata Nexon EV" } });
    fireEvent.change(screen.getByLabelText(/Fuel type/), { target: { value: "ev" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("/estab/vehicles"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ regNo: "DL 02 EV 9", makeModel: "Tata Nexon EV", fuelType: "ev" });
    });
  });

  it("GAP-ESTAB-VEHICLES-NEW-01: the fuel options are labelled and carry the service's values", () => {
    render(<NewVehiclePage />);
    const fuel = screen.getByLabelText(/Fuel type/) as HTMLSelectElement;
    expect(Array.from(fuel.options).map((o) => [o.value, o.textContent])).toEqual([
      ["petrol", "Petrol"], ["diesel", "Diesel"], ["cng", "CNG"], ["ev", "Electric (EV)"],
    ]);
  });

  it("GAP-ESTAB-VEHICLES-NEW-02: choosing an officer from the picker submits their id as allocatedTo, and no field asks for a typed UUID", async () => {
    const OFFICER = "88888888-cccc-4000-8000-000000000002";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/hrms/employees")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: OFFICER, name: "A. Kumar", department: "Admin" }] }), { status: 200 }));
      }
      return Promise.resolve(init?.method === "POST" ? okResponse() : new Response("{}", { status: 200 }));
    });
    render(<NewVehiclePage />);
    fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: "DL 01 CA 1" } });
    fireEvent.change(screen.getByLabelText(/Make & model/), { target: { value: "Maruti Ertiga" } });
    const picker = screen.getByRole("combobox", { name: /Allocated to/i });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "kum" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /A\. Kumar/ }));
    expect(document.body.textContent).not.toContain(OFFICER);
    fireEvent.click(screen.getByRole("button", { name: "Add Vehicle" }));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ regNo: "DL 01 CA 1", makeModel: "Maruti Ertiga", fuelType: "petrol", allocatedTo: OFFICER });
    });
  });
});
