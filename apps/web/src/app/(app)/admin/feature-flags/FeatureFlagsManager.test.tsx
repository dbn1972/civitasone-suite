import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeatureFlagsManager } from "./FeatureFlagsManager";
import type { AdminFeatureFlagRow } from "@/app/_data/loaders";

const FLAG = {
  id: "11111111-1111-4000-8000-000000000001",
  key: "new_checkout",
  name: "New Checkout",
  description: "",
  enabled: true,
  rolloutPercent: 100,
  targetSegments: [],
  killSwitch: false,
} as unknown as AdminFeatureFlagRow;

// GAP-ADMIN-FEATURE-FLAGS-01
describe("FeatureFlagsManager kill switch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ ...FLAG, killSwitch: true }] }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("clicking Kill opens a confirmation and sends nothing", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Kill switch for New Checkout" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Kill switch: New Checkout")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Confirm stays disabled until a reason is typed, then POSTs once with the reason", async () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Kill switch for New Checkout" }));
    const confirm = screen.getByRole("button", { name: "Kill flag" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for killing this flag/), { target: { value: "INC-9 checkout failures" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const kills = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/kill"));
    expect(kills).toHaveLength(1);
    expect(kills[0][1].method).toBe("POST");
    expect(JSON.parse(kills[0][1].body)).toEqual({ reason: "INC-9 checkout failures" });
  });

  it("Cancel closes the dialog and leaves the flag untouched", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Kill switch for New Checkout" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Kill switch for New Checkout" })).not.toBeDisabled();
  });
});
