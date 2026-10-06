import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { PasskeyManager } from "./PasskeyManager";
import type { WebauthnCredential } from "../_data";

const CRED: WebauthnCredential = {
  id: "11111111-1111-4000-8000-000000000001",
  deviceName: "YubiKey 5C",
  createdAt: "2026-09-01T09:14:22Z",
  lastUsedAt: "2026-09-20T04:30:00Z",
};

describe("PasskeyManager — GAP-IDENTITY-WEBAUTHN-02/03", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefresh.mockClear();
  });

  it("WEBAUTHN-03: shows device name, registered and last-used columns (formatted, not raw ISO)", () => {
    render(<PasskeyManager credentials={[CRED]} />);
    expect(screen.getByText("YubiKey 5C")).toBeInTheDocument();
    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("Last used")).toBeInTheDocument();
    // formatIndianDateTime renders "01 Sep 2026, ..." — no bare ISO "T".
    expect(screen.queryByText(/2026-09-01T09:14:22Z/)).not.toBeInTheDocument();
    expect(screen.getByText(/01 Sep 2026/)).toBeInTheDocument();
  });

  it("WEBAUTHN-02: Register is honestly marked not-available (no fake success button)", () => {
    render(<PasskeyManager credentials={[CRED]} />);
    expect(screen.getByText(/Registering a new passkey is not available yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /register|add passkey/i })).not.toBeInTheDocument();
  });

  it("WEBAUTHN-02: Remove opens a confirm dialog and DELETEs the real ownership-scoped endpoint on confirm", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    render(<PasskeyManager credentials={[CRED]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove passkey" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`/api/proxy/v1/identity/webauthn/credentials/${CRED.id}`);
    expect((init as RequestInit).method).toBe("DELETE");
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows a clerk-safe error (never the raw body) when remove fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("postgres credential table locked", { status: 503 }),
    );
    render(<PasskeyManager credentials={[CRED]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove passkey" }));
    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't|could not/i));
    expect(dialog.textContent).not.toMatch(/postgres credential table/i);
  });

  it("shows an empty state when the user has no passkeys", () => {
    render(<PasskeyManager credentials={[]} />);
    expect(screen.getByText("No passkeys")).toBeInTheDocument();
  });
});
