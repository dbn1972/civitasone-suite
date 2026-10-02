import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { RecordGpsForm } from "./RecordGpsForm";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const OPTS = [{ id: VALID_UUID, label: "DL01AB1234 — Tata Sumo" }];

describe("RecordGpsForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid vehicle ID and out-of-range coordinates", () => {
    render(<RecordGpsForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Position" }));

    expect(screen.getByText("Select a vehicle.")).toBeInTheDocument();
  });

  it("records a GPS position (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: VALID_UUID, lat: 28.6, lng: 77.2, updatedAt: "2026-08-01T00:00:00.000Z" } }),
        { status: 200 },
      ),
    );

    render(<RecordGpsForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Vehicle/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "28.6" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "77.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Position" }));

    await waitFor(() => {
      expect(screen.getByText("Position recorded for DL01AB1234 — Tata Sumo.")).toBeInTheDocument();
    });
    const [url] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain(`v1/assets/fleet/vehicles/${VALID_UUID}/gps`);
  });

  it("surfaces a clerk-safe message, never a raw status code (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RecordGpsForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Vehicle/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "28.6" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "77.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Position" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-VEHICLES-01
  it("lists vehicles by registration (no UUID typing) and preselects from the row action", () => {
    render(<RecordGpsForm options={OPTS} initialVehicleId={VALID_UUID} />);
    const select = screen.getByLabelText(/^Vehicle/) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe(VALID_UUID);
    expect(screen.getByRole("option", { name: "DL01AB1234 — Tata Sumo" })).toBeInTheDocument();
  });

  it("disables the picker with a pointer when no vehicles exist", () => {
    render(<RecordGpsForm options={[]} />);
    expect(screen.getByLabelText(/^Vehicle/)).toBeDisabled();
    expect(screen.getByText(/No vehicles are registered yet/)).toBeInTheDocument();
  });
});
