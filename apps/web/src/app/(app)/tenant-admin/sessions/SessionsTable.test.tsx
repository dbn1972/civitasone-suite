import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SessionsTable } from "./SessionsTable";

const SESSION = {
  id: "s1",
  userEmail: "clerk@gov.in",
  userName: "A. Clerk",
  ipAddress: "10.1.2.3",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/1",
  lastActiveAt: "2026-09-01T00:00:00Z",
  mfaVerified: true,
  status: "active" as const,
};

describe("SessionsTable — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when revoking a session fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("redis session store unreachable", { status: 503 }),
    );

    render(<SessionsTable sessions={[SESSION]} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "compromised device" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke session" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/redis session store/i);
    expect(dialog.textContent).not.toMatch(/\b503\b/);
  });
});
