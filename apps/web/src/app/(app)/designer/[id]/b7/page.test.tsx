import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// GAP-DESIGNER-DETAIL-B7-01: B7 has one validity editor and one PATCH path.
const updateServiceDefinition = vi.fn();
const fetchServiceDefinition = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "def-b7" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as never}</a>,
}));
vi.mock("../../_data/designerApi", async () => {
  const actual = await vi.importActual<typeof import("../../_data/designerApi")>("../../_data/designerApi");
  return {
    ...actual,
    fetchServiceDefinition: (...a: unknown[]) => fetchServiceDefinition(...a),
    updateServiceDefinition: (...a: unknown[]) => updateServiceDefinition(...a),
  };
});
vi.mock("../../_data/formBuilderApi", () => ({
  loadFormDesign: vi.fn().mockResolvedValue({ fields: {} }),
}));
vi.mock("../../_data/issuanceBuilderApi", async () => {
  const actual = await vi.importActual<typeof import("../../_data/issuanceBuilderApi")>("../../_data/issuanceBuilderApi");
  return { ...actual, fetchTenantPositions: vi.fn().mockResolvedValue([]) };
});

import DesignerB7Page from "./page";

function def(over: Record<string, unknown> = {}) {
  return {
    id: "def-b7",
    serviceKey: "tl",
    name: "Trade Licence",
    version: 1,
    status: "draft",
    servicePattern: "certificate",
    channels: [],
    outputs: [],
    renewalPolicy: null,
    ...over,
  };
}

describe("B7 page validity editing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateServiceDefinition.mockReset().mockResolvedValue(undefined);
    fetchServiceDefinition.mockReset().mockResolvedValue(def());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openValidityTab() {
    render(<DesignerB7Page />);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.click(screen.getByRole("tab", { name: "Validity" }));
  }

  it("renders a single Validity & renewal editor", async () => {
    await openValidityTab();
    expect(screen.getAllByText("Validity & renewal")).toHaveLength(1);
  });

  it("saves outputs and the derived renewalPolicy in one PATCH", async () => {
    await openValidityTab();
    fireEvent.click(screen.getByLabelText("No expiry"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(updateServiceDefinition).toHaveBeenCalledTimes(1);
    const body = updateServiceDefinition.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.outputs).toBeTruthy();
    expect(body.renewalPolicy).toMatchObject({ validityMode: "none", renewable: false });
  });

  it("shows offline when the PATCH fails", async () => {
    updateServiceDefinition.mockRejectedValue(new Error("boom"));
    await openValidityTab();
    fireEvent.click(screen.getByLabelText("No expiry"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });

  it("loads the stored runtime policy into the editor", async () => {
    fetchServiceDefinition.mockResolvedValue(
      def({ renewalPolicy: { renewable: true, renewalWindowDays: 60, validityMode: "duration", validityYears: 4 } }),
    );
    await openValidityTab();
    const years = screen.getByLabelText(/Years/i) as HTMLInputElement;
    expect(years.value).toBe("4");
  });
});
