import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { AuditParaActions } from "./AuditParaActions";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("AuditParaActions (GAP-FINANCE-AUDIT-PARAS-DETAIL-04)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("renders only the actions it is given", () => {
    render(<AuditParaActions id="p1" paraNo="CAG-1" actions={["escalate"]} />);
    expect(screen.queryByRole("button", { name: "Record reply" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escalate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settle" })).not.toBeInTheDocument();
  });

  it("recording a reply needs a note, POSTs it to /respond, and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<AuditParaActions id="p1" paraNo="CAG-1" actions={["respond"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record reply" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Record reply" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Department reply"), { target: { value: "Reply dated 12/09 attached" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record reply" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/audit-paras/p1/respond");
    expect(JSON.parse(init.body as string)).toEqual({ note: "Reply dated 12/09 attached" });
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("a settle refused for maker != checker shows plain language and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION", message: "x" }), { status: 409 }));
    render(<AuditParaActions id="p1" paraNo="CAG-1" actions={["settle"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));
    fireEvent.change(await screen.findByLabelText("Settlement note"), { target: { value: "Closed per CAG letter" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle para" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot also approve/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
