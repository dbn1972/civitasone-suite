import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { NotificationPrefActions } from "./NotificationPrefActions";

const PREFS = [
  {
    id: "p1",
    module: "finance",
    eventType: "payment_approved",
    label: "Payment approved",
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    webhookEnabled: false,
  },
];

describe("NotificationPrefActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when saving preferences fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("prefs-service unavailable: ECONNREFUSED", { status: 503 }),
    );

    render(<NotificationPrefActions prefs={PREFS} />);
    fireEvent.click(screen.getByRole("switch", { name: /Email for Payment approved/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/ECONNREFUSED/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b503\b/);
  });
});
