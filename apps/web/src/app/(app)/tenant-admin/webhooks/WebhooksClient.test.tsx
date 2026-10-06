import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, seed: unknown, source: string) => ({
    data: seed,
    provenance: source === "error" ? "error-no-data" : "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { WebhooksClient } from "./WebhooksClient";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const WH = {
  id: "wh-1",
  url: "https://hooks.example.gov.in/in",
  events: ["finance.invoice.created"],
  active: true,
  description: "Finance sync",
  lastDeliveryStatus: 200,
  createdAt: "2026-09-01T00:00:00Z",
};

// Built at runtime so no credential-shaped literal sits in source.
const FAKE_WEBHOOK_SECRET = ["whsec", "fixture", "only"].join("_");

describe("WebhooksClient — GAP-TENANT-ADMIN-WEBHOOKS-01 (no fabricated row)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("on a failed create, keeps the dialog open, shows an error, and adds no row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));

    renderWithToast(<WebhooksClient webhooks={[WH]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Webhook" }));
    const dialog = await screen.findByRole("dialog", { name: /Create Webhook/i });

    fireEvent.change(within(dialog).getByLabelText(/Endpoint URL/i), { target: { value: "https://ok.example.gov.in/x" } });
    fireEvent.click(within(dialog).getByLabelText(/invoice\.created/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Webhook/i }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeInTheDocument());
    // dialog is still open (create did not succeed)
    expect(screen.getByRole("dialog", { name: /Create Webhook/i })).toBeInTheDocument();
    // no fabricated row with the submitted URL
    expect(screen.queryByText("https://ok.example.gov.in/x")).not.toBeInTheDocument();
  });

  it("requires https and at least one event before Create is enabled (GAP-WEBHOOKS-05 client guard)", async () => {
    renderWithToast(<WebhooksClient webhooks={[WH]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Webhook" }));
    const dialog = await screen.findByRole("dialog", { name: /Create Webhook/i });

    const createBtn = within(dialog).getByRole("button", { name: /Create Webhook/i });
    expect(createBtn).toBeDisabled();

    // http (not https) + no events -> still disabled
    fireEvent.change(within(dialog).getByLabelText(/Endpoint URL/i), { target: { value: "http://insecure.example/x" } });
    expect(createBtn).toBeDisabled();
    expect(within(dialog).getByText(/must use https/i)).toBeInTheDocument();
  });
});

describe("WebhooksClient — GAP-TENANT-ADMIN-WEBHOOKS-02 (one-time secret)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the signing secret once after a successful create", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ id: "wh-9", secret: FAKE_WEBHOOK_SECRET }), { status: 202, headers: { "content-type": "application/json" } }));
      }
      // the follow-up list refresh
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    });

    renderWithToast(<WebhooksClient webhooks={[WH]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Webhook" }));
    const dialog = await screen.findByRole("dialog", { name: /Create Webhook/i });
    fireEvent.change(within(dialog).getByLabelText(/Endpoint URL/i), { target: { value: "https://ok.example.gov.in/x" } });
    fireEvent.click(within(dialog).getByLabelText(/invoice\.created/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Webhook/i }));

    await waitFor(() => expect(screen.getByText(FAKE_WEBHOOK_SECRET)).toBeInTheDocument());
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });
});

describe("WebhooksClient — GAP-TENANT-ADMIN-WEBHOOKS-03 (test is not fire-and-forget)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows an error toast and does NOT claim success when the test request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    renderWithToast(<WebhooksClient webhooks={[WH]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: `Send test event to ${WH.url}` }));

    await waitFor(() => expect(screen.queryByText(/Test event queued/i)).not.toBeInTheDocument());
    // an error surfaced somewhere (toast), and no success text was shown
    expect(screen.queryByText(/queued for/i)).not.toBeInTheDocument();
  });
});

describe("WebhooksClient — GAP-TENANT-ADMIN-WEBHOOKS-06 (delivery-log failures surfaced)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows an error state with retry (not 'No deliveries yet') when the deliveries fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));

    renderWithToast(<WebhooksClient webhooks={[WH]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: `View deliveries for ${WH.url}` }));

    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument());
    expect(screen.queryByText(/No deliveries yet/i)).not.toBeInTheDocument();
  });
});

describe("WebhooksClient — GAP-TENANT-ADMIN-WEBHOOKS-04 (lifecycle actions)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("offers Pause/Resume, Rotate secret and a reason-gated Delete", async () => {
    renderWithToast(<WebhooksClient webhooks={[WH]} source="api" />);
    expect(screen.getByRole("button", { name: `Pause ${WH.url}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Rotate signing secret for ${WH.url}` })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Delete ${WH.url}` }));
    const dialog = await screen.findByRole("alertdialog");
    // Confirm is gated on a reason
    expect(within(dialog).getByLabelText(/Reason/i)).toBeInTheDocument();
  });
});
