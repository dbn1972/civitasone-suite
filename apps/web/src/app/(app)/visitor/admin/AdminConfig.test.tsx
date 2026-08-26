import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const fetchConfigNamespaceMock = vi.fn();
const setConfigMock = vi.fn();
const applyPresetMock = vi.fn();
vi.mock("../_data/client", () => ({
  fetchConfigNamespace: (...args: unknown[]) => fetchConfigNamespaceMock(...args),
  setConfig: (...args: unknown[]) => setConfigMock(...args),
  applyPreset: (...args: unknown[]) => applyPresetMock(...args),
}));

import { AdminConfig } from "./AdminConfig";

describe("AdminConfig — numeric policy bounds", () => {
  beforeEach(() => {
    fetchConfigNamespaceMock.mockReset().mockResolvedValue([]);
    setConfigMock.mockReset();
  });

  it("renders native min/max on the overstay-escalation-hours input", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Escalate overstay after");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "168");
  });

  it("disables Save, flags aria-invalid and shows the valid range when the value is out of bounds", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Escalate overstay after");
    const row = input.closest("div")!.parentElement!;

    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByText("1–168")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("re-enables Save once the value is back in range", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
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
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Retain visitor PII");
    const row = input.closest("div")!.parentElement!;

    fireEvent.change(input, { target: { value: "-5" } });
    expect(screen.getByText("1–3650")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("allows 0 for the overstay-grace-period field (a grace window, not a strictly-positive deadline)", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Overstay grace period");
    const row = input.closest("div")!.parentElement!;

    expect(input).toHaveAttribute("min", "0");
    fireEvent.change(input, { target: { value: "0" } });
    expect(within(row).getByRole("button", { name: /Save/ })).not.toBeDisabled();
  });
});
