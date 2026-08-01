import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { TelemetryForm } from "./TelemetryForm";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

function fillValid() {
  fireEvent.change(screen.getByLabelText(/^Device ID/), { target: { value: VALID_UUID } });
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
    render(<TelemetryForm />);
    fireEvent.change(screen.getByLabelText(/^Device ID/), { target: { value: VALID_UUID } });
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

    render(<TelemetryForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Log Telemetry" }));

    await waitFor(() => {
      expect(screen.getByText(/Telemetry reading accepted/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<TelemetryForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Log Telemetry" }));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
