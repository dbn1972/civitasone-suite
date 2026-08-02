import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const fetchRosterMock = vi.fn();
const recordCheckInMock = vi.fn();
const recordCheckOutMock = vi.fn();
const verifyPassMock = vi.fn();

vi.mock("../_data/client", () => ({
  fetchRoster: (...args: unknown[]) => fetchRosterMock(...args),
  recordCheckIn: (...args: unknown[]) => recordCheckInMock(...args),
  recordCheckOut: (...args: unknown[]) => recordCheckOutMock(...args),
  verifyPass: (...args: unknown[]) => verifyPassMock(...args),
}));

import { GuardConsole } from "./GuardConsole";
import type { RosterEntry, VisitorLocation } from "../_data/types";

const location: VisitorLocation = {
  id: "loc-1",
  name: "HQ Reception",
  address: "1 Main St",
  status: "active",
};

const rosterEntry: RosterEntry = {
  passId: "pass-1",
  visitorName: "Asha Rao",
  hostName: "Dev Kumar",
  checkInTime: new Date().toISOString(),
  lastKnownGate: "gate-1",
  contactNumber: "+911234500000",
  evacuated: false,
};

describe("GuardConsole", () => {
  beforeEach(() => {
    fetchRosterMock.mockReset();
    recordCheckInMock.mockReset();
    recordCheckOutMock.mockReset();
    verifyPassMock.mockReset();
    fetchRosterMock.mockResolvedValue([]);
  });

  it("loads the roster for the selected location on mount", async () => {
    fetchRosterMock.mockResolvedValue([rosterEntry]);
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    await waitFor(() => expect(fetchRosterMock).toHaveBeenCalledWith("loc-1"));
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
  });

  it("shows a validation error and does not call verifyPass when the gate ID is missing", async () => {
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    await waitFor(() => expect(fetchRosterMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter both the gate ID/i);
    expect(verifyPassMock).not.toHaveBeenCalled();
  });

  it("verifies a pass at the gate (happy path) and surfaces the result", async () => {
    verifyPassMock.mockResolvedValue({
      valid: true,
      passId: "pass-1",
      passNumber: "PASS-001",
      passType: "single",
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: "gate-1" } });
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));

    await waitFor(() =>
      expect(verifyPassMock).toHaveBeenCalledWith({ gateId: "gate-1", qrToken: "qr-token-abc" }),
    );
    expect(await screen.findByText("Pass valid")).toBeInTheDocument();
    expect(screen.getByText("PASS-001")).toBeInTheDocument();
  });

  it("checks in a visitor after a valid verification and refreshes the roster", async () => {
    verifyPassMock.mockResolvedValue({ valid: true, passId: "pass-1", passNumber: "PASS-001" });
    recordCheckInMock.mockResolvedValue(undefined);
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);

    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: "gate-1" } });
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));
    await screen.findByText("Pass valid");

    fetchRosterMock.mockResolvedValue([rosterEntry]);
    fireEvent.click(screen.getByRole("button", { name: /Admit & check in/i }));

    await waitFor(() => expect(recordCheckInMock).toHaveBeenCalledWith("pass-1", "gate-1"));
    expect(await screen.findByText("✓ Checked in.")).toBeInTheDocument();
    // loadRoster is called once on mount and again after check-in.
    expect(fetchRosterMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a rejected pass without offering a check-in action", async () => {
    verifyPassMock.mockResolvedValue({ valid: false, code: "EXPIRED", message: "Pass has expired." });
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: "gate-1" } });
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));

    expect(await screen.findByText("Pass not valid")).toBeInTheDocument();
    expect(screen.getByText(/Pass has expired\. \(EXPIRED\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Admit & check in/i })).not.toBeInTheDocument();
  });

  it("checks out a roster entry", async () => {
    fetchRosterMock.mockResolvedValue([rosterEntry]);
    recordCheckOutMock.mockResolvedValue(undefined);
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    await screen.findByText("Asha Rao");

    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(recordCheckOutMock).toHaveBeenCalledWith("pass-1", ""));
  });
});
