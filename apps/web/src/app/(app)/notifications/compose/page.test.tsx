import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ComposeNotificationPage from "./page";

const TEMPLATES = [
  { id: "tmpl-1", name: "Payslip ready", channel: "email", subject: "Your payslip is ready", body: "Hello, your payslip is ready." },
  { id: "tmpl-2", name: "OTP code", channel: "sms", subject: null, body: "Your OTP is {{code}}. It expires in {{minutes}} minutes." },
  { id: "tmpl-3", name: "In-app ping", channel: "in_app", subject: null, body: "You have a new message." },
];

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

describe("ComposeNotificationPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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

    expect(await screen.findByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
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

  // COMPOSE-02: channel label must be humanised, not the raw enum "in_app".
  it("renders a humanised channel label in the option, not the raw enum", async () => {
    await renderWithTemplates();
    expect(screen.getByRole("option", { name: "In-app ping (In-app)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /\(in_app\)/ })).not.toBeInTheDocument();
  });

  // COMPOSE-04: a phone number for an email-channel template is rejected
  // client-side and blocks submit.
  it("rejects a recipient that doesn't match the effective channel", async () => {
    await renderWithTemplates();
    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "tmpl-1" } }); // email default
    const recipient = screen.getByLabelText(/recipient/i);
    fireEvent.change(recipient, { target: { value: "9876543210" } });
    fireEvent.blur(recipient);

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review & send/i })).toBeDisabled();
  });

  // COMPOSE-03: a template with {{placeholders}} shows one input per variable
  // and blocks submit until all are filled.
  it("requires all template variables to be filled before sending", async () => {
    await renderWithTemplates();
    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "tmpl-2" } }); // sms, {{code}} {{minutes}}
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: "9876543210" } });

    expect(screen.getByLabelText("Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Minutes")).toBeInTheDocument();
    // Not all variables filled yet -> submit disabled.
    expect(screen.getByRole("button", { name: /review & send/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: /review & send/i })).toBeEnabled();
  });

  // COMPOSE-03: the filled variables are sent in the request body.
  it("sends the filled variables in the request body", async () => {
    await renderWithTemplates();
    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "tmpl-2" } });
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "10" } });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    fireEvent.click(screen.getByRole("button", { name: /review & send/i }));
    await waitFor(() => expect(screen.getByText("Send this notification?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const sendCall = fetchSpy.mock.calls.find(([url]) => String(url) === "/api/proxy/notification/send");
    expect(sendCall).toBeTruthy();
    const body = JSON.parse((sendCall![1] as RequestInit).body as string);
    expect(body.variables).toEqual({ code: "123456", minutes: "10" });
  });

  // COMPOSE-05: no transport detail ("HTTP 202") leaks into user copy.
  it("does not expose transport detail like HTTP 202 in the copy", async () => {
    await renderWithTemplates();
    expect(screen.queryByText(/HTTP 202/)).not.toBeInTheDocument();
    expect(screen.getByText(/track them in/i)).toBeInTheDocument();
  });

  // COMPOSE-05: after a successful send the whole form resets (template cleared).
  it("resets the whole form after a successful send", async () => {
    await renderWithTemplates();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    const templateSelect = screen.getByLabelText(/^template$/i) as HTMLSelectElement;
    fireEvent.change(templateSelect, { target: { value: "tmpl-1" } });
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: "clerk@example.gov.in" } });
    fireEvent.click(screen.getByRole("button", { name: /review & send/i }));
    await waitFor(() => expect(screen.getByText("Send this notification?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText(/notification queued/i);
    expect((screen.getByLabelText(/^template$/i) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(/recipient/i) as HTMLInputElement).value).toBe("");
  });
});
