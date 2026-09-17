import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ComposeNotificationPage from "./page";

const TEMPLATES = [
  { id: "tmpl-1", name: "Payslip ready", channel: "email", subject: "Your payslip is ready" },
];

describe("ComposeNotificationPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function renderWithTemplates() {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/notification/templates") {
        return new Response(JSON.stringify(TEMPLATES), { status: 200 });
      }
      throw new Error(`unexpected fetch in setup: ${url}`);
    });
    render(<ComposeNotificationPage />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Payslip ready/ })).toBeInTheDocument());
  }

  // UX-016: send()'s not-ok branch used to show the RAW response body text
  // verbatim (`text || \`Send failed (HTTP ${status})\``), not even parsed
  // as JSON. It must now show only the catalogued, clerk-safe copy — never
  // the raw server text.
  it("shows a clerk-safe error, not the raw server text, when sending fails", async () => {
    await renderWithTemplates();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("notification-service: recipient address rejected by provider", { status: 422 }),
    );

    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "tmpl-1" } });
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: "clerk@example.gov.in" } });
    fireEvent.click(screen.getByRole("button", { name: /review & send/i }));
    await waitFor(() => expect(screen.getByText("Send this notification?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/rejected by provider/)).not.toBeInTheDocument();
  });

  it("queues the send and shows the confirmation on success", async () => {
    await renderWithTemplates();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "tmpl-1" } });
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: "clerk@example.gov.in" } });
    fireEvent.click(screen.getByRole("button", { name: /review & send/i }));
    await waitFor(() => expect(screen.getByText("Send this notification?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/notification queued/i)).toBeInTheDocument();
  });
});
