import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { AccountRelationshipsEditor } from "./AccountRelationshipsEditor";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getAccountRelationships: vi.fn(), createAccountRelationship: vi.fn(), deleteAccountRelationship: vi.fn() };
});

const rel: aa.AccountRelationship = { id: "x1", toAccountId: "acc2", relType: "subsidiary", toAccountName: "Sub Ltd" };

/** The server-side account search the picker calls (GAP-CRM-ACCOUNTS-DETAIL-01). */
const SEARCH_RESULTS = [
  { id: "acc1", name: "Self Org", industry: null },
  { id: "acc2", name: "Sub Ltd", industry: "Energy" },
  { id: "acc3", name: "Partner Co", industry: null },
];
function mockAccountSearch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ data: SEARCH_RESULTS }), { status: 200 }),
  );
}
const render = renderWithIntl;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(aa.getAccountRelationships).mockReset();
  vi.mocked(aa.createAccountRelationship).mockReset();
  vi.mocked(aa.deleteAccountRelationship).mockReset();
});

describe("AccountRelationshipsEditor (CM-002)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [], source: "error" });
    render(<AccountRelationshipsEditor accountId="acc1" />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
  });

  it("searches accounts server-side, hides the account itself, and blocks add with no target", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [], source: "api" });
    const fetchSpy = mockAccountSearch();
    render(<AccountRelationshipsEditor accountId="acc1" />);
    await waitFor(() => expect(screen.getByText(/no relationships yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: /related account/i }), { target: { value: "o" } });
    await screen.findByRole("option", { name: /Partner Co/ });
    // It asked the server (not a pre-loaded list) and the account itself is not offered.
    const url = new URL(String(fetchSpy.mock.calls[0]![0]), "http://x");
    expect(url.pathname).toBe("/api/proxy/v1/crm/accounts");
    expect(url.searchParams.get("search")).toBe("o");
    expect(screen.queryByRole("option", { name: /Self Org/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add relationship/i }));
    expect(await screen.findByText(/choose the account/i)).toBeInTheDocument();
    expect(aa.createAccountRelationship).not.toHaveBeenCalled();
  });

  it("adds a relationship then reloads", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createAccountRelationship).mockResolvedValue(undefined);
    mockAccountSearch();
    render(<AccountRelationshipsEditor accountId="acc1" />);
    await waitFor(() => expect(screen.getByText(/no relationships yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^relationship$/i), { target: { value: "partner" } });
    fireEvent.change(screen.getByRole("combobox", { name: /related account/i }), { target: { value: "part" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Partner Co/ }));
    fireEvent.click(screen.getByRole("button", { name: /add relationship/i }));
    await waitFor(() => expect(aa.createAccountRelationship).toHaveBeenCalledWith("acc1", "acc3", "partner"));
  });

  it("shows a neutral label, never the raw id, for a link whose target name was not returned", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({
      data: [{ id: "x9", toAccountId: "3f2a1b4c-0000-4000-8000-000000000001", relType: "partner" }],
      source: "api",
    });
    render(<AccountRelationshipsEditor accountId="acc1" />);
    expect(await screen.findByRole("link", { name: "Unnamed account" })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("3f2a1b4c-0000-4000-8000-000000000001");
  });

  it("groups existing links by type and removes one via ConfirmDialog", async () => {
    vi.mocked(aa.getAccountRelationships).mockResolvedValue({ data: [rel], source: "api" });
    vi.mocked(aa.deleteAccountRelationship).mockResolvedValue(undefined);
    render(<AccountRelationshipsEditor accountId="acc1" />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Sub Ltd" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /remove subsidiary link to sub ltd/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /remove relationship/i }));
    await waitFor(() => expect(aa.deleteAccountRelationship).toHaveBeenCalledWith("acc1", "x1"));
  });
});
