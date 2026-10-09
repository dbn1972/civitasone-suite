import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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
  hostEmployeeId: "emp-9",
  locationId: "loc-1",
  checkInTime: new Date().toISOString(),
  validUntil: new Date(Date.now() + 3_600_000).toISOString(),
  overstay: false,
  evacuated: false,
};

const GATE_UUID = "11111111-1111-4111-8111-111111111111";

describe("GuardConsole", () => {
  beforeEach(() => {
    fetchRosterMock.mockReset();
    recordCheckInMock.mockReset();
    recordCheckOutMock.mockReset();
    verifyPassMock.mockReset();
    fetchRosterMock.mockResolvedValue([]);
    try { window.localStorage.clear(); } catch { /* ignore */ }
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
    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: GATE_UUID } });
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));

    await waitFor(() =>
      expect(verifyPassMock).toHaveBeenCalledWith({ gateId: GATE_UUID, qrToken: "qr-token-abc" }),
    );
    expect(await screen.findByText("Pass valid")).toBeInTheDocument();
    expect(screen.getByText("PASS-001")).toBeInTheDocument();
  });

  it("checks in a visitor after a valid verification and refreshes the roster", async () => {
    verifyPassMock.mockResolvedValue({ valid: true, passId: "pass-1", passNumber: "PASS-001" });
    recordCheckInMock.mockResolvedValue(undefined);
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);

    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: GATE_UUID } });
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));
    await screen.findByText("Pass valid");

    fetchRosterMock.mockResolvedValue([rosterEntry]);
    fireEvent.click(screen.getByRole("button", { name: /Admit & check in/i }));

    await waitFor(() => expect(recordCheckInMock).toHaveBeenCalledWith("pass-1", GATE_UUID));
    expect(await screen.findByText("✓ Checked in.")).toBeInTheDocument();
    // loadRoster is called once on mount and again after check-in.
    expect(fetchRosterMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a rejected pass without offering a check-in action", async () => {
    verifyPassMock.mockResolvedValue({ valid: false, code: "EXPIRED", message: "Pass has expired." });
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: GATE_UUID } });
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));

    expect(await screen.findByText("Pass not valid")).toBeInTheDocument();
    expect(screen.getByText(/Pass has expired\. \(EXPIRED\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Admit & check in/i })).not.toBeInTheDocument();
  });

  // GAP-VISITOR-GUARD-02: Check out is disabled until a valid gate UUID is set,
  // and never sends a blank gate; when it runs it passes the gate UUID.
  it("checks out a roster entry only after a valid gate id is entered", async () => {
    fetchRosterMock.mockResolvedValue([rosterEntry]);
    recordCheckOutMock.mockResolvedValue(undefined);
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    await screen.findByText("Asha Rao");

    // Blank gate => Check out disabled, nothing sent.
    expect(screen.getByRole("button", { name: "Check out" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: GATE_UUID } });
    expect(screen.getByRole("button", { name: "Check out" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    // GAP-VISITOR-GUARD-06: a confirm dialog gates the mutation.
    const dialog = await screen.findByRole("alertdialog", { name: "Check this visitor out?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(recordCheckOutMock).toHaveBeenCalledWith("pass-1", GATE_UUID));
  });

  // GAP-VISITOR-GUARD-02: an invalid (non-UUID) gate shows an inline error and
  // never calls verifyPass.
  it("rejects a non-UUID gate id with an inline error and does not verify", async () => {
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    await waitFor(() => expect(fetchRosterMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Gate terminal ID/i), { target: { value: "not-a-uuid" } });
    fireEvent.change(screen.getByLabelText(/Scanned pass token/i), { target: { value: "qr-token-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify pass" }));
    expect(screen.getByText(/must be a valid UUID/i)).toBeInTheDocument();
    expect(verifyPassMock).not.toHaveBeenCalled();
  });

  // GAP-VISITOR-GUARD-03 (DPDP): the visitor phone in Expected today is masked.
  it("masks the visitor phone in the Expected today table", async () => {
    const approved = {
      ...rosterEntry,
    };
    void approved;
    const req = {
      id: "vr-1",
      status: "approved" as const,
      purpose: "Meeting",
      scheduledAt: new Date().toISOString(),
      visitorName: "Priya Singh",
      visitorPhone: "9876543210",
      visitorEmail: null,
      hostEmployeeId: "emp-1",
      locationId: "loc-1",
      passType: "single",
      visitorCategory: "standard",
      permittedAreas: [],
      rejectionReason: null,
      trackingRef: null,
      createdAt: null,
    };
    render(<GuardConsole locations={[location]} expectedToday={[req]} expectedTodaySource="api" />);
    await waitFor(() => expect(fetchRosterMock).toHaveBeenCalled());
    expect(screen.getByText("Priya Singh")).toBeInTheDocument();
    // Full number must not appear; masked form (last 3 digits) does.
    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
  });

  it("shows a server-masked visitor phone verbatim (last 4 digits kept for verification)", async () => {
    const req = {
      id: "vr-1", status: "approved" as const, purpose: "Meeting", scheduledAt: new Date().toISOString(),
      visitorName: "Priya Singh", visitorPhone: "*********0001", visitorEmail: null, hostEmployeeId: "emp-1",
      locationId: "loc-1", passType: "single", visitorCategory: "standard", permittedAreas: [],
      rejectionReason: null, trackingRef: null, createdAt: null,
    };
    render(<GuardConsole locations={[location]} expectedToday={[req]} expectedTodaySource="api" />);
    await waitFor(() => expect(fetchRosterMock).toHaveBeenCalled());
    expect(screen.getByText("*********0001")).toBeInTheDocument();
  });

  // GAP-VISITOR-GUARD-05: Expected today is scoped to the selected location.
  it("lists only the selected location's expected visitors", async () => {
    const mk = (id: string, locationId: string, name: string) => ({
      id, status: "approved" as const, purpose: null, scheduledAt: new Date().toISOString(),
      visitorName: name, visitorPhone: "+910000000000", visitorEmail: null, hostEmployeeId: "e",
      locationId, passType: "single", visitorCategory: "standard", permittedAreas: [],
      rejectionReason: null, trackingRef: null, createdAt: null,
    });
    const locs = [location, { id: "loc-2", name: "Annexe", address: null, status: "active" }];
    render(
      <GuardConsole
        locations={locs}
        expectedToday={[mk("a", "loc-1", "Here Visitor"), mk("b", "loc-2", "Other Site Visitor")]}
        expectedTodaySource="api"
      />,
    );
    await waitFor(() => expect(fetchRosterMock).toHaveBeenCalled());
    expect(screen.getByText("Here Visitor")).toBeInTheDocument();
    expect(screen.queryByText("Other Site Visitor")).not.toBeInTheDocument();
  });

  // GAP-VISITOR-GUARD-04: overstay flag comes from the server (validUntil<now),
  // not a hard-coded 8h client threshold.
  it("flags an overstay from the server-computed flag", async () => {
    fetchRosterMock.mockResolvedValue([{ ...rosterEntry, overstay: true }]);
    render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
    expect(await screen.findByText("Overstay")).toBeInTheDocument();
  });

  describe("error vs. empty states (not conflated via a shared EmptyState)", () => {
    it("shows a retryable error state for expected-today when the load failed, distinct from a genuine empty result", async () => {
      render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="error" />);
      // Let the unrelated mount-time roster fetch settle before asserting, so
      // its state update isn't left dangling outside act().
      await waitFor(() => expect(fetchRosterMock).toHaveBeenCalledWith("loc-1"));

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("We couldn't load today's expected visitors.");
      expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByText("No approved visitors expected today")).not.toBeInTheDocument();
    });

    it("shows the genuine empty state (no alert) when expected-today loaded successfully with zero rows", async () => {
      render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
      await waitFor(() => expect(fetchRosterMock).toHaveBeenCalledWith("loc-1"));

      expect(screen.getByText("No approved visitors expected today")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows a retryable error state for the live roster on fetch failure, and recovers when retried", async () => {
      fetchRosterMock.mockRejectedValueOnce(new Error("Roster endpoint forbidden (403)"));
      render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Live roster unavailable.");
      expect(alert).toHaveTextContent("Roster endpoint forbidden (403)");
      expect(screen.queryByText("No one is currently inside")).not.toBeInTheDocument();

      fetchRosterMock.mockResolvedValueOnce([rosterEntry]);
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fetchRosterMock).toHaveBeenCalledTimes(2);
    });

    it("shows the genuine empty state (not an error) when the roster loads successfully with zero entries", async () => {
      fetchRosterMock.mockResolvedValue([]);
      render(<GuardConsole locations={[location]} expectedToday={[]} expectedTodaySource="api" />);
      expect(await screen.findByText("No one is currently inside")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
