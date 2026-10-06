import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResendAction } from "./ResendAction";

describe("ResendAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function openAndConfirm() {
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    return waitFor(() => expect(screen.getByText("Resend this notification?")).toBeInTheDocument());
  }

  it("resends to the correct proxied endpoint and links the new delivery on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const onResent = vi.fn();

    render(<ResendAction templateId="tmpl-1" recipient="clerk@example.gov.in" channel="email" onResent={onResent} />);
    await openAndConfirm();
    fireEvent.click(screen.getAllByRole("button", { name: "Resend" })[1]);

    await waitFor(() => expect(onResent).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/notification/send");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      templateId: "tmpl-1",
      recipient: "clerk@example.gov.in",
      channel: "email",
    });
    // DETAIL-06: success message links to Deliveries.
    expect(await screen.findByRole("link", { name: /deliveries/i })).toHaveAttribute("href", "/notifications/deliveries");
  });

  // DETAIL-01: the confirm dialog is honest that fill-in fields use defaults.
  it("warns in the dialog that fill-in fields use default values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<ResendAction templateId="tmpl-1" recipient="clerk@example.gov.in" channel="email" />);
    await openAndConfirm();
    expect(screen.getByText(/default values/i)).toBeInTheDocument();
  });

  it("shows a clerk-safe error, not the raw server text, when the resend fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("notification-service: template has been archived", { status: 422 }),
    );
    const onResent = vi.fn();

    render(<ResendAction templateId="tmpl-1" recipient="clerk@example.gov.in" channel="email" onResent={onResent} />);
    await openAndConfirm();
    fireEvent.click(screen.getAllByRole("button", { name: "Resend" })[1]);

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/has been archived/)).not.toBeInTheDocument();
    expect(onResent).not.toHaveBeenCalled();
  });
});
