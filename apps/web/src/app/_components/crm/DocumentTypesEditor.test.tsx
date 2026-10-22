import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DocumentTypesEditor } from "./DocumentTypesEditor";
import * as dm from "@/lib/crm/documents";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/crm/documents", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/documents")>();
  return {
    ...actual,
    getDocumentTypes: vi.fn(),
    createDocumentType: vi.fn(),
    updateDocumentType: vi.fn(),
    deleteDocumentType: vi.fn(),
  };
});

const type = (over: Partial<dm.DocumentType> = {}): dm.DocumentType => ({
  id: "t1",
  code: "pan",
  name: "PAN Card",
  appliesTo: ["contact"],
  mandatory: false,
  expiryRequired: false,
  verificationRequired: false,
  enabled: true,
  ...over,
});

beforeEach(() => {
  vi.mocked(dm.getDocumentTypes).mockReset();
  vi.mocked(dm.createDocumentType).mockReset();
  vi.mocked(dm.updateDocumentType).mockReset();
  vi.mocked(dm.deleteDocumentType).mockReset();
});

describe("DocumentTypesEditor error state (GAP-CRM-DOCUMENT-TYPES-04)", () => {
  it("shows exactly one data-source badge plus a working Retry on a failed load", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "error" });
    render(<DocumentTypesEditor />);
    // Exactly one DataSourceBadge (header only — no duplicate inline badge).
    await waitFor(() => expect(screen.getAllByText(/showing nothing/i).length).toBe(1));
    // A real retry action is offered (ErrorState).
    const retry = screen.getByRole("button", { name: /try again|retry/i });
    expect(retry).toBeInTheDocument();
    // Clicking Retry re-runs the client fetch (load()).
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type()], source: "api" });
    fireEvent.click(retry);
    expect(await screen.findByDisplayValue("PAN Card")).toBeInTheDocument();
  });
});

describe("DocumentTypesEditor save merge (GAP-CRM-DOCUMENT-TYPES-06)", () => {
  it("keeps unsaved edits to row B when row A is saved", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({
      data: [type({ id: "A", code: "a", name: "Alpha" }), type({ id: "B", code: "b", name: "Bravo" })],
      source: "api",
    });
    vi.mocked(dm.updateDocumentType).mockResolvedValue();
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("Alpha");

    // Edit row B's name (unsaved).
    const bInput = screen.getByDisplayValue("Bravo");
    fireEvent.change(bInput, { target: { value: "Bravo EDITED" } });

    // Save row A. The post-save refetch returns the ORIGINAL server list (row B
    // still "Bravo"); the merge must NOT clobber row B's local "Bravo EDITED".
    const aRow = screen.getByDisplayValue("Alpha").closest("li") as HTMLElement;
    fireEvent.click(within(aRow).getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(dm.updateDocumentType).toHaveBeenCalledWith("A", expect.objectContaining({ code: "a" })));
    // Row B's unsaved edit survives the save of row A.
    await waitFor(() => expect(screen.getByDisplayValue("Bravo EDITED")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Bravo")).not.toBeInTheDocument();
  });
});

// GAP-CRM-DOCUMENT-TYPES-02/03: behaviours the earlier (pre-redesign) suite covered
// and that still exist in the card-per-type markup. Restored against the new markup.
describe("DocumentTypesEditor (DM-002)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "error" });
    render(<DocumentTypesEditor />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    // The header data-source badge marks the failed load (never a fabricated empty catalogue).
    expect(screen.getByText(/showing nothing/i)).toBeInTheDocument();
    expect(screen.queryByText(/no document types yet/i)).not.toBeInTheDocument();
  });

  it("renders an existing type with its flags", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({
      data: [type({ name: "PAN card", mandatory: true, verificationRequired: true })],
      source: "api",
    });
    render(<DocumentTypesEditor />);
    expect(await screen.findByDisplayValue("PAN card")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Mandatory$/i)).toBeChecked();
    expect(screen.getByLabelText(/^Verification required$/i)).toBeChecked();
    expect(screen.getByLabelText(/^Expiry required$/i)).not.toBeChecked();
    expect(screen.getByLabelText(/^Enabled$/i)).toBeChecked();
  });

  it("blocks save until code, name and at least one record type are present (GAP-CRM-DOCUMENT-TYPES-02)", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "api" });
    render(<DocumentTypesEditor />);
    await waitFor(() => expect(screen.getByText(/no document types yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add document type/i }));
    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/document type code/i), { target: { value: "gst" } });
    fireEvent.change(screen.getByLabelText(/document type name/i), { target: { value: "GST cert" } });
    // Still disabled with no record type selected.
    expect(saveBtn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/^Account$/i));
    expect(saveBtn).not.toBeDisabled();
  });

  it("shows the Applies-to hint while no record type is selected (GAP-CRM-DOCUMENT-TYPES-02)", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "api" });
    render(<DocumentTypesEditor />);
    await waitFor(() => expect(screen.getByText(/no document types yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add document type/i }));
    fireEvent.change(screen.getByLabelText(/document type code/i), { target: { value: "gst" } });
    fireEvent.change(screen.getByLabelText(/document type name/i), { target: { value: "GST cert" } });
    // Save is disabled, so the attempt is prevented; the helper text under the
    // fieldset is always present and nothing is submitted.
    expect(screen.getAllByText(/select at least one record type/i).length).toBeGreaterThan(0);
    expect(dm.createDocumentType).not.toHaveBeenCalled();
  });

  it("creates a new type with applies-to + flags then merges the saved row", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(dm.createDocumentType).mockResolvedValue();
    render(<DocumentTypesEditor />);
    await waitFor(() => expect(screen.getByText(/no document types yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add document type/i }));
    fireEvent.change(screen.getByLabelText(/document type code/i), { target: { value: "gst" } });
    fireEvent.change(screen.getByLabelText(/document type name/i), { target: { value: "GST cert" } });
    fireEvent.click(screen.getByLabelText(/^Account$/i));
    fireEvent.click(screen.getByLabelText(/^Expiry required$/i));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(dm.createDocumentType).toHaveBeenCalled());
    expect(vi.mocked(dm.createDocumentType).mock.calls[0][0]).toMatchObject({
      code: "gst", name: "GST cert", appliesTo: ["account"], expiryRequired: true,
    });
    // The post-save refetch is silent (GAP-CRM-DOCUMENT-TYPES-06): one initial load + one merge fetch.
    await waitFor(() => expect(vi.mocked(dm.getDocumentTypes)).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/document type .GST cert. saved/i)).toBeInTheDocument();
  });

  it("updates an existing type via PUT with its id", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type({ name: "PAN card" })], source: "api" });
    vi.mocked(dm.updateDocumentType).mockResolvedValue();
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    fireEvent.change(screen.getByDisplayValue("PAN card"), { target: { value: "PAN document" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(dm.updateDocumentType).toHaveBeenCalledWith("t1", expect.objectContaining({ name: "PAN document" })));
  });

  it("deletes an unused type through the confirm dialog with a required reason (GAP-CRM-DOCUMENT-TYPES-03)", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type({ name: "PAN card", documentCount: 0 })], source: "api" });
    vi.mocked(dm.deleteDocumentType).mockResolvedValue();
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("alertdialog");
    // Copy states the real outcome: nothing is filed under this type, so it is simply removed.
    expect(within(dialog).getByText(/has no documents filed under it/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/keep their type/i)).not.toBeInTheDocument();
    const confirmBtn = within(dialog).getByRole("button", { name: /^Delete$/i });
    // Confirm is blocked until a reason is given.
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason for deletion/i), { target: { value: "superseded by new catalogue" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(dm.deleteDocumentType).toHaveBeenCalledWith("t1", "superseded by new catalogue"));
    // Only the deleted row leaves local state (no wholesale reload).
    await waitFor(() => expect(screen.queryByDisplayValue("PAN card")).not.toBeInTheDocument());
  });

  // The foreign key from documents to their type cannot be satisfied by deleting a
  // type that documents still use, so the editor says so up front instead of
  // offering a Delete that can only fail, and points at the Enabled switch.
  it("disables Delete for a type that documents still use and says how many (GAP-CRM-DOCUMENT-TYPES-03)", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type({ name: "PAN card", documentCount: 3 })], source: "api" });
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    const del = screen.getByRole("button", { name: /^Delete$/i });
    expect(del).toBeDisabled();
    const hint = screen.getByText(/3 documents use this type, so it can.t be deleted/i);
    expect(hint).toHaveTextContent(/turn off enabled/i);
    // The button is programmatically tied to the explanation.
    expect(del.getAttribute("aria-describedby")).toBe(hint.id);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("uses the singular for exactly one document", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type({ name: "PAN card", documentCount: 1 })], source: "api" });
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    expect(screen.getByText(/1 document uses this type/i)).toBeInTheDocument();
  });

  it("does not claim documents 'keep' a type when usage is unknown; the server still guards the delete", async () => {
    // Older API: no documentCount reported -> undefined, NOT zero.
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type({ name: "PAN card" })], source: "api" });
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    const del = screen.getByRole("button", { name: /^Delete$/i });
    expect(del).not.toBeDisabled();
    fireEvent.click(del);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/the delete is refused/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/keep their type/i)).not.toBeInTheDocument();
  });

  it("surfaces the server's refusal when a type turned out to be in use", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type({ name: "PAN card", documentCount: 0 })], source: "api" });
    vi.mocked(dm.deleteDocumentType).mockRejectedValue(new Error("1 document still uses this document type, so it cannot be deleted."));
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for deletion/i), { target: { value: "cleanup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    expect(await screen.findByText(/still uses this document type/i)).toBeInTheDocument();
    // The row stays.
    expect(screen.getByDisplayValue("PAN card")).toBeInTheDocument();
  });
});
