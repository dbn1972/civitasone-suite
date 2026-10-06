import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { CustomFieldsManager } from "./CustomFieldsManager";
import * as cf from "@/lib/crm/customFields";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/crm/customFields", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/customFields")>();
  return {
    ...actual,
    listCustomFields: vi.fn(),
    createCustomField: vi.fn(),
    updateCustomField: vi.fn(),
    deleteCustomField: vi.fn(),
  };
});

const field = (over: Partial<cf.CustomField> = {}): cf.CustomField => ({
  id: "f1",
  entityType: "leads",
  fieldName: "Region",
  fieldType: "select",
  validationSchema: { required: true, options: ["North", "South"] },
  ordinal: 0,
  ...over,
});

beforeEach(() => {
  vi.mocked(cf.listCustomFields).mockReset();
  vi.mocked(cf.createCustomField).mockReset();
  vi.mocked(cf.updateCustomField).mockReset();
  vi.mocked(cf.deleteCustomField).mockReset();
});

describe("CustomFieldsManager", () => {
  it("shows the saved-info badge and no fake empty table on a failed load", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "error" });
    render(<CustomFieldsManager />);
    await waitFor(() =>
      expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument(),
    );
    expect(screen.getByText(/custom fields unavailable/i)).toBeInTheDocument();
    // never presents an empty catalogue as fact
    expect(screen.queryByText(/no custom fields yet/i)).not.toBeInTheDocument();
    // and no "add" affordance while errored
    expect(screen.queryByRole("button", { name: /add custom field/i })).not.toBeInTheDocument();
  });

  it("renders the empty state only when the load succeeded", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
    render(<CustomFieldsManager />);
    await waitFor(() => expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument());
  });

  it("renders an existing select field with its options + required flag", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [field()], source: "api" });
    render(<CustomFieldsManager />);
    expect(await screen.findByDisplayValue("Region")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Required$/i)).toBeChecked();
    expect(screen.getByDisplayValue("North")).toBeInTheDocument();
    expect(screen.getByDisplayValue("South")).toBeInTheDocument();
  });

  it("blocks submit with aria-invalid + role=alert when the field name is missing", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
    render(<CustomFieldsManager />);
    await waitFor(() => expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    const name = screen.getByLabelText(/custom field name/i);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-required", "true");
    expect(cf.createCustomField).not.toHaveBeenCalled();
  });

  it("shows the options editor for a select type and blocks submit until an option exists", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
    render(<CustomFieldsManager />);
    await waitFor(() => expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    // text type -> no options editor
    expect(screen.queryByRole("button", { name: /add option/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "Region" } });
    fireEvent.change(screen.getByLabelText(/custom field type/i), { target: { value: "select" } });
    // options editor now visible
    expect(screen.getByRole("button", { name: /add option/i })).toBeInTheDocument();
    // submit with no options blocked
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(screen.getAllByText(/at least one option/i).length).toBeGreaterThan(0));
    expect(cf.createCustomField).not.toHaveBeenCalled();
  });

  it("creates a valid field then reloads", async () => {
    // Initial load empty; the post-create reload reflects the new field.
    vi.mocked(cf.listCustomFields)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValue({ data: [field({ id: "p1", fieldName: "Priority", fieldType: "text", validationSchema: null })], source: "api" });
    vi.mocked(cf.createCustomField).mockResolvedValue();
    render(<CustomFieldsManager />);
    await waitFor(() => expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "Priority" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(cf.createCustomField).toHaveBeenCalled());
    expect(vi.mocked(cf.createCustomField).mock.calls[0][0]).toMatchObject({
      entityType: "leads", fieldName: "Priority", fieldType: "text",
    });
    // Reloaded once more and the "saved" line appears (the field is reflected).
    await waitFor(() => expect(vi.mocked(cf.listCustomFields).mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByText(/“Priority” saved\./i)).toBeInTheDocument());
  });

  // GAP-CRM-CUSTOM-FIELDS-03 — save is a 202; if the reloaded list does not yet
  // contain the field, the copy must say "submitted", not "saved", and the
  // local draft must not vanish.
  it("says 'submitted' (not 'saved') while the create has not yet landed", async () => {
    vi.useFakeTimers();
    try {
      // Every list call returns empty, so the field never appears → "submitted".
      vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
      vi.mocked(cf.createCustomField).mockResolvedValue();
      render(<CustomFieldsManager />);
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
      fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "Priority" } });
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
      // Advance through all poll delays (500+1000+2000).
      await vi.advanceTimersByTimeAsync(4000);
      expect(screen.getByText(/submitted; it may take a moment/i)).toBeInTheDocument();
      // The local draft row is still present (not lost over the stale list).
      expect((screen.getByLabelText(/custom field name/i) as HTMLInputElement).value).toBe("Priority");
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes an existing field through the confirm dialog after typing its name (GAP-CRM-CUSTOM-FIELDS-04)", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [field()], source: "api" });
    vi.mocked(cf.deleteCustomField).mockResolvedValue();
    render(<CustomFieldsManager />);
    await screen.findByDisplayValue("Region");
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("alertdialog");
    // The copy must state the outcome for values already captured.
    expect(within(dialog).getByText(/permanently deleted/i)).toBeInTheDocument();
    // Confirm is blocked until the field name is typed.
    const confirmBtn = within(dialog).getByRole("button", { name: /^Delete$/i });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/type the field name to confirm/i), { target: { value: "Region" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(cf.deleteCustomField).toHaveBeenCalledWith("f1"));
  });

  // GAP-CRM-CUSTOM-FIELDS-02 — changing a saved field's type must warn inline
  // and confirm before the PATCH; editing the name alone saves without a dialog.
  it("confirms before changing a saved field's type, and warns inline", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({
      data: [field({ fieldName: "Score", fieldType: "text", validationSchema: null })],
      source: "api",
    });
    vi.mocked(cf.updateCustomField).mockResolvedValue();
    render(<CustomFieldsManager />);
    await screen.findByDisplayValue("Score");
    // Change the type from text to number.
    fireEvent.change(screen.getByLabelText(/custom field type/i), { target: { value: "number" } });
    expect(screen.getByText(/may make values already captured/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/change this field's type/i)).toBeInTheDocument();
    // Cancel makes no PATCH.
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(cf.updateCustomField).not.toHaveBeenCalled();
    // Save again and confirm -> PATCH goes through.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    const dialog2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog2).getByRole("button", { name: /change type/i }));
    await waitFor(() => expect(cf.updateCustomField).toHaveBeenCalledWith("f1", expect.objectContaining({ fieldType: "number" })));
  });

  it("saves a name-only edit on a saved field without a type-change dialog (GAP-CRM-CUSTOM-FIELDS-02)", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({
      data: [field({ fieldName: "Score", fieldType: "text", validationSchema: null })],
      source: "api",
    });
    vi.mocked(cf.updateCustomField).mockResolvedValue();
    render(<CustomFieldsManager />);
    await screen.findByDisplayValue("Score");
    fireEvent.change(screen.getByDisplayValue("Score"), { target: { value: "Lead score" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(cf.updateCustomField).toHaveBeenCalledWith("f1", expect.objectContaining({ fieldName: "Lead score", fieldType: "text" })));
    expect(screen.queryByText(/change this field's type/i)).not.toBeInTheDocument();
  });

  it("does not overwrite a newly-selected entity when a mutation from the old entity resolves late", async () => {
    vi.mocked(cf.listCustomFields).mockImplementation(async (e: cf.CfEntityType) =>
      e === "deals"
        ? { data: [field({ id: "d1", entityType: "deals", fieldName: "Deal size", fieldType: "text", validationSchema: null })], source: "api" as const }
        : { data: [], source: "api" as const },
    );
    let resolveCreate: () => void = () => {};
    vi.mocked(cf.createCustomField).mockImplementation(
      () => new Promise<void>((r) => { resolveCreate = r; }),
    );
    render(<CustomFieldsManager />);
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("leads"));
    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "Priority" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(cf.createCustomField).toHaveBeenCalled());
    // switch entity while the create is still in flight — the unsaved "Priority"
    // row makes the form dirty, so confirm the discard (GAP-CRM-CUSTOM-FIELDS-06).
    fireEvent.click(screen.getByRole("tab", { name: /^Engagements$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Discard and switch/i }));
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("deals"));
    // now the stale create resolves
    resolveCreate();
    await screen.findByDisplayValue("Deal size");
    // the deals catalogue stays live; the stale leads reload was skipped
    const leadsCalls = vi.mocked(cf.listCustomFields).mock.calls.filter((c) => c[0] === "leads");
    expect(leadsCalls).toHaveLength(1);
  });

  it("reloads the catalogue when the entity type changes", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
    render(<CustomFieldsManager />);
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("leads"));
    fireEvent.click(screen.getByRole("tab", { name: /^Engagements$/i }));
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("deals"));
  });

  // Row identity: a custom field's options were keyed by array position, so
  // removing an earlier option shifted later ones up into a different key
  // -- React patched the focused option's DOM node in place with a
  // different option's data instead of removing the right node and leaving
  // the rest (and focus) alone.
  it("keeps an option's own value and focus attached to it after an earlier option is removed", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
    render(<CustomFieldsManager />);
    await waitFor(() => expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    fireEvent.change(screen.getByLabelText(/custom field type/i), { target: { value: "select" } });

    fireEvent.click(screen.getByRole("button", { name: /add option/i }));
    fireEvent.click(screen.getByRole("button", { name: /add option/i }));
    fireEvent.click(screen.getByRole("button", { name: /add option/i }));

    const thirdOption = screen.getAllByLabelText(/^Option \d+$/)[2]!;
    fireEvent.change(thirdOption, { target: { value: "West" } });
    thirdOption.focus();
    expect(document.activeElement).toBe(thirdOption);

    // Remove the first option -- options 2-3 shift up to become 1-2.
    fireEvent.click(screen.getAllByRole("button", { name: /remove option/i })[0]!);

    const survivingThirdOption = screen.getAllByLabelText(/^Option \d+$/)[1]!;
    expect(survivingThirdOption).toHaveValue("West");
    expect(document.activeElement).toBe(survivingThirdOption);
  });

  describe("sensitive-field controls (GAP-CRM-CUSTOM-FIELDS-01)", () => {
    async function addBlankField() {
      vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
      render(<CustomFieldsManager />);
      await waitFor(() => expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    }

    it("warns and pre-ticks Sensitive when a field is named like a statutory identifier", async () => {
      await addBlankField();
      const sensitive = screen.getByLabelText(/sensitive \(mask on records\)/i);
      expect(sensitive).not.toBeChecked();
      expect(screen.queryByText(/looks like a statutory identifier/i)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "Aadhaar" } });

      expect(screen.getByText(/looks like a statutory identifier/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/sensitive \(mask on records\)/i)).toBeChecked();
      // role-visibility picker appears once the field is sensitive
      expect(screen.getByLabelText(/visible to crm_admin/i)).toBeInTheDocument();
    });

    it("does not pre-tick Sensitive for an ordinary field name", async () => {
      await addBlankField();
      fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "Nickname" } });
      expect(screen.getByLabelText(/sensitive \(mask on records\)/i)).not.toBeChecked();
      expect(screen.queryByText(/looks like a statutory identifier/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/visible to crm_admin/i)).not.toBeInTheDocument();
    });

    it("sends sensitive + visibleToRoles in the saved definition", async () => {
      vi.mocked(cf.createCustomField).mockResolvedValue(undefined);
      await addBlankField();
      fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "PAN" } });
      fireEvent.click(screen.getByLabelText(/visible to crm_admin/i));
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

      await waitFor(() => expect(cf.createCustomField).toHaveBeenCalledTimes(1));
      const draft = vi.mocked(cf.createCustomField).mock.calls[0]![0];
      expect(draft.sensitive).toBe(true);
      expect(draft.visibleToRoles).toEqual(["crm_admin"]);
      expect(cf.buildValidationSchema(draft)).toEqual({ sensitive: true, visibleToRoles: ["crm_admin"] });
    });

    it("loads an existing sensitive field with its flag and roles ticked", async () => {
      vi.mocked(cf.listCustomFields).mockResolvedValue({
        data: [field({ fieldName: "Passport No", fieldType: "text", validationSchema: { sensitive: true, visibleToRoles: ["super_admin"] } })],
        source: "api",
      });
      render(<CustomFieldsManager />);
      expect(await screen.findByDisplayValue("Passport No")).toBeInTheDocument();
      expect(screen.getByLabelText(/sensitive \(mask on records\)/i)).toBeChecked();
      expect(screen.getByLabelText(/visible to super_admin/i)).toBeChecked();
      expect(screen.getByLabelText(/visible to crm_admin/i)).not.toBeChecked();
    });
  });
});

describe("validateDraft duplicate name (GAP-CRM-CUSTOM-FIELDS-05)", () => {
  const base: cf.CustomFieldDraft = {
    entityType: "leads", fieldName: "", fieldType: "text", required: false,
    options: [], ordinal: 0, sensitive: false, visibleToRoles: [],
  };
  it("flags a case/whitespace-insensitive duplicate name among siblings", () => {
    const a = { ...base, id: "a", fieldName: "Grade" };
    const b = { ...base, id: "b", fieldName: " grade " };
    const errors = cf.validateDraft(b, [a, b]);
    expect(errors.fieldName).toBe("A field with this name already exists.");
  });
  it("does not flag a row against itself (unchanged name)", () => {
    const a = { ...base, id: "a", fieldName: "Grade" };
    expect(cf.validateDraft(a, [a]).fieldName).toBeUndefined();
  });
  it("accepts a unique name", () => {
    const a = { ...base, id: "a", fieldName: "Grade" };
    const b = { ...base, id: "b", fieldName: "Region" };
    expect(cf.validateDraft(b, [a, b]).fieldName).toBeUndefined();
  });
});

describe("ENTITY_TYPE_LABELS canonical term (GAP-CRM-CUSTOM-FIELDS-07)", () => {
  it("labels deals as 'Engagements' while keeping the API key 'deals'", () => {
    expect(cf.ENTITY_TYPE_LABELS.deals).toBe("Engagements");
    expect(cf.ENTITY_TYPES).toContain("deals");
  });
});

describe("CustomFieldsManager entity-switch dirty guard (GAP-CRM-CUSTOM-FIELDS-06)", () => {
  it("confirms before discarding an unsaved new row; Keep editing stays put", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
    render(<CustomFieldsManager />);
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("leads"));
    // Add a blank new row -> dirty.
    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    fireEvent.change(screen.getByLabelText(/custom field name/i), { target: { value: "Priority" } });
    // Switching entity now prompts a discard confirm.
    fireEvent.click(screen.getByRole("tab", { name: /^Engagements$/i }));
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    // Keep editing -> no reload for deals, row preserved.
    fireEvent.click(screen.getByRole("button", { name: /Keep editing/i }));
    expect(vi.mocked(cf.listCustomFields).mock.calls.filter((c) => c[0] === "deals")).toHaveLength(0);
    expect(screen.getByDisplayValue("Priority")).toBeInTheDocument();
  });

  it("switches immediately with no confirm when nothing is dirty", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
    render(<CustomFieldsManager />);
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("leads"));
    fireEvent.click(screen.getByRole("tab", { name: /^Engagements$/i }));
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("deals"));
  });
});
