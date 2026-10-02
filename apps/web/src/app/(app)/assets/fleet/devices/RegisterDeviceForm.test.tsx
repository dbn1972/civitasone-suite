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
    fireEvent.change(screen.getByLabelText(/^Device IMEI/), { target: { value: "490154203237518" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));

    await waitFor(() => expect(screen.getByText("Register this device?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register device"));

    await waitFor(() => {
      expect(screen.getByText(/registered/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe message on the confirm dialog, never a raw status code (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RegisterDeviceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Device IMEI/), { target: { value: "490154203237518" } });

    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));
    await waitFor(() => expect(screen.getByText("Register this device?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register device"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-DEVICES-06
  it("rejects a non-digit IMEI and an IMEI that fails the checksum", () => {
    render(<RegisterDeviceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    const imei = screen.getByLabelText(/^Device IMEI/);
    fireEvent.change(imei, { target: { value: "abcdefghijklmno" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));
    expect(screen.getByText("IMEI must be 15 digits and pass the checksum.")).toBeInTheDocument();

    fireEvent.change(imei, { target: { value: "490154203237519" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));
    expect(screen.getByText("IMEI must be 15 digits and pass the checksum.")).toBeInTheDocument();
    expect(screen.queryByText("Register this device?")).not.toBeInTheDocument();
  });

  it("rejects an ICCID with letters but treats it as optional when blank", () => {
    render(<RegisterDeviceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Device IMEI/), { target: { value: "490154203237518" } });
    fireEvent.change(screen.getByLabelText(/^SIM ICCID/), { target: { value: "89910000000000000AB" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));
    expect(screen.getByText("SIM ICCID must be 19 or 20 digits.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^SIM ICCID/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));
    expect(screen.getByText("Register this device?")).toBeInTheDocument();
  });
});
