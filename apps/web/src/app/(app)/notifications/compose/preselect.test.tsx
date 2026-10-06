import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/notifications/compose",
  useSearchParams: () => new URLSearchParams("templateId=tmpl-9"),
}));

import ComposeNotificationPage from "./page";

const TEMPLATES = [
  { id: "tmpl-1", name: "Payslip ready", channel: "email", status: "active" },
  { id: "tmpl-9", name: "Rent reminder", channel: "sms", status: "active" },
  { id: "tmpl-old", name: "Retired", channel: "email", status: "superseded" },
];

describe("ComposeNotificationPage preselect (GAP-NOTIFICATIONS-TEMPLATES-DETAIL-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("preselects the templateId from the query and omits superseded templates", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/proxy/notification/templates") {
        return new Response(JSON.stringify(TEMPLATES), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });

    render(<ComposeNotificationPage />);

    const select = (await screen.findByLabelText(/^template$/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("tmpl-9"));
    // Superseded template is not offered as an option.
    expect(screen.queryByRole("option", { name: /Retired/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Rent reminder/ })).toBeInTheDocument();
  });
});
