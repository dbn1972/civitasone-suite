import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MergeDialog } from "./MergeDialog";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, mergeEntities: vi.fn() };
});

const opts = [
  { id: "a", label: "Asha Rao", fields: { Name: "Asha Rao", Email: "asha@x.in" } },
  { id: "b", label: "Asha R.", fields: { Name: "Asha R.", Email: "asha@y.in" } },
];

beforeEach(() => vi.mocked(dq.mergeEntities).mockReset());

describe("MergeDialog (DQ-002)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<MergeDialog entity="contacts" options={opts} open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks review until two distinct records are chosen", () => {
    render(<MergeDialog entity="contacts" options={opts} open onClose={() => {}} />);
    const review = screen.getByRole("button", { name: /review & merge/i });
    expect(review).toBeDisabled();
    const [primary, duplicate] = screen.getAllByRole("combobox");
    fireEvent.change(primary, { target: { value: "a" } });
    fireEvent.change(duplicate, { target: { value: "a" } });
    expect(screen.getByText(/must be different records/i)).toBeInTheDocument();
    expect(review).toBeDisabled();
  });

  it("shows a field-by-field preview once both are chosen", () => {
    render(<MergeDialog entity="contacts" options={opts} open onClose={() => {}} />);
    const [primary, duplicate] = screen.getAllByRole("combobox");
    fireEvent.change(primary, { target: { value: "a" } });
    fireEvent.change(duplicate, { target: { value: "b" } });
    expect(screen.getByText("asha@x.in")).toBeInTheDocument();
    expect(screen.getByText("asha@y.in")).toBeInTheDocument();
  });

  it("requires ConfirmDialog before an irreversible merge, then submits + shows 202 message", async () => {
    vi.mocked(dq.mergeEntities).mockResolvedValueOnce(undefined);
    const onMerged = vi.fn();
    render(<MergeDialog entity="accounts" options={opts} open onClose={() => {}} onMerged={onMerged} />);
    const [primary, duplicate] = screen.getAllByRole("combobox");
    fireEvent.change(primary, { target: { value: "a" } });
    fireEvent.change(duplicate, { target: { value: "b" } });
    // merge not called yet — confirm step required
    expect(dq.mergeEntities).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /review & merge/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /merge permanently/i }));
    await waitFor(() => expect(dq.mergeEntities).toHaveBeenCalledWith("accounts", "a", "b"));
    expect(onMerged).toHaveBeenCalled();
    expect(await screen.findByText(/merge submitted/i)).toBeInTheDocument();
  });

  it("surfaces a server error and does not report success", async () => {
    vi.mocked(dq.mergeEntities).mockRejectedValueOnce(new Error("CONFLICT: busy"));
    render(<MergeDialog entity="contacts" options={opts} open onClose={() => {}} />);
    const [primary, duplicate] = screen.getAllByRole("combobox");
    fireEvent.change(primary, { target: { value: "a" } });
    fireEvent.change(duplicate, { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: /review & merge/i }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /merge permanently/i }));
    expect(await screen.findAllByText(/CONFLICT: busy/i)).not.toHaveLength(0);
    expect(screen.queryByText(/merge submitted/i)).not.toBeInTheDocument();
  });

  it("cancel from confirm keeps the dialog without merging", async () => {
    render(<MergeDialog entity="contacts" options={opts} open onClose={() => {}} />);
    const [primary, duplicate] = screen.getAllByRole("combobox");
    fireEvent.change(primary, { target: { value: "a" } });
    fireEvent.change(duplicate, { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: /review & merge/i }));
    await screen.findByRole("alertdialog");
    const dlg = screen.getByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(dq.mergeEntities).not.toHaveBeenCalled();
  });
});

