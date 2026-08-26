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

describe("AdminConfig — numeric policy bounds (fix 6)", () => {
  beforeEach(() => {
    fetchConfigNamespaceMock.mockReset().mockResolvedValue([]);
    setConfigMock.mockReset();
  });

  it("renders native min/max on the escalation-hours input", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Escalate to supervisor after");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "2160");
  });

  it("disables Save and shows the valid range when the value is out of bounds", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Escalate to supervisor after");
    const row = input.closest("div")!.parentElement!;

    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByText("1–2160")).toBeInTheDocument();
    const saveBtn = within(row).getByRole("button", { name: /Save/ });
    expect(saveBtn).toBeDisabled();
  });

  it("re-enables Save once the value is back in range", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Escalate to supervisor after");
    const row = input.closest("div")!.parentElement!;

    fireEvent.change(input, { target: { value: "999999" } });
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();

    fireEvent.change(input, { target: { value: "48" } });
    expect(screen.queryByText("1–2160")).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Save/ })).not.toBeDisabled();
  });

  it("allows 0 for the alert-lead-days field (not a strictly-positive deadline)", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Minutes deadline alert lead");
    expect(input).toHaveAttribute("min", "0");
    fireEvent.change(input, { target: { value: "0" } });
    const row = input.closest("div")!.parentElement!;
    expect(within(row).getByRole("button", { name: /Save/ })).not.toBeDisabled();
  });
});
