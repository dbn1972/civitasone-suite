/**
 * Disable is audited: the confirm dialog requires a reason and the POST body carries it.
 * Enable is unchanged (no body). An `installed` registry row (provisioned, not yet enabled)
 * offers Enable, its only valid next transition.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }));

import { PluginActions } from "./PluginActions";
import { lifecycleOf } from "./pluginLifecycle";

describe("PluginActions — Disable requires a reason", () => {
  beforeEach(() => { mockRefresh.mockClear(); vi.restoreAllMocks(); });

  it("the Disable confirm is gated on a reason and uses the supplied (translated) label", () => {
    render(<PluginActions plugin={{ id: "p1", name: "Billing", status: "enabled" }} labels={{ disableReasonLabel: "कारण" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const confirm = screen.getByRole("button", { name: "Disable plugin" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("कारण")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ab" } });
    expect(confirm).toBeDisabled(); // min 3 chars, mirrors the service
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Vendor withdrew support" } });
    expect(confirm).toBeEnabled();
  });

  it("POSTs /disable with the trimmed reason in the body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<PluginActions plugin={{ id: "p1", name: "Billing", status: "enabled" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Vendor withdrew support " } });
    fireEvent.click(screen.getByRole("button", { name: "Disable plugin" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/plugins/p1/disable");
    expect((init as RequestInit).body).toBe(JSON.stringify({ reason: "Vendor withdrew support" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("Enable still posts with no body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<PluginActions plugin={{ id: "p1", name: "Billing", status: "disabled" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable plugin" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect((spy.mock.calls[0]![1] as RequestInit).body).toBeUndefined();
  });

  it("an `installed` registry row offers Enable only", () => {
    expect(lifecycleOf("installed")).toBe("disabled");
    render(<PluginActions plugin={{ id: "p1", name: "Billing", status: "installed" }} />);
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
  });
});
