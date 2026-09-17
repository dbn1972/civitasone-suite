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

  it("resends to the correct proxied endpoint and reports success", async () => {
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
  });

  // UX-016: this used to show the RAW response body text verbatim
  // (`text || \`Resend failed (HTTP ${status})\``), not even parsed as JSON.
  // It must now show only the catalogued, clerk-safe copy — never the raw
  // server text.
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
