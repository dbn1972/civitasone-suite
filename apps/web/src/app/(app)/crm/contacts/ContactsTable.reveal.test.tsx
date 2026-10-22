import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, seed: unknown) => ({
    data: seed,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance: "live",
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import { ContactsTable } from "./ContactsTable";

// What the server page hands the table: ALREADY masked, for every role.
const contacts = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Priya Sharma", account: "NDMA", phone: "98XXXXX210", email: "p***@n****.g**.i*", leadStatus: "new" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Rajan Singh", account: "MoF", phone: null, email: null, leadStatus: "new" },
];

beforeEach(() => {
  browserFetchMock.mockReset();
});

describe("ContactsTable audited PII reveal (GAP-CRM-CONTACTS-02)", () => {
  it("default render shows the masked phone/email and no reveal control for a role without reveal rights", () => {
    renderWithIntl(<ContactsTable contacts={contacts as never} canReveal={false} />);
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
    expect(screen.getByText("p***@n****.g**.i*")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  it("shows the masked value (not the clear one) by default for a role that may reveal, with a Reveal per value", () => {
    renderWithIntl(<ContactsTable contacts={contacts as never} canReveal />);
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
    // one phone + one email reveal for the contact that has them; none for the empty row
    expect(screen.getAllByRole("button", { name: "Reveal" })).toHaveLength(2);
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  it("reveal needs a reason, makes exactly one audited call, then shows the clear value", async () => {
    browserFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { resourceType: "contact", field: "phone", value: "9876543210" } }),
    } as unknown as Response);
    renderWithIntl(<ContactsTable contacts={contacts as never} canReveal />);

    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    // no call until a substantive reason is confirmed
    expect(browserFetchMock).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Verifying the citizen's number for a callback" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));

    expect(await screen.findByText("9876543210")).toBeInTheDocument();
    expect(browserFetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = browserFetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(path).toBe("v1/crm/pii/reveal");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      resourceType: "contact",
      resourceId: "11111111-1111-4111-8111-111111111111",
      field: "phone",
      reason: "Verifying the citizen's number for a callback",
    });
    // the masked placeholder is replaced while revealed
    await waitFor(() => expect(screen.queryByText("98XXXXX210")).not.toBeInTheDocument());
  });

  it("a refused reveal (403) keeps the value masked and says so", async () => {
    browserFetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as unknown as Response);
    renderWithIntl(<ContactsTable contacts={contacts as never} canReveal />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Verifying the citizen's number for a callback" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));
    expect(await screen.findByText("You do not have permission to reveal this value.")).toBeInTheDocument();
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
  });
});
