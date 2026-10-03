import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { PtVersionForm } from "./PtVersionForm";

const base = [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: null }];

function renderForm(over: Partial<React.ComponentProps<typeof PtVersionForm>> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PtVersionForm stateCode="MH" stateName="Maharashtra" baseSlabs={base} today="2026-10-03" earliestEffectiveFrom={null} lastFinalisedMonth={null} {...over} />
    </NextIntlClientProvider>,
  );
}

/** POST -> 202 {id}; the request-outcome GET answers with `outcome` (default: created). */
const acceptThen = (outcome: Record<string, unknown> = { status: "applied", code: null }) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
    (init as RequestInit | undefined)?.method === "POST"
      ? new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 202 })
      : new Response(JSON.stringify(outcome), { status: 200 }));

describe("PtVersionForm", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("starts as a copy of the current slabs", () => {
    renderForm();
    expect(screen.getByLabelText(/Slab 1 tax per month/)).toHaveValue("200");
    expect(screen.getByLabelText(/Effective from/)).toHaveValue("2026-10-03");
  });

  it("refuses a month above the Article 276(2) cap before any request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.change(screen.getByLabelText(/Slab 1 tax per month/), { target: { value: "2600" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    expect(screen.getByText("A single month's tax cannot exceed ₹2,500 (Article 276(2)).")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("will not accept a date before the latest finalised run's month ends", () => {
    renderForm({ earliestEffectiveFrom: "2026-09-01", lastFinalisedMonth: "2026-08", today: "2026-10-03" });
    expect(screen.getByText(/The 2026-08 pay run is already finalised/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Effective from/), { target: { value: "2026-08-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    expect(screen.getByText(/earlier months are already finalised/)).toBeInTheDocument();
  });

  it("saves a future-dated version on confirm (no reason needed) and refreshes", async () => {
    const fetchSpy = acceptThen();
    renderForm();
    fireEvent.change(screen.getByLabelText(/Effective from/), { target: { value: "2027-04-01" } });
    fireEvent.change(screen.getByLabelText(/Slab 1 tax per month/), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText(/Slab 1 February amount/), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText("Save this new version?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    // not "saved" until the outcome says so
    expect(screen.queryByText(/New version saved for MH/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/New version saved for MH/)).toBeInTheDocument(), { timeout: 5000 });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/api/proxy/v1/payroll/statutory/pt/versions");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      stateCode: "MH", effectiveFrom: "2027-04-01",
      slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 25000, februaryTaxMinor: 30000 }],
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("a back-dated version needs a reason, which is sent", async () => {
    const fetchSpy = acceptThen();
    renderForm({ today: "2026-10-03" });
    fireEvent.change(screen.getByLabelText(/Effective from/), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText(/This date is in the past/)).toBeInTheDocument());
    const confirm = screen.getByRole("button", { name: "Save new version" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for back-dating/), { target: { value: "Notified late by the State" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string).reason).toBe("Notified late by the State");
  });

  it("a command the consumer rejects (e.g. it lost a race) is shown to the user, never reported as saved", async () => {
    acceptThen({ status: "rejected", code: "PT_VERSION_EXISTS" });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText("Save this new version?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(screen.getByText(/A version already starts on that date/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText(/New version saved/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("an unrecognised rejection code falls back to a generic, translated message", async () => {
    acceptThen({ status: "rejected", code: "SOMETHING_NEW" });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText("Save this new version?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(screen.getByText(/was not saved because the slabs changed/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText(/SOMETHING_NEW/)).not.toBeInTheDocument();
  });

  it("shows a translated sentence for a known server rejection, never the raw code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "PT_BACKDATE_BEFORE_FINALISED_RUN", message: "raw server text" }), { status: 409 }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText("Save this new version?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(screen.getByText(/already finalised. Choose a later effective date/)).toBeInTheDocument());
    expect(screen.queryByText(/PT_BACKDATE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
  });

  it("PT-06: a 403 on save reads as a permission problem, not the generic save failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: payroll_admin" }), { status: 403 }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText("Save this new version?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(screen.getByText("You don't have permission to do this. Contact your administrator if you think this is a mistake.")).toBeInTheDocument());
    expect(screen.queryByText(/couldn't save/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/payroll_admin|FORBIDDEN|403/)).not.toBeInTheDocument();
  });

  it("PT-06: a 500 shows the catalogued 'couldn't save your professional tax slab version' copy, never the status or body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>boom 500</html>", { status: 500 }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText("Save this new version?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(screen.getByText("We couldn't save your professional tax slab version. Nothing was changed. Please try again in a moment.")).toBeInTheDocument());
    expect(screen.queryByText(/boom|HTTP|status 500/i)).not.toBeInTheDocument();
  });

  it("maker != checker: when the outcome is pending approval the form says it was SUBMITTED, never 'saved'", async () => {
    acceptThen({ status: "pending_approval", code: null });
    renderForm();
    fireEvent.change(screen.getByLabelText(/Effective from/), { target: { value: "2027-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and save new version" }));
    await waitFor(() => expect(screen.getByText("Save this new version?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(screen.getByText(/A different payroll administrator must approve it before it takes effect/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText(/New version saved/)).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });
});
