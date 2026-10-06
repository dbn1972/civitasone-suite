import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DebugModeButton } from "./DebugModeButton";

describe("DebugModeButton — GAP-TENANT-ADMIN-PLATFORM-CONFIG-01", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("requires a reason, then POSTs the chosen duration to debug-mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "debug_enabled" }), { status: 200 }));
    render(<DebugModeButton debugModeUntil={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Enable debug mode/i }));
    const dialog = await screen.findByRole("alertdialog");
    // Confirm disabled until a reason is typed.
    expect(within(dialog).getByRole("button", { name: "Enable debug mode" })).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("30 min"));
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Investigating latency" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enable debug mode" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/admin/platform-config/debug-mode",
      expect.objectContaining({ method: "POST" }),
    ));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ durationMinutes: 30, reason: "Investigating latency" });
  });

  it("shows the active-until pill when debug mode is on", () => {
    const until = new Date(Date.now() + 20 * 60000).toISOString();
    render(<DebugModeButton debugModeUntil={until} />);
    expect(screen.getByText(/Debug until/i)).toBeInTheDocument();
  });
});
