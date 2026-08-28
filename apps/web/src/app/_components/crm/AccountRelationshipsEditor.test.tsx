import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AccountRelationshipsEditor } from "./AccountRelationshipsEditor";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getAccountRelationships: vi.fn(), createAccountRelationship: vi.fn(), deleteAccountRelationship: vi.fn() };
});

const rel: aa.AccountRelationship = { id: "x1", toAccountId: "acc2", relType: "subsidiary", toAccountName: "Sub Ltd" };
const options = [{ id: "acc1", name: "Self" }, { id: "acc2", name: "Sub Ltd" }, { id: "acc3", name: "Partner Co" }];

beforeEach(() => {
  vi.mocked(aa.getAccountRelationships).mockReset();
  vi.mocked(aa.createAccountRelationship).mockReset();
  vi.mocked(aa.deleteAccountRelationship).mockReset();
});

describe("AccountRelationshipsEditor (CM-002)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [], source: "error" });
    render(<AccountRelationshipsEditor accountId="acc1" accountOptions={options} />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
  });

  it("filters self out of the target picker and blocks add with no target", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [], source: "api" });
    render(<AccountRelationshipsEditor accountId="acc1" accountOptions={options} />);
    await waitFor(() => expect(screen.getByText(/no relationships yet/i)).toBeInTheDocument());
    const select = screen.getByLabelText(/related account/i);
    expect(within(select).queryByRole("option", { name: "Self" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add relationship/i }));
    expect(await screen.findByText(/choose the account/i)).toBeInTheDocument();
    expect(aa.createAccountRelationship).not.toHaveBeenCalled();
  });

  it("adds a relationship then reloads", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createAccountRelationship).mockResolvedValue(undefined);
    render(<AccountRelationshipsEditor accountId="acc1" accountOptions={options} />);
    await waitFor(() => expect(screen.getByText(/no relationships yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^relationship$/i), { target: { value: "partner" } });
    fireEvent.change(screen.getByLabelText(/related account/i), { target: { value: "acc3" } });
    fireEvent.click(screen.getByRole("button", { name: /add relationship/i }));
    await waitFor(() => expect(aa.createAccountRelationship).toHaveBeenCalledWith("acc1", "acc3", "partner"));
  });

  it("groups existing links by type and removes one via ConfirmDialog", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [rel], source: "api" });
    vi.mocked(aa.deleteAccountRelationship).mockResolvedValue(undefined);
    render(<AccountRelationshipsEditor accountId="acc1" accountOptions={options} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Sub Ltd" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /remove subsidiary link to sub ltd/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /remove relationship/i }));
    await waitFor(() => expect(aa.deleteAccountRelationship).toHaveBeenCalledWith("acc1", "x1"));
  });
});
