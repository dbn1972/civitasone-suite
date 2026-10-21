import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown) {
  mockedHook.mockReturnValue({ data: data as never, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
}
import { TDSReturnsTable } from "./TDSReturnsTable";

const ROW = {
  id: "1", vendor_id: "v", vendor_name: "Vendor A", pan: "ABCDE****F", section: "194C", quarter: "Q2", fy: "2025-26",
  tds_amount_minor: "10000", deduction_date: "2026-09-26", status: "filed", created_at: "2026-09-26T00:00:00Z",
};

describe("TDSReturnsTable", () => {
  beforeEach(() => mockedHook.mockReset());

  it("formats the deduction date and shows a dash for a null date (TDS-RETURNS-03)", () => {
    seed([ROW, { ...ROW, id: "2", deduction_date: null }]);
    const { container } = render(<TDSReturnsTable returns={[]} source="api" />);
    expect(container.textContent).toMatch(/26 Sep 2026/);
    expect(container.textContent).not.toContain("2026-09-26");
    expect(container.textContent).toContain("—");
  });

  it("renders filed as a success pill (TDS-RETURNS-06) and shows only the masked PAN (TDS-RETURNS-05)", () => {
    seed([ROW]);
    const { container } = render(<TDSReturnsTable returns={[]} source="api" />);
    const pill = Array.from(container.querySelectorAll(".pill")).find((p) => p.textContent === "Filed");
    expect(pill?.className).toBe("pill good");
    expect(container.textContent).toContain("ABCDE****F");
  });
});

// ── GAP-FINANCE-STATUTORY-TDS-RETURNS-05: a user-reachable, audited PAN reveal ─────────────────────────
describe("TDSReturnsTable PAN reveal", () => {
  const CLEAR_PAN = "ABCDE1234F";
  const renderWithIntl = (ui: React.ReactElement) =>
    rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

  beforeEach(() => {
    mockedHook.mockReset();
    vi.restoreAllMocks();
  });

  it("offers no Reveal control (and never fetches) to a viewer who may not reveal", () => {
    seed([ROW]);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { container } = renderWithIntl(<TDSReturnsTable returns={[]} source="api" canReveal={false} />);
    expect(container.textContent).toContain("ABCDE****F");
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(CLEAR_PAN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reveals through the audited endpoint only after a reason of 10+ characters, then hides again", async () => {
    seed([ROW]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1", vendorId: "v", vendorName: "Vendor A", pan: CLEAR_PAN }), { status: 200 }),
    );
    const { container } = renderWithIntl(<TDSReturnsTable returns={[]} source="api" canReveal />);
    // The clear PAN is nowhere in the DOM until the server returns it.
    expect(container.textContent).not.toContain(CLEAR_PAN);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(fetchMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reveal" });
    const reason = within(dialog).getByLabelText(/Reason for revealing/i);
    // 5 to 9 characters is enough for the vendor reveal but NOT for this endpoint (10 to 500).
    fireEvent.change(reason, { target: { value: "Form 26Q" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Reconcile Form 26AS entry" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    expect(await screen.findByText(CLEAR_PAN)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendor-tds/1/pan/reveal");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Reconcile Form 26AS entry" });

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(container.textContent).not.toContain(CLEAR_PAN));
    expect(container.textContent).toContain("ABCDE****F");
  });

  it("a failed reveal shows an error in the dialog and never shows the PAN", async () => {
    seed([ROW]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    const { container } = renderWithIntl(<TDSReturnsTable returns={[]} source="api" canReveal />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for revealing/i), { target: { value: "Reconcile Form 26AS entry" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeInTheDocument());
    expect(container.textContent).not.toContain(CLEAR_PAN);
  });

  it("has nothing to reveal for a deduction with no PAN on record", () => {
    seed([{ ...ROW, pan: null }]);
    renderWithIntl(<TDSReturnsTable returns={[]} source="api" canReveal />);
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });
});
