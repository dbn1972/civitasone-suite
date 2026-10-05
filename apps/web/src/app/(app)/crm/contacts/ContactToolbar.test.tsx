import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
let currentParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => currentParams,
}));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import { ContactToolbar } from "./ContactToolbar";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body, text: async () => String(body) } as unknown as Response;
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
    pushMock.mockReset();
    currentParams = new URLSearchParams();
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
      makeRes(true, 200, "Name,Email,Phone\r\n\"Asha Rao\",\"a***@example.com\",\"******3210\""),
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
    // The server returns CSV directly; the client streams it, and the success
    // copy now states the export was recorded (server-audited).
    await waitFor(() =>
      expect(screen.getByText(/recorded in the audit trail/i)).toBeInTheDocument(),
    );
  });

  it("labels the control 'Export all contacts' when no filter is active", () => {
    renderToolbar({ canExport: true, exportQuery: {} });
    expect(screen.getByRole("button", { name: "Export all contacts" })).toBeInTheDocument();
  });
});

describe("ContactToolbar filter state (GAP-CRM-CONTACTS-04)", () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
    pushMock.mockReset();
    currentParams = new URLSearchParams();
  });

  it("seeds the search box from the URL (not blank after a search)", () => {
    renderToolbar({ initialSearch: "sharma" });
    expect(screen.getByLabelText(/Search contacts/i)).toHaveValue("sharma");
  });

  it("preserves the classification filters already on the URL when applying a search", () => {
    currentParams = new URLSearchParams("priority=high&temperature=hot");
    renderToolbar({ initialSearch: "" });
    fireEvent.change(screen.getByLabelText(/Search contacts/i), { target: { value: "sharma" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("search=sharma");
    expect(url).toContain("priority=high");
    expect(url).toContain("temperature=hot");
  });

  it("Clear filters resets everything to the unfiltered list", () => {
    currentParams = new URLSearchParams("priority=high");
    renderToolbar({ initialSearch: "sharma", exportQuery: { search: "sharma", priority: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(pushMock).toHaveBeenCalledWith("/crm/contacts");
  });
});

describe("ContactToolbar view selector label (GAP-CRM-CONTACTS-07)", () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
    pushMock.mockReset();
    currentParams = new URLSearchParams();
  });

  it("labels the view-mode select 'View' (not 'segment') and keeps the backend key", () => {
    renderToolbar({ initialSearch: "" });
    // Visible label reads "View".
    expect(screen.getByText("View")).toBeInTheDocument();
    // Accessible name is view-oriented, not "segment".
    const select = screen.getByLabelText("Filter contacts by view");
    expect(select).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter contacts by segment")).not.toBeInTheDocument();
  });

  it("still maps the view selection to the backend `segment` key on the URL", () => {
    renderToolbar({ initialSearch: "" });
    fireEvent.change(screen.getByLabelText("Filter contacts by view"), { target: { value: "mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("segment=mine");
  });
});
