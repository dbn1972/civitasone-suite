import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { RecordGpsForm } from "./RecordGpsForm";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("RecordGpsForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid vehicle ID and out-of-range coordinates", () => {
    render(<RecordGpsForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: "not-a-uuid" } });
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Position" }));

    expect(screen.getByText("Enter a valid vehicle ID (UUID).")).toBeInTheDocument();
  });

  it("records a GPS position (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: VALID_UUID, lat: 28.6, lng: 77.2, updatedAt: "2026-08-01T00:00:00.000Z" } }),
        { status: 200 },
      ),
    );

    render(<RecordGpsForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "28.6" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "77.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Position" }));

    await waitFor(() => {
      expect(screen.getByText(/Position recorded/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RecordGpsForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "28.6" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "77.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Position" }));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
