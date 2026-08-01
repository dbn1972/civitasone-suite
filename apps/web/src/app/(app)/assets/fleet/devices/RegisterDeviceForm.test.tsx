import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RegisterDeviceForm } from "./RegisterDeviceForm";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("RegisterDeviceForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid vehicle ID and a 15-character IMEI", () => {
    render(<RegisterDeviceForm />);
    fireEvent.change(screen.getByLabelText(/^Device IMEI/), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));
    expect(screen.getByText("Enter a valid vehicle ID (UUID).")).toBeInTheDocument();
  });

  it("registers a device on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "dev-1", status: "registered" } }), { status: 202 }),
    );

    render(<RegisterDeviceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Device IMEI/), { target: { value: "123456789012345" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));

    await waitFor(() => expect(screen.getByText("Register this device?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register device"));

    await waitFor(() => {
      expect(screen.getByText(/registered/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RegisterDeviceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Device IMEI/), { target: { value: "123456789012345" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));
    await waitFor(() => expect(screen.getByText("Register this device?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register device"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
