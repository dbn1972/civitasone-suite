import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const applyPresetMock = vi.fn();
const deactivateConfigMock = vi.fn();
const fetchConfigNamespaceMock = vi.fn();
const setConfigMock = vi.fn();

vi.mock("../_data/client", () => ({
  applyPreset: (...a: unknown[]) => applyPresetMock(...a),
  deactivateConfig: (...a: unknown[]) => deactivateConfigMock(...a),
  fetchConfigNamespace: (...a: unknown[]) => fetchConfigNamespaceMock(...a),
  setConfig: (...a: unknown[]) => setConfigMock(...a),
}));

import { AdminConfig } from "./AdminConfig";
import type { ConfigEntry } from "../_data/types";
import { ENUM_NAMESPACE_KEYS, SLA_NS } from "../_data/policy";

function allApi(): Record<string, "api" | "error"> {
  return Object.fromEntries([...ENUM_NAMESPACE_KEYS, SLA_NS].map((n) => [n, "api"])) as Record<string, "api" | "error">;
}

function entry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return {
    id: "cfg-1",
    namespace: "case_type",
    configKey: "part_heard",
    value: { allowed: true },
    label: null,
    description: null,
    active: true,
    sortOrder: 0,
    version: 2,
    ...overrides,
  };
}

describe("AdminConfig", () => {
  beforeEach(() => {
    applyPresetMock.mockReset();
    deactivateConfigMock.mockReset();
    fetchConfigNamespaceMock.mockReset();
    setConfigMock.mockReset();
    fetchConfigNamespaceMock.mockResolvedValue([]);
  });

  it("ADMIN-01: a preset click opens a confirm dialog and sends nothing until confirmed", async () => {
    render(<AdminConfig initialEntries={[]} initialSources={allApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Revenue courts" }));
    // Dialog shown, no request yet.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(applyPresetMock).not.toHaveBeenCalled();
    // Cancel sends nothing.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(applyPresetMock).not.toHaveBeenCalled();
    // Re-open and confirm.
    fireEvent.click(screen.getByRole("button", { name: "Revenue courts" }));
    applyPresetMock.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }));
    await waitFor(() => expect(applyPresetMock).toHaveBeenCalledWith("revenue"));
  });

  it("ADMIN-02: retiring opens a confirm dialog; cancel makes no PATCH; last-value warning shown", async () => {
    render(
      <AdminConfig
        initialEntries={[entry({ id: "only", configKey: "interim" })]}
        initialSources={allApi()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retire interim" }));
    const dialog = screen.getByRole("alertdialog");
    // last active value of case_type (which HAS defaults) → defaults warning.
    expect(within(dialog).getByText(/last active value/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deactivateConfigMock).not.toHaveBeenCalled();
    // Confirm path.
    fireEvent.click(screen.getByRole("button", { name: "Retire interim" }));
    deactivateConfigMock.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Retire value" }));
    await waitFor(() => expect(deactivateConfigMock).toHaveBeenCalledWith("only", 2));
  });

  it("ADMIN-03: default pills are humanized (not snake_case)", () => {
    render(<AdminConfig initialEntries={[]} initialSources={allApi()} />);
    // case_type defaults include "revenue_appeal" → "Revenue appeal".
    expect(screen.getByText("Revenue appeal")).toBeInTheDocument();
    expect(screen.queryByText("revenue_appeal")).not.toBeInTheDocument();
  });

  it("ADMIN-03: adding a value with no label stores a humanized label", async () => {
    setConfigMock.mockResolvedValue(undefined);
    render(<AdminConfig initialEntries={[entry()]} initialSources={allApi()} />);
    const card = screen.getByText("Case types").closest(".card") as HTMLElement;
    fireEvent.change(within(card).getByLabelText("New Case types key"), { target: { value: "interim_order" } });
    fireEvent.click(within(card).getByRole("button", { name: "Add value" }));
    await waitFor(() => expect(setConfigMock).toHaveBeenCalled());
    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "case_type", configKey: "interim_order", label: "Interim order" }),
    );
  });

  it("ADMIN-04: a failed namespace shows a per-card error with retry and disables Add", () => {
    const sources = allApi();
    sources["case_type"] = "error";
    render(<AdminConfig initialEntries={[]} initialSources={sources} />);
    // Case types card shows the per-card error, not the defaults/add form.
    const card = screen.getByText("Case types").closest(".card") as HTMLElement;
    expect(within(card).getByRole("alert")).toHaveTextContent(/Could not load this list/i);
    expect(within(card).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Add value" })).not.toBeInTheDocument();
    // A healthy namespace still renders its editor.
    const partyCard = screen.getByText("Party roles").closest(".card") as HTMLElement;
    expect(within(partyCard).getByRole("button", { name: "Add value" })).toBeInTheDocument();
  });

  it("ADMIN-05: seeding the first value warns defaults will drop and can keep them", async () => {
    setConfigMock.mockResolvedValue(undefined);
    render(<AdminConfig initialEntries={[]} initialSources={allApi()} />);
    const card = screen.getByText("Case types").closest(".card") as HTMLElement;
    fireEvent.change(within(card).getByLabelText("New Case types key"), { target: { value: "special" } });
    expect(within(card).getByText(/will stop applying/i)).toBeInTheDocument();
    // Keep-defaults then add → defaults are persisted too.
    fireEvent.click(within(card).getByLabelText(/Also keep the defaults/i));
    fireEvent.click(within(card).getByRole("button", { name: "Add value" }));
    await waitFor(() => expect(setConfigMock).toHaveBeenCalled());
    const keys = setConfigMock.mock.calls.map((c) => (c[0] as { configKey: string }).configKey);
    expect(keys).toContain("special");
    expect(keys).toContain("civil"); // a default was also written
  });
});
