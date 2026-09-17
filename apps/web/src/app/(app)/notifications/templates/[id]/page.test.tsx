import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "tmpl-1" }),
}));

import TemplateDetailPage from "./page";

describe("TemplateDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the current template version on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "tmpl-1", channel: "email", name: "Payslip ready", subject: "Your payslip", body: "Hello", status: "active", version: 1, supersededBy: null },
        ]),
        { status: 200 },
      ),
    );

    render(<TemplateDetailPage />);
    expect(await screen.findByText("Payslip ready")).toBeInTheDocument();
  });

  // UX-016 (beyond the guard's own regex): the load path used to throw
  // `HTTP_${status}` and the catch used to read the caught exception's own
  // `.message` directly, surfacing that raw sentinel to the clerk. It must
  // now show only the catalogued, clerk-safe copy.
  it("shows a clerk-safe load error, not the raw HTTP_<status> sentinel, when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<TemplateDetailPage />);

    expect(await screen.findByText("Couldn't load this template")).toBeInTheDocument();
    expect(screen.queryByText(/HTTP_500/)).not.toBeInTheDocument();
  });
});
