import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AppealPanel } from "./AppealPanel";
import { AppealsTable } from "./AppealsTable";

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

async function chooseFirstApplication() {
  const combo = screen.getByRole("combobox");
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: "Birth" } });
  const option = await screen.findByText("Birth Certificate", {}, { timeout: 2000 });
  fireEvent.mouseDown(option);
}

describe("AppealPanel (GAP-CITIZEN-APPEALS-02/04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GAP-CITIZEN-APPEALS-02: no editable 'filing window (days)' field exists", () => {
    wrap(<AppealPanel />);
    expect(screen.queryByLabelText(/filing window/i)).not.toBeInTheDocument();
  });

  it("GAP-CITIZEN-APPEALS-02: submit is disabled until an application is chosen", () => {
    wrap(<AppealPanel />);
    expect(screen.getByRole("button", { name: "File appeal" })).toBeDisabled();
  });

  it("GAP-CITIZEN-APPEALS-04: a failed POST shows friendly copy, never the raw body", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/citizen/requests")) {
        return new Response(JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", serviceName: "Birth Certificate", submittedDate: "2026-01-02" }]), { status: 200 });
      }
      return new Response("Error: ECONNREFUSED at Object.<anonymous> stack...", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    wrap(<AppealPanel />);
    await chooseFirstApplication();
    fireEvent.change(screen.getByLabelText("Decision date"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Grounds for appeal"), { target: { value: "Decision was wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "File appeal" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
    expect(alert.textContent).not.toContain("stack");
    expect(alert.textContent).toMatch(/couldn't|could not/i);
  });

  it("GAP-CITIZEN-APPEALS-04: FILING_WINDOW_EXPIRED maps to its specific message", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/citizen/requests")) {
        return new Response(JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", serviceName: "Birth Certificate" }]), { status: 200 });
      }
      return new Response(JSON.stringify({ code: "FILING_WINDOW_EXPIRED", message: "late" }), { status: 422 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    wrap(<AppealPanel />);
    await chooseFirstApplication();
    fireEvent.change(screen.getByLabelText("Decision date"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("Grounds for appeal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "File appeal" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("The filing window for this decision has expired."),
    );
  });
});

describe("AppealsTable (GAP-CITIZEN-APPEALS-05/06)", () => {
  it("humanizes raw status/type codes and formats the deadline", () => {
    wrap(
      <AppealsTable
        appeals={[
          { id: "a1", appealType: "first", status: "under_review", grounds: "Some grounds", filingDeadline: "2026-03-05", outcome: "" },
        ]}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Under Review")).toBeInTheDocument();
    expect(screen.getByText("05 Mar 2026")).toBeInTheDocument();
  });
});
