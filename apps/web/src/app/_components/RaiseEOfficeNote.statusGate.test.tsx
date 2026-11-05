import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RaiseEOfficeNote } from "./RaiseEOfficeNote";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const base = { refType: "finance_sanction", refId: "abc-123", subject: "Sanction", dept: "Finance" };

describe("RaiseEOfficeNote: status-aware (DS-3 / UX-R5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("never offers Raise for approval when the status does not allow it, and shows the outcome", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    render(<RaiseEOfficeNote {...base} statusAllowsRaise={false} outcome="Approved by N. Gupta, DDO on 30 Oct 2026." />);
    await waitFor(() => expect(screen.getByTestId("eoffice-outcome")).toHaveTextContent("Approved by N. Gupta, DDO on 30 Oct 2026."));
    expect(screen.queryByText("Raise for approval")).toBeNull();
  });

  it("keeps a linked file visible (status + Open file) but still offers no raise", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "f1", file_no: "EO/FIN/2026/001", status: "closed" } }), { status: 200 }));
    render(<RaiseEOfficeNote {...base} allowRaiseAfterTerminal statusAllowsRaise={false} />);
    await waitFor(() => expect(screen.getByText("EO/FIN/2026/001")).toBeInTheDocument());
    expect(screen.getByText("Open file")).toBeInTheDocument();
    expect(screen.queryByText("Raise for approval")).toBeNull();
    expect(screen.getByTestId("eoffice-outcome")).toHaveTextContent("No approval can be raised for a record in this status.");
  });

  it("unchanged default: raisable when the status allows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    render(<RaiseEOfficeNote {...base} />);
    await waitFor(() => expect(screen.getByText("Raise for approval")).toBeInTheDocument());
    expect(screen.queryByTestId("eoffice-outcome")).toBeNull();
  });
});
