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

describe("AdminConfig — numeric policy bounds (GAP-MEETING-ADMIN-06)", () => {
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

  it("shows the allowed range BEFORE any out-of-range entry", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    // Range helper is visible by default for every number field.
    expect(screen.getAllByText(/Allowed: 1–2160 hours/).length).toBeGreaterThan(0);
  });

  it("disables Save and shows a full-sentence error when out of bounds", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Escalate to supervisor after");
    const row = input.closest("div")!.parentElement!;
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByText("Enter a value between 1 and 2160 hours.")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("re-enables Save once the value is back in range", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Escalate to supervisor after");
    const row = input.closest("div")!.parentElement!;
    fireEvent.change(input, { target: { value: "999999" } });
    expect(within(row).getByRole("button", { name: /Save/ })).toBeDisabled();
    fireEvent.change(input, { target: { value: "48" } });
    expect(within(row).getByRole("button", { name: /Save/ })).not.toBeDisabled();
  });

  it("allows 0 for the alert-lead-days field", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const input = screen.getByLabelText("Minutes deadline alert lead");
    expect(input).toHaveAttribute("min", "0");
    fireEvent.change(input, { target: { value: "0" } });
    const row = input.closest("div")!.parentElement!;
    expect(within(row).getByRole("button", { name: /Save/ })).not.toBeDisabled();
  });
});

describe("AdminConfig — preset confirmation (GAP-MEETING-ADMIN-01)", () => {
  beforeEach(() => {
    fetchConfigNamespaceMock.mockReset().mockResolvedValue([]);
    applyPresetMock.mockReset().mockResolvedValue(undefined);
  });

  it("does not apply a preset until the confirmation is accepted", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Board of directors" }));
    expect(applyPresetMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/overwrites all \d+ tenant policy values/)).toBeInTheDocument();
  });

  it("applies the preset only after confirming", async () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Municipal council" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Overwrite and apply" }));
    await vi.waitFor(() => expect(applyPresetMock).toHaveBeenCalledWith("municipal-council"));
  });
});

describe("AdminConfig — committee-type switch (GAP-MEETING-ADMIN-03/04)", () => {
  beforeEach(() => {
    fetchConfigNamespaceMock.mockReset().mockResolvedValue([]);
    setConfigMock.mockReset().mockResolvedValue(undefined);
  });

  it("renders committee-type toggles as accessible switches with aria-checked", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    const sw = screen.getByRole("switch", { name: "Standing committees" });
    // Defaults to true (default set all-on).
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("turning a committee type OFF requires confirmation (does not save immediately)", () => {
    render(<AdminConfig initialEntries={[]} initialSource="api" />);
    fireEvent.click(screen.getByRole("switch", { name: "Standing committees" }));
    expect(setConfigMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("warns about all-off = all-permitted when turning off the last enabled type", () => {
    // Only one type enabled; the rest off.
    const entries = [
      { id: "1", namespace: "meeting_committee_types", configKey: "standing", value: { allowed: true }, label: null, description: null, active: true, sortOrder: 0, version: 1 },
      { id: "2", namespace: "meeting_committee_types", configKey: "ad_hoc", value: { allowed: false }, label: null, description: null, active: true, sortOrder: 0, version: 1 },
      { id: "3", namespace: "meeting_committee_types", configKey: "statutory", value: { allowed: false }, label: null, description: null, active: true, sortOrder: 0, version: 1 },
      { id: "4", namespace: "meeting_committee_types", configKey: "board", value: { allowed: false }, label: null, description: null, active: true, sortOrder: 0, version: 1 },
    ];
    render(<AdminConfig initialEntries={entries} initialSource="api" />);
    fireEvent.click(screen.getByRole("switch", { name: "Standing committees" }));
    expect(screen.getByText(/permits EVERY committee type by default/)).toBeInTheDocument();
  });
});
