import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DocumentTypesEditor } from "./DocumentTypesEditor";
import * as dm from "@/lib/crm/documents";

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
  id: "t1", code: "pan", name: "PAN card", appliesTo: ["contact"],
  mandatory: true, expiryRequired: false, verificationRequired: true, enabled: true, ...over,
});

beforeEach(() => {
  vi.mocked(dm.getDocumentTypes).mockReset();
  vi.mocked(dm.createDocumentType).mockReset();
  vi.mocked(dm.updateDocumentType).mockReset();
  vi.mocked(dm.deleteDocumentType).mockReset();
});

describe("DocumentTypesEditor (DM-002)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "error" });
    render(<DocumentTypesEditor />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/document types unavailable/i)).toBeInTheDocument();
  });

  it("renders an existing type with its flags", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type()], source: "api" });
    render(<DocumentTypesEditor />);
    expect(await screen.findByDisplayValue("PAN card")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Mandatory$/i)).toBeChecked();
    expect(screen.getByLabelText(/^Verification required$/i)).toBeChecked();
  });

  it("blocks save until code and name are present", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "api" });
    render(<DocumentTypesEditor />);
    await waitFor(() => expect(screen.getByText(/no document types yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add document type/i }));
    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/document type code/i), { target: { value: "gst" } });
    fireEvent.change(screen.getByLabelText(/document type name/i), { target: { value: "GST cert" } });
    expect(saveBtn).not.toBeDisabled();
  });

  it("creates a new type with applies-to + flags then reloads", async () => {
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
    expect(vi.mocked(dm.getDocumentTypes)).toHaveBeenCalledTimes(2);
  });

  it("updates an existing type via PUT with its id", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type()], source: "api" });
    vi.mocked(dm.updateDocumentType).mockResolvedValue();
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    fireEvent.change(screen.getByDisplayValue("PAN card"), { target: { value: "PAN document" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(dm.updateDocumentType).toHaveBeenCalledWith("t1", expect.objectContaining({ name: "PAN document" })));
  });

  it("deletes a type through the confirm dialog", async () => {
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type()], source: "api" });
    vi.mocked(dm.deleteDocumentType).mockResolvedValue();
    render(<DocumentTypesEditor />);
    await screen.findByDisplayValue("PAN card");
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(dm.deleteDocumentType).toHaveBeenCalledWith("t1"));
  });
});
