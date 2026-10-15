import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@/test-utils/intl-render";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ChannelRowActions } from "./ChannelRowActions";

describe("ChannelRowActions — NOTIFICATIONS-CHANNELS-01 enable / disable", () => {
  beforeEach(() => { vi.restoreAllMocks(); refresh.mockReset(); });

  it("Disable asks for confirmation and a reason, then PATCHes {enabled:false, reason}", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<ChannelRowActions id="c1" name="Office email" enabled isDefault />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/default channel/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason for disabling/i), { target: { value: "provider outage" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Disable channel")!);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("/api/proxy/notification/channels/c1");
    expect(fetchSpy.mock.calls[0]![1]!.method).toBe("PATCH");
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).toEqual({ enabled: false, reason: "provider outage" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("Enable needs no dialog and PATCHes {enabled:true}", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<ChannelRowActions id="c1" name="Office email" enabled={false} isDefault={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).toEqual({ enabled: true });
    expect(await screen.findByRole("status")).toHaveTextContent(/enabled/i);
  });

  it("a failed disable shows a clerk-safe message in the dialog, never the raw body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("db connection refused at 10.0.0.4", { status: 500 }));
    render(<ChannelRowActions id="c1" name="Office email" enabled isDefault={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for disabling/i), { target: { value: "testing" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Disable channel")!);
    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/10\.0\.0\.4|connection refused|\b500\b/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
