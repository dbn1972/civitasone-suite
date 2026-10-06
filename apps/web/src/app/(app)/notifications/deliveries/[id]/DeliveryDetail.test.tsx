import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "del-1" }),
}));

import { DeliveryDetail } from "./DeliveryDetail";

function mockDelivery(over: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "del-1", templateId: "tmpl-1", recipient: "clerk@example.gov.in", channel: "email", status: "delivered", ...over }), { status: 200 }),
  );
}

describe("DeliveryDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // DETAIL-02 (DPDP): recipient masked, never shown in the clear.
  it("masks the recipient", async () => {
    mockDelivery({ recipient: "clerk@example.gov.in" });
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    expect(screen.queryByText("clerk@example.gov.in")).not.toBeInTheDocument();
    expect(screen.getByText(/c\*+@/)).toBeInTheDocument();
  });

  // DETAIL-06: dates include a time (IST hh:mm), not date-only.
  it("shows the sent-at time, not just the date", async () => {
    mockDelivery({ status: "delivered", sentAt: "2026-10-01T04:30:00.000Z" });
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    // 04:30 UTC -> 10:00 IST
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
  });

  // DETAIL-04: attempts reads retryCount|attemptCount; "—" when neither present.
  it("shows '—' for attempts when neither retryCount nor attemptCount is present", async () => {
    mockDelivery({ status: "failed", error: "BOUNCED" });
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    const attemptsRow = screen.getByText("Attempts").parentElement as HTMLElement;
    expect(attemptsRow).toHaveTextContent("—");
  });

  it("reads attemptCount when retryCount is absent", async () => {
    mockDelivery({ status: "failed", error: "BOUNCED", attemptCount: 3 });
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    expect(screen.getByText("Attempts").parentElement).toHaveTextContent("3");
  });

  // DETAIL-03: failure reason is friendly; raw provider string only under admin
  // "Technical detail", and the template is a link.
  it("shows a friendly failure reason and hides the raw string from non-admins", async () => {
    mockDelivery({ status: "failed", error: "DLT_TEMPLATE_NOT_REGISTERED", errorDetail: "gw-stack-trace-xyz" });
    render(<DeliveryDetail canResend canSeeTechnicalDetail={false} />);
    await screen.findByText("Delivery detail");
    expect(screen.getByText(/DLT operator/i)).toBeInTheDocument();
    expect(screen.queryByText(/gw-stack-trace-xyz/)).not.toBeInTheDocument();
    expect(screen.queryByText("Technical detail")).not.toBeInTheDocument();
  });

  it("exposes the raw technical detail to admins in a collapsible section", async () => {
    mockDelivery({ status: "failed", error: "DLT_TEMPLATE_NOT_REGISTERED", errorDetail: "gw-stack-trace-xyz" });
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    expect(screen.getByText("Technical detail")).toBeInTheDocument();
    expect(screen.getByText(/gw-stack-trace-xyz/)).toBeInTheDocument();
  });

  it("links the template id to the template detail page", async () => {
    mockDelivery({ templateId: "tmpl-xyz" });
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    expect(screen.getByRole("link", { name: "tmpl-xyz" })).toHaveAttribute("href", "/notifications/templates/tmpl-xyz");
  });

  // DETAIL-01: Resend hidden for a viewer without send permission.
  it("hides Resend for a viewer without send permission", async () => {
    mockDelivery({ status: "failed", error: "BOUNCED" });
    render(<DeliveryDetail canResend={false} canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    expect(screen.queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
  });

  it("shows Resend for a failed delivery when the viewer may send", async () => {
    mockDelivery({ status: "failed", error: "BOUNCED" });
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    await screen.findByText("Delivery detail");
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
  });

  // DETAIL-05: 404 / 403 / 500 are distinct states.
  it("shows the not-found state for a 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    expect(await screen.findByText("Delivery not found")).toBeInTheDocument();
  });

  it("shows an access state for a 403, distinct from a load error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    expect(await screen.findByText("You don't have access")).toBeInTheDocument();
  });

  it("shows a clerk-safe load error for a 500, not the raw sentinel", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<DeliveryDetail canResend canSeeTechnicalDetail />);
    expect(await screen.findByText("Couldn't load this delivery")).toBeInTheDocument();
    expect(screen.queryByText(/HTTP_500/)).not.toBeInTheDocument();
  });
});
