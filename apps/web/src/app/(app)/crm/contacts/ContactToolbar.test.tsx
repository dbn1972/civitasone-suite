import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import { ContactToolbar } from "./ContactToolbar";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function renderToolbar(props: Parameters<typeof ContactToolbar>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ContactToolbar {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ContactToolbar export (GAP-CRM-CONTACTS-01)", () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
    // jsdom lacks these; the export triggers a client-side CSV download.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("hides the export control from a non-privileged role", () => {
    renderToolbar({ canExport: false });
    expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  it("requires a purpose before exporting and forwards it + active filters, as CSV", async () => {
    browserFetchMock.mockResolvedValue(
      makeRes(true, 200, { data: [{ name: "Asha Rao", phone: "9876543210", email: "asha@example.com" }] }),
    );
    renderToolbar({ canExport: true, exportQuery: { search: "rao", status: "qualified" } });

    // Button labelled honestly as filtered because a filter is active.
    fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));
    await waitFor(() => expect(screen.getByText("Export the filtered contacts?")).toBeInTheDocument());

    // Confirm disabled until a purpose is given; nothing fetched yet.
    expect(browserFetchMock).not.toHaveBeenCalled();
    const confirmBtn = screen.getByRole("button", { name: "Export CSV" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Purpose of this export"), { target: { value: "Quarterly outreach review" } });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const url = browserFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("v1/crm/contacts/export?");
    expect(url).toContain("search=rao");
    expect(url).toContain("status=qualified");
    expect(url).toContain("purpose=Quarterly+outreach+review");
    await waitFor(() => expect(screen.getByText("Exported 1 contacts.")).toBeInTheDocument());
  });

  it("labels the control 'Export all contacts' when no filter is active", () => {
    renderToolbar({ canExport: true, exportQuery: {} });
    expect(screen.getByRole("button", { name: "Export all contacts" })).toBeInTheDocument();
  });
});
