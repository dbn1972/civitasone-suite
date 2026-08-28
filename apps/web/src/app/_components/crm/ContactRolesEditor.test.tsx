import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ContactRolesEditor } from "./ContactRolesEditor";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getContactRoles: vi.fn(), createContactRole: vi.fn(), deleteContactRole: vi.fn() };
});

const DEAL = "11111111-1111-1111-1111-111111111111";
const role: aa.ContactRole = { id: "r1", contactId: "c1", dealId: DEAL, role: "champion", createdAt: "2026-01-01T00:00:00Z" };

beforeEach(() => {
  vi.mocked(aa.getContactRoles).mockReset();
  vi.mocked(aa.createContactRole).mockReset();
  vi.mocked(aa.deleteContactRole).mockReset();
});

describe("ContactRolesEditor (CM-003)", () => {
  it("offers the expanded vocabulary including beneficiary/partner/billing", async () => {
    vi.mocked(aa.getContactRoles).mockResolvedValue({ data: [], source: "api" });
    render(<ContactRolesEditor contactId="c1" />);
    await waitFor(() => expect(screen.getByText(/no deal roles yet/i)).toBeInTheDocument());
    const select = screen.getByLabelText(/^role$/i);
    expect(within(select).getByRole("option", { name: "Beneficiary" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Partner" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Billing contact" })).toBeInTheDocument();
  });

  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getContactRoles).mockResolvedValue({ data: [], source: "error" });
    render(<ContactRolesEditor contactId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
  });

  it("blocks add when the deal id is not a uuid", async () => {
    vi.mocked(aa.getContactRoles).mockResolvedValue({ data: [], source: "api" });
    render(<ContactRolesEditor contactId="c1" />);
    await waitFor(() => expect(screen.getByText(/no deal roles yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/deal id/i), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: /add role/i }));
    expect(await screen.findByText(/enter the deal id/i)).toBeInTheDocument();
    expect(aa.createContactRole).not.toHaveBeenCalled();
  });

  it("adds a role for a deal then reloads", async () => {
    vi.mocked(aa.getContactRoles).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createContactRole).mockResolvedValue({ accepted: true });
    render(<ContactRolesEditor contactId="c1" />);
    await waitFor(() => expect(screen.getByText(/no deal roles yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: "beneficiary" } });
    fireEvent.change(screen.getByLabelText(/deal id/i), { target: { value: DEAL } });
    fireEvent.click(screen.getByRole("button", { name: /add role/i }));
    await waitFor(() => expect(aa.createContactRole).toHaveBeenCalledWith("c1", DEAL, "beneficiary"));
  });

  it("removes a role via ConfirmDialog", async () => {
    vi.mocked(aa.getContactRoles).mockResolvedValue({ data: [role], source: "api" });
    vi.mocked(aa.deleteContactRole).mockResolvedValue(undefined);
    render(<ContactRolesEditor contactId="c1" />);
    await waitFor(() => expect(screen.getByText("Champion")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /remove champion role/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /remove role/i }));
    await waitFor(() => expect(aa.deleteContactRole).toHaveBeenCalledWith("c1", "r1"));
  });
});
