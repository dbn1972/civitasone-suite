import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "del-1" }),
}));

import DeliveryDetailPage from "./page";

describe("DeliveryDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders delivery details on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "del-1",
          templateId: "tmpl-1",
          recipient: "clerk@example.gov.in",
          channel: "email",
          status: "delivered",
        }),
        { status: 200 },
      ),
    );

    render(<DeliveryDetailPage />);
    expect(await screen.findByText("clerk@example.gov.in")).toBeInTheDocument();
  });

  // UX-016 (beyond the guard's own regex): the load path used to throw
  // `HTTP_${status}` and the catch used to read the caught exception's own
  // `.message` directly, surfacing that raw sentinel to the clerk. It must
  // now show only the catalogued, clerk-safe copy.
  it("shows a clerk-safe load error, not the raw HTTP_<status> sentinel, when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<DeliveryDetailPage />);

    expect(await screen.findByText("Couldn't load this delivery")).toBeInTheDocument();
    expect(screen.queryByText(/HTTP_500/)).not.toBeInTheDocument();
  });

  it("shows the honest not-found state for a 404, distinct from a real load error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    render(<DeliveryDetailPage />);

    expect(await screen.findByText("Delivery not found")).toBeInTheDocument();
  });
});
