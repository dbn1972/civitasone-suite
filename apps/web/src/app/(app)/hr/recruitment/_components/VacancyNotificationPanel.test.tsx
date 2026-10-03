import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { VacancyNotificationPanel, paiseToRupeesInput, istInputToIso } from "./VacancyNotificationPanel";

const AD = {
  id: "job-1", status: "open", applicationDeadline: "2030-06-30T12:00:00.000Z", feesMinor: "50000", feeExemption: "SC/ST exempt",
  requiredDocuments: ["Photo", "Signature"], selectionProcess: "Written test + interview", importantDates: { "Written exam": "15 Nov 2030" }, portalScope: "both",
};
const CORR = [{ id: "c1", seq: 1, action: "corrigendum", changes: "Qualification revised", oldDeadline: null, newDeadline: null, createdAt: "2030-01-02T05:00:00.000Z" }];

type Sent = { url: string; method: string; body: Record<string, unknown> };

function mockApi(over: { ad?: Record<string, unknown>; adStatus?: number; writeStatus?: number } = {}) {
  const sent: Sent[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      if (url.endsWith("/advertisement")) return new Response(JSON.stringify({ ...AD, ...over.ad }), { status: over.adStatus ?? 200 });
      if (url.endsWith("/corrigenda")) return new Response(JSON.stringify({ data: CORR }), { status: 200 });
    }
    sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({}), { status: over.writeStatus ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, sent };
}

const renderPanel = (published = false, onChanged = vi.fn()) =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}><VacancyNotificationPanel jobOpeningId="job-1" published={published} onChanged={onChanged} /></NextIntlClientProvider>);

describe("paiseToRupeesInput", () => {
  it("is exact", () => {
    expect(paiseToRupeesInput("50000")).toBe("500.00");
    expect(paiseToRupeesInput("5")).toBe("0.05");
    expect(paiseToRupeesInput("0")).toBe("0.00");
    expect(paiseToRupeesInput(null)).toBe("");
    expect(paiseToRupeesInput("12x")).toBe("");
  });
});

describe("istInputToIso", () => {
  it("reads a datetime-local value as +05:30", () => {
    expect(istInputToIso("2030-12-01T10:00")).toBe("2030-12-01T04:30:00.000Z");
    expect(istInputToIso("2030-12-01T10:00:30")).toBe("2030-12-01T04:30:30.000Z");
    expect(istInputToIso("")).toBeNull();
    expect(istInputToIso("nonsense")).toBeNull();
  });
});

describe("VacancyNotificationPanel (GAP-RECRUITMENT-DETAIL-13)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the advertisement and corrigenda into the form", async () => {
    mockApi();
    renderPanel();
    expect(await screen.findByLabelText(/Application fee/)).toHaveValue("500.00");
    expect(screen.getByLabelText(/Fee exemption/)).toHaveValue("SC/ST exempt");
    expect(screen.getByLabelText(/Required documents/)).toHaveValue("Photo\nSignature");
    expect(screen.getByLabelText("Date 1 name")).toHaveValue("Written exam");
    expect(screen.getByText(/Qualification revised/)).toBeInTheDocument();
  });

  it("saves the fee as integer paise (500.00 -> 50000) with the other fields", async () => {
    const { sent } = mockApi();
    renderPanel();
    const fee = await screen.findByLabelText(/Application fee/);
    fireEvent.change(fee, { target: { value: "750.5" } });
    fireEvent.change(screen.getByLabelText(/Required documents/), { target: { value: "Photo\n\n  Id proof  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save advertisement" }));
    await waitFor(() => expect(sent.find((s) => s.method === "PATCH")).toBeTruthy());
    const patch = sent.find((s) => s.method === "PATCH")!;
    expect(patch.url).toMatch(/\/job-openings\/job-1\/advertisement$/);
    expect(patch.body.feesMinor).toBe(75050);
    expect(Number.isInteger(patch.body.feesMinor)).toBe(true);
    expect(patch.body.requiredDocuments).toEqual(["Photo", "Id proof"]);
    expect(patch.body.importantDates).toEqual({ "Written exam": "15 Nov 2030" });
    expect(patch.body.portalScope).toBe("both");
    expect(await screen.findByText("Advertisement saved.")).toBeInTheDocument();
  });

  it("clears a previously set fee by sending feesMinor: null, and sends nothing for an untouched empty fee", async () => {
    const { sent } = mockApi();
    renderPanel();
    fireEvent.change(await screen.findByLabelText(/Application fee/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advertisement" }));
    await waitFor(() => expect(sent.find((s) => s.method === "PATCH")).toBeTruthy());
    expect(sent.find((s) => s.method === "PATCH")!.body.feesMinor).toBeNull();
  });

  it("omits feesMinor when no fee was ever set and the field is empty", async () => {
    const { sent } = mockApi({ ad: { feesMinor: null } });
    renderPanel();
    await screen.findByLabelText(/Application fee/);
    fireEvent.click(screen.getByRole("button", { name: "Save advertisement" }));
    await waitFor(() => expect(sent.find((s) => s.method === "PATCH")).toBeTruthy());
    expect(sent.find((s) => s.method === "PATCH")!.body).not.toHaveProperty("feesMinor");
  });

  it("rejects a sub-paise fee client-side and sends nothing", async () => {
    const { sent } = mockApi();
    renderPanel();
    fireEvent.change(await screen.findByLabelText(/Application fee/), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advertisement" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at most 2 decimal places/i);
    expect(sent).toHaveLength(0);
  });

  it("is read-only once published, pointing the officer to a corrigendum", async () => {
    mockApi();
    renderPanel(true);
    expect(await screen.findByText(/must be recorded as a corrigendum/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Application fee/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save advertisement" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record corrigendum" })).toBeEnabled();
  });

  it("offers no notice actions and no edits for a cancelled vacancy", async () => {
    mockApi({ ad: { status: "cancelled" } });
    renderPanel();
    expect(await screen.findByText(/has been cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel vacancy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Extend deadline" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Application fee/)).toBeDisabled();
  });

  it("records a corrigendum only with a reason", async () => {
    const { sent } = mockApi();
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Record corrigendum" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Record corrigendum" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/what has changed/i), { target: { value: "Age limit raised to 35" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(sent.find((s) => /\/corrigendum$/.test(s.url))).toBeTruthy());
    expect(sent.find((s) => /\/corrigendum$/.test(s.url))!.body).toEqual({ changes: "Age limit raised to 35" });
  });

  it("extends the deadline forward only: an earlier date blocks confirm, a later one posts an ISO instant + reason", async () => {
    const { sent } = mockApi();
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Extend deadline" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Extend deadline" });
    fireEvent.change(within(dialog).getByLabelText(/^reason$/i), { target: { value: "Low response" } });
    fireEvent.change(within(dialog).getByLabelText(/^New deadline/), { target: { value: "2030-01-01T10:00" } });
    expect(await within(dialog).findByText(/later than the current one/i)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^New deadline/), { target: { value: "2030-12-01T10:00" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(sent.find((s) => /\/extend$/.test(s.url))).toBeTruthy());
    const body = sent.find((s) => /\/extend$/.test(s.url))!.body;
    expect(body.reason).toBe("Low response");
    // The datetime-local value is interpreted as IST (+05:30), whatever the browser zone: 10:00 IST = 04:30Z.
    expect(body.newDeadline).toBe("2030-12-01T04:30:00.000Z");
  });

  it("cancels a vacancy only after a confirmed reason (danger dialog)", async () => {
    const { sent } = mockApi();
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel vacancy" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    const confirm = within(dialog).getByRole("button", { name: "Cancel vacancy" });
    expect(confirm).toBeDisabled();
    expect(sent).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Post abolished" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(sent.find((s) => /\/cancel$/.test(s.url))).toBeTruthy());
    expect(sent.find((s) => /\/cancel$/.test(s.url))!.body).toEqual({ reason: "Post abolished" });
  });

  it("shows a clerk-safe error in the dialog when the service rejects the notice", async () => {
    mockApi({ writeStatus: 500 });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Record corrigendum" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/what has changed/i), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record corrigendum" }));
    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });

  it("shows an error with Retry, not an empty form, when the advertisement cannot be loaded", async () => {
    mockApi({ adStatus: 500 });
    renderPanel();
    expect(await screen.findByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Application fee/)).not.toBeInTheDocument();
  });
});

describe("VacancyNotificationPanel advertisement number (GAP-RECRUITMENT-HOME-05)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the number, sends it only when changed (trimmed), and does not send it when untouched", async () => {
    const { sent } = mockApi({ ad: { advertisementNo: "Advt. 03/2026" } });
    renderPanel();
    const field = await screen.findByLabelText(/Advertisement \/ notification number/);
    expect(field).toHaveValue("Advt. 03/2026");
    fireEvent.click(screen.getByRole("button", { name: "Save advertisement" }));
    await waitFor(() => expect(sent.find((s) => s.method === "PATCH")).toBeTruthy());
    expect(sent.find((s) => s.method === "PATCH")!.body).not.toHaveProperty("advertisementNo");
  });

  it("sends the new number trimmed, and null when it is cleared", async () => {
    const first = mockApi({ ad: { advertisementNo: null } });
    const { unmount } = renderPanel();
    fireEvent.change(await screen.findByLabelText(/Advertisement \/ notification number/), { target: { value: "  Advt. 07/2026 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save advertisement" }));
    await waitFor(() => expect(first.sent.find((s) => s.method === "PATCH")).toBeTruthy());
    expect(first.sent.find((s) => s.method === "PATCH")!.body.advertisementNo).toBe("Advt. 07/2026");
    unmount();

    const second = mockApi({ ad: { advertisementNo: "Advt. 03/2026" } });
    renderPanel();
    fireEvent.change(await screen.findByLabelText(/Advertisement \/ notification number/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advertisement" }));
    await waitFor(() => expect(second.sent.find((s) => s.method === "PATCH")).toBeTruthy());
    expect(second.sent.find((s) => s.method === "PATCH")!.body.advertisementNo).toBeNull();
  });

  it("is read-only once the vacancy is published", async () => {
    mockApi({ ad: { advertisementNo: "Advt. 03/2026" } });
    renderPanel(true);
    expect(await screen.findByLabelText(/Advertisement \/ notification number/)).toBeDisabled();
  });
});
