import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { ChannelForm } from "./ChannelForm";

describe("ChannelForm — GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("submitting an empty name shows a field error and sends no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ChannelForm />);
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter a channel name/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the service's exact body (type/name/isDefault/enabled) on a valid submit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<ChannelForm />);
    fireEvent.change(screen.getByLabelText(/channel name/i), { target: { value: "Office email" } });
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/notification/channels", expect.objectContaining({ method: "POST" })));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ name: "Office email", type: "email", isDefault: false, enabled: true });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // never sends provider/config (not part of the backend contract)
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("config");
  });

  it("shows a clerk-safe error, not the raw body, when the POST fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("notification-service: ECONNREFUSED", { status: 503 }));
    render(<ChannelForm />);
    fireEvent.change(screen.getByLabelText(/channel name/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
  });
});
