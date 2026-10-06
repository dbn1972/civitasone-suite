import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const fetchConfigNamespaceMock = vi.fn();
const setConfigMock = vi.fn();
const applyPresetMock = vi.fn();
vi.mock("../_data/client", async () => {
  const actual = await vi.importActual<typeof import("../_data/client")>("../_data/client");
  return {
    ...actual,
    fetchConfigNamespace: (...args: unknown[]) => fetchConfigNamespaceMock(...args),
    setConfig: (...args: unknown[]) => setConfigMock(...args),
    applyPreset: (...args: unknown[]) => applyPresetMock(...args),
  };
});

import { AdminConfig } from "./AdminConfig";

describe("AdminConfig — numeric policy bounds", () => {
  beforeEach(() => {
    fetchConfigNamespaceMock.mockReset().mockResolvedValue([]);
    setConfigMock.mockReset().mockResolvedValue(undefined);
    applyPresetMock.mockReset().mockResolvedValue(undefined);
  });

  it("renders native min/max on the overstay-escalation-hours input", () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    const input = screen.getByLabelText("Escalate overstay after");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "168");
  });

  it("disables Save, flags aria-invalid and shows the valid range when the value is out of bounds", () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    const input = screen.getByLabelText("Escalate overstay after");
    const row = input.closest("div")!.parentElement!;

    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByText("1–168")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("re-enables Save once the value is back in range", () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    const input = screen.getByLabelText("Escalate overstay after");
    const row = input.closest("div")!.parentElement!;

    fireEvent.change(input, { target: { value: "999999" } });
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();

    fireEvent.change(input, { target: { value: "48" } });
    expect(screen.queryByText("1–168")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(within(row).getByRole("button", { name: /Save/ })).not.toBeDisabled();
  });

  it("rejects a negative value on a policy field with a positive minimum", () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    const input = screen.getByLabelText("Retain visitor PII");
    const row = input.closest("div")!.parentElement!;

    fireEvent.change(input, { target: { value: "-5" } });
    expect(screen.getByText("1–3650")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("allows 0 for the overstay-grace-period field (a grace window, not a strictly-positive deadline)", () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    const input = screen.getByLabelText("Overstay grace period");
    const row = input.closest("div")!.parentElement!;

    expect(input).toHaveAttribute("min", "0");
    fireEvent.change(input, { target: { value: "0" } });
    expect(within(row).getByRole("button", { name: /Save/ })).not.toBeDisabled();
  });
});

describe("AdminConfig — confirmations, drafts and degraded state", () => {
  beforeEach(() => {
    fetchConfigNamespaceMock.mockReset().mockResolvedValue([]);
    setConfigMock.mockReset().mockResolvedValue(undefined);
    applyPresetMock.mockReset().mockResolvedValue(undefined);
  });

  // GAP-VISITOR-ADMIN-01: a preset opens a confirm dialog and only POSTs after
  // a reason is entered.
  it("applies a preset only after confirming with a reason", async () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Secretariat" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Apply the Secretariat preset\?/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Apply preset" });
    expect(confirm).toBeDisabled();
    expect(applyPresetMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Onboarding this office." } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(applyPresetMock).toHaveBeenCalledWith("secretariat", "Onboarding this office."));
  });

  // GAP-VISITOR-ADMIN-03: a security-relevant boolean (auto-approve VIP) is a
  // switch and requires a confirm+reason; setConfig fires only after confirm.
  it("confirms an auto-approve VIP toggle with a reason before saving", async () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    const sw = screen.getByRole("switch", { name: "Auto-approve VIP" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);

    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Turn on" });
    expect(confirm).toBeDisabled();
    expect(setConfigMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "VIP delegation week." } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(setConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: "visitor_approval", configKey: "vip", value: { autoApprove: true }, reason: "VIP delegation week." }),
      ),
    );
  });

  // GAP-VISITOR-ADMIN-04: a typed draft is cleared after a successful reload so
  // it never lingers over a new value.
  it("clears a typed draft after a successful save", async () => {
    render(<AdminConfig initialEntries={[]} policySource="api" approvalSource="api" />);
    const input = screen.getByLabelText("Escalate overstay after") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "48" } });
    expect(input.value).toBe("48");
    const row = input.closest("div")!.parentElement!;
    fireEvent.click(within(row).getByRole("button", { name: /Save/ }));

    // After save + reload (empty namespace), the draft is dropped and the field
    // falls back to the default (1).
    await waitFor(() => expect((screen.getByLabelText("Escalate overstay after") as HTMLInputElement).value).toBe("1"));
  });

  // GAP-VISITOR-ADMIN-05: when ONLY the policy namespace fails, policy groups
  // show a retry state (no editable inputs) while approval groups stay editable.
  it("shows a per-group retry state for a failed namespace and keeps the other editable", () => {
    render(<AdminConfig initialEntries={[]} policySource="error" approvalSource="api" />);
    // A policy group ("Data retention & privacy") shows retry, not an input.
    expect(screen.getByText(/couldn't load the “Data retention & privacy” settings/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Retain visitor PII")).not.toBeInTheDocument();
    // The approval group stays editable.
    expect(screen.getByRole("switch", { name: "Auto-approve VIP" })).toBeInTheDocument();
    // Not the both-failed empty state.
    expect(screen.queryByText("Showing default policy")).not.toBeInTheDocument();
  });

  it("shows the both-failed empty state only when both namespaces fail", () => {
    render(<AdminConfig initialEntries={[]} policySource="error" approvalSource="error" />);
    expect(screen.getByText("Showing default policy")).toBeInTheDocument();
  });
});
