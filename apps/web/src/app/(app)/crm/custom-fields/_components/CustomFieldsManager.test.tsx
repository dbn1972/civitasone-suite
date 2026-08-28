import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CustomFieldsManager } from "./CustomFieldsManager";
import * as cf from "@/lib/crm/customFields";

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
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [], source: "api" });
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
    expect(vi.mocked(cf.listCustomFields)).toHaveBeenCalledTimes(2);
  });

  it("deletes an existing field through the confirm dialog", async () => {
    vi.mocked(cf.listCustomFields).mockResolvedValue({ data: [field()], source: "api" });
    vi.mocked(cf.deleteCustomField).mockResolvedValue();
    render(<CustomFieldsManager />);
    await screen.findByDisplayValue("Region");
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(cf.deleteCustomField).toHaveBeenCalledWith("f1"));
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
    // switch entity while the create is still in flight
    fireEvent.click(screen.getByRole("tab", { name: /^Deals$/i }));
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
    fireEvent.click(screen.getByRole("tab", { name: /^Deals$/i }));
    await waitFor(() => expect(cf.listCustomFields).toHaveBeenCalledWith("deals"));
  });
});
