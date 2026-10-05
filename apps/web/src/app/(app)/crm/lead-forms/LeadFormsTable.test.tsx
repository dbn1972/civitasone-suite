import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider as __Intl } from "next-intl";
import __enMessages from "@/messages/en.json";
function render(ui: React.ReactElement) {
  return rtlRender(<__Intl locale="en" messages={__enMessages}>{ui}</__Intl>);
}
import { LeadFormsTable } from "./LeadFormsTable";
import type { CRMLeadCaptureForm } from "@civitasone/types";
import * as client from "@/lib/crm/leadForms";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/crm/leadForms", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadForms")>();
  return { ...actual, createLeadForm: vi.fn(), updateLeadForm: vi.fn(), setLeadFormEnabled: vi.fn(), setLeadFormConsent: vi.fn() };
});

function form(partial: Partial<CRMLeadCaptureForm> = {}): CRMLeadCaptureForm {
  return {
    id: "f1", tenantId: "t1", formKey: "a".repeat(64), name: "Homepage contact",
    enabled: true, requireConsent: true, allowedOrigins: ["https://example.gov.in"],
    defaultLeadSource: "public_form", campaignId: null, maxPerMinute: 60, version: 1,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...partial,
  };
}

beforeEach(() => {
  refreshMock.mockReset();
  vi.mocked(client.createLeadForm).mockReset();
  vi.mocked(client.updateLeadForm).mockReset();
  vi.mocked(client.setLeadFormEnabled).mockReset();
  vi.mocked(client.setLeadFormConsent).mockReset();
});

describe("LeadFormsTable (GAP-CRM-LEAD-FORMS-01)", () => {
  it("registers a form and shows the minted public key", async () => {
    vi.mocked(client.createLeadForm).mockResolvedValue({ formKey: "b".repeat(64) });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadFormsTable rows={[]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /register form/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New form" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /register form/i }));
    await waitFor(() => expect(client.createLeadForm).toHaveBeenCalledWith(expect.objectContaining({ name: "New form" })));
    expect(await screen.findByText(new RegExp("b".repeat(10)))).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("edits an existing form via PATCH", async () => {
    vi.mocked(client.updateLeadForm).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadFormsTable rows={[form()]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save form/i }));
    await waitFor(() => expect(client.updateLeadForm).toHaveBeenCalledWith("f1", expect.objectContaining({ name: "Renamed" })));
  });

  it("pauses an enabled form", async () => {
    vi.mocked(client.setLeadFormEnabled).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadFormsTable rows={[form({ enabled: true })]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(client.setLeadFormEnabled).toHaveBeenCalledWith("f1", false));
    expect(await screen.findByText(/form paused/i)).toBeInTheDocument();
  });

  it("offers Fix consent only on an unlawful form and sets requireConsent", async () => {
    vi.mocked(client.setLeadFormConsent).mockResolvedValue(undefined);
    // enabled + requireConsent:false => unlawful
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadFormsTable rows={[form({ requireConsent: false })]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /fix consent/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /require consent/i }));
    await waitFor(() => expect(client.setLeadFormConsent).toHaveBeenCalledWith("f1", true));
    expect(await screen.findByText(/consent is now required/i)).toBeInTheDocument();
  });

  it("does not offer Fix consent on a lawful form", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadFormsTable rows={[form({ requireConsent: true })]} /></NextIntlClientProvider>);
    expect(screen.queryByRole("button", { name: /fix consent/i })).not.toBeInTheDocument();
  });

  // GAP-CRM-LEAD-FORMS-03: the consent-gap status shows the human label
  // "Consent not required", never the raw "unlawful" enum.
  it("labels a consent-gap form 'Consent not required', never 'unlawful'", () => {
    render(<LeadFormsTable rows={[form({ enabled: true, requireConsent: false })]} />);
    expect(screen.getByText("Consent not required")).toBeInTheDocument();
    expect(screen.queryByText("unlawful")).not.toBeInTheDocument();
  });

  it("labels an enabled, consenting form 'Live' and a disabled one 'Paused'", () => {
    render(<LeadFormsTable rows={[form({ enabled: true, requireConsent: true, name: "A" }), form({ id: "f2", enabled: false, name: "B" })]} />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  // F2-05: the CSV export is now SERVER-AUDITED — the button opens the purpose
  // dialog (purpose recorded in the audit trail) and the server omits the form key.
  it("asks for a purpose before exporting the registry CSV", async () => {
    render(<LeadFormsTable rows={[form()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(await screen.findByText(/Export the lead-form registry\?/i)).toBeInTheDocument();
    expect(screen.getByText(/public form KEY is deliberately omitted/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Purpose/i)).toBeInTheDocument();
  });
});

describe("LeadFormsTable (GAP-CRM-LEAD-FORMS-05)", () => {
  it("shows every allowed origin via a title tooltip on the collapsed summary", () => {
    render(
      <LeadFormsTable
        rows={[form({ allowedOrigins: ["https://a.gov.in", "https://b.gov.in", "https://c.gov.in"] })]}
      />,
    );
    const cell = screen.getByText("https://a.gov.in +2 more");
    expect(cell).toHaveAttribute("title", "https://a.gov.in\nhttps://b.gov.in\nhttps://c.gov.in");
  });

  it("copies the absolute submit URL to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LeadFormsTable rows={[form({ formKey: "k".repeat(64) })]} />);
    fireEvent.click(screen.getByRole("button", { name: /copy url/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("/api/v1/crm/public/leads/" + "k".repeat(64));
    expect(copied).toMatch(/^https?:\/\//);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("reveals an embed snippet containing the absolute action URL", () => {
    render(<LeadFormsTable rows={[form({ formKey: "m".repeat(64) })]} />);
    fireEvent.click(screen.getByRole("button", { name: /embed snippet/i }));
    expect(screen.getByText(/<form method="POST"/)).toBeInTheDocument();
  });

  it("filters rows by name", () => {
    render(
      <LeadFormsTable
        rows={[form({ id: "f1", name: "Homepage contact" }), form({ id: "f2", name: "Careers enquiry" })]}
      />,
    );
    expect(screen.getByText("Homepage contact")).toBeInTheDocument();
    expect(screen.getByText("Careers enquiry")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/filter by form/i), { target: { value: "Careers" } });
    expect(screen.queryByText("Homepage contact")).not.toBeInTheDocument();
    expect(screen.getByText("Careers enquiry")).toBeInTheDocument();
  });
});
