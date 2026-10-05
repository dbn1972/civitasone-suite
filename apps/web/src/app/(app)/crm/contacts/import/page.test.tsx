import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import ImportContactsPage from "./page";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const HEADER = "name,email,phone,company,leadStatus,marketingConsent";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ImportContactsPage />
    </NextIntlClientProvider>,
  );
}

describe("ImportContactsPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    browserFetchMock.mockReset();
  });

  // GAP-CRM-CONTACTS-IMPORT-02
  it("opens with an empty textarea and a disabled Import button (no pre-filled junk row)", () => {
    renderPage();
    const textarea = screen.getByLabelText("CSV data") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(screen.getByRole("button", { name: /Import 0 contacts/ })).toBeDisabled();
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-CONTACTS-IMPORT-01: invalid rows are rejected, not posted.
  it("rejects an invalid-email and bad lead-status row and keeps them out of the preview", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("CSV data"), {
      target: { value: `${HEADER}\nGood One,,9900000000,,new,\nBad Email,abc,,,new,\nBad Status,,,,foo,` },
    });
    // Only the one valid row is importable.
    expect(screen.getByRole("button", { name: /Import 1 contact/ })).toBeEnabled();
    expect(screen.getByRole("heading", { name: /Rejected rows \(2\)/ })).toBeInTheDocument();
    expect(screen.getByText(/Invalid email/)).toBeInTheDocument();
    expect(screen.getByText(/Invalid lead status/)).toBeInTheDocument();
  });

  // GAP-CRM-CONTACTS-IMPORT-02: a ConfirmDialog gates the POST.
  it("requires confirmation before importing and only then posts validated rows with consent", async () => {
    // No email/phone → no duplicate-check round trip needed before confirm.
    browserFetchMock.mockResolvedValue(makeRes(true, 202, {}));
    renderPage();
    fireEvent.change(screen.getByLabelText("CSV data"), {
      target: { value: `${HEADER}\nAsha Rao,,,Acme,customer,yes` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));

    // Dialog shows the count; nothing posted yet.
    await waitFor(() => expect(screen.getByText("Import 1 contact?")).toBeInTheDocument());
    expect(browserFetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Import contacts" }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalledWith("v1/crm/contacts/bulk/import", expect.anything()));

    const [, options] = browserFetchMock.mock.calls[0];
    const sent = JSON.parse((options as { body: string }).body) as { contacts: Array<Record<string, unknown>> };
    expect(sent.contacts).toEqual([
      { name: "Asha Rao", company: "Acme", leadStatus: "customer", marketingConsent: true },
    ]);
  });

  it("cancelling the confirm dialog sends no request", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("CSV data"), {
      target: { value: `${HEADER}\nAsha Rao,,,,new,` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));
    await waitFor(() => expect(screen.getByText("Import 1 contact?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Import 1 contact?")).not.toBeInTheDocument());
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  it("blocks import on possible duplicates until acknowledged", async () => {
    // The pre-import duplicate check finds a match for the row's phone.
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/contacts/duplicate-check") {
        return Promise.resolve(makeRes(true, 200, { candidates: [{ id: "c9", name: "Existing", matchedFields: ["phone"], score: 0.9 }] }));
      }
      return Promise.resolve(makeRes(true, 202, {}));
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("CSV data"), {
      target: { value: `${HEADER}\nAsha Rao,,9900000000,,new,` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));

    // Duplicate warning appears; no confirm dialog, no bulk import yet.
    await screen.findByText((_c, el) => el?.textContent === "1 possible duplicate already in the registry.");
    expect(screen.queryByText("Import 1 contact?")).not.toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalledWith("v1/crm/contacts/bulk/import", expect.anything());

    // Acknowledge, then import proceeds to the confirm dialog.
    fireEvent.click(screen.getByLabelText(/Import anyway/));
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));
    await waitFor(() => expect(screen.getByText("Import 1 contact?")).toBeInTheDocument());
  });
});
