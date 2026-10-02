import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { TelemetryForm } from "./TelemetryForm";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const OPTS = [{ id: VALID_UUID, label: "123456789012345 — DL01AB1234" }];

function fillValid() {
  fireEvent.change(screen.getByLabelText(/^Device/), { target: { value: VALID_UUID } });
  fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "28.6" } });
  fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "77.2" } });
  fireEvent.change(screen.getByLabelText(/^Speed/), { target: { value: "42" } });
  fireEvent.change(screen.getByLabelText(/^Heading/), { target: { value: "180" } });
}

describe("TelemetryForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an out-of-range heading", () => {
    render(<TelemetryForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Device/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "28.6" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "77.2" } });
    fireEvent.change(screen.getByLabelText(/^Speed/), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText(/^Heading/), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Log Telemetry" }));

    expect(screen.getByText("Heading must be a number between 0 and 360.")).toBeInTheDocument();
  });

  it("logs a telemetry reading (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { deviceId: VALID_UUID, received: true } }), { status: 202 }),
    );

    render(<TelemetryForm options={OPTS} />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Log Telemetry" }));

    await waitFor(() => {
      expect(screen.getByText(/Telemetry reading accepted/)).toBeInTheDocument();
    });
  });

  it("surfaces a clerk-safe message, never a raw status code (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<TelemetryForm options={OPTS} />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Log Telemetry" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-DEVICES-01
  it("chooses the device from a dropdown and posts to its telemetry path", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<TelemetryForm options={OPTS} />);
    expect((screen.getByLabelText(/^Device/) as HTMLElement).tagName).toBe("SELECT");
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Log Telemetry" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain(`v1/assets/fleet/devices/${VALID_UUID}/telemetry`);
    expect(await screen.findByText("Telemetry reading accepted for 123456789012345 — DL01AB1234.")).toBeInTheDocument();
  });

  it("disables the form's picker with an explanation when no devices exist", () => {
    render(<TelemetryForm options={[]} />);
    expect(screen.getByLabelText(/^Device/)).toBeDisabled();
    expect(screen.getByText(/No devices are registered yet/)).toBeInTheDocument();
  });
});
