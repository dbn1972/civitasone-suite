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
import { REAL_DUPLICATE_CHECK_RESPONSE, DUP_CONTACT_MEERA } from "@/lib/crm/testFixtures/duplicateCheckResponse";

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

  // GAP-CRM-CONTACTS-IMPORT-06: skipped rows are listed with their line number
  // AND a specific reason, not just a bare count.
  it("lists a blank-name row with its line number and the reason 'Missing name'", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("CSV data"), {
      // Two good rows then a blank-name row at data line 3.
      target: { value: `${HEADER}\nAsha Rao,,9900000000,,new,\nBimal Roy,,9800000000,,new,\n,,9700000000,,new,` },
    });
    expect(screen.getByRole("heading", { name: /Rejected rows \(1\)/ })).toBeInTheDocument();
    // The reason is shown explicitly...
    expect(screen.getByText("Missing name.")).toBeInTheDocument();
    // ...alongside the line number 3 in the rejected-rows table.
    const rejectedHeading = screen.getByRole("heading", { name: /Rejected rows/ });
    const card = rejectedHeading.closest(".card") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("3");
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
      // DPDP consent record: a consenting CSV row carries purpose=marketing, channel=import.
      { name: "Asha Rao", company: "Acme", leadStatus: "customer", marketingConsent: true, consentPurpose: "marketing", consentChannel: "import" },
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

// The duplicate list, fed the EXACT body crm-service answers POST /v1/crm/contacts/duplicate-check with
// ({ data: [{ id, name, matchedFields, score 0-100 }] }) through the real parser. Against that shape the page
// used to find no duplicates at all (it read `candidates`) and, once it did, would have printed record ids.
describe("ImportContactsPage duplicate list against the real server answer", () => {
  beforeEach(() => {
    pushMock.mockReset();
    browserFetchMock.mockReset();
  });

  function answerWith(body: unknown) {
    browserFetchMock.mockImplementation((path: string) =>
      Promise.resolve(path === "v1/crm/contacts/duplicate-check" ? makeRes(true, 200, body) : makeRes(true, 202, {})),
    );
  }
  async function importOneRow() {
    renderPage();
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: `${HEADER}\nAsha Rao,,9900000000,,new,` } });
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));
    return screen.findByRole("alert");
  }

  it("lists each possible duplicate by NAME and matched fields, and holds the import until acknowledged", async () => {
    answerWith(REAL_DUPLICATE_CHECK_RESPONSE);
    const alert = await importOneRow();
    expect(alert).toHaveTextContent("2 possible duplicates already in the registry.");
    expect(alert).toHaveTextContent("Asha Rao — matches on email, phone");
    expect(alert).toHaveTextContent("Meera Devi — matches on phone");
    expect(screen.queryByText("Import 1 contact?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import 1 contact/ })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Import anyway/));
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));
    await waitFor(() => expect(screen.getByText("Import 1 contact?")).toBeInTheDocument());
  });

  it("never shows a record id: a match without a name reads 'Existing contact'", async () => {
    answerWith({ data: [{ id: DUP_CONTACT_MEERA, matchedFields: ["phone"], score: 30 }] });
    const alert = await importOneRow();
    expect(alert).toHaveTextContent("Existing contact — matches on phone");
    expect(alert.textContent).not.toContain(DUP_CONTACT_MEERA);
  });

  it("asks the server about the row's own phone and does not hold the import when nothing matches", async () => {
    answerWith({ data: [] });
    renderPage();
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: `${HEADER}\nAsha Rao,,9900000000,,new,` } });
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));
    await waitFor(() => expect(screen.getByText("Import 1 contact?")).toBeInTheDocument());
    const call = browserFetchMock.mock.calls.find(([p]) => p === "v1/crm/contacts/duplicate-check")!;
    expect(JSON.parse((call[1] as { body: string }).body)).toMatchObject({ name: "Asha Rao", phone: "9900000000" });
  });
});

describe("ImportContactsPage feedback & caps (GAP-CRM-CONTACTS-IMPORT-04 / -05)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    browserFetchMock.mockReset();
  });

  function body(csv: string) {
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: csv } });
  }

  it("GAP-CRM-CONTACTS-IMPORT-04: shows an import summary (accepted/rejected) instead of auto-redirecting", async () => {
    browserFetchMock.mockResolvedValue(makeRes(true, 202, { id: "batch-1" }));
    renderPage();
    // One valid row + one rejected (bad email) so the summary shows both counts.
    body(`${HEADER}\nAsha Rao,,,,new,\nBad,abc,,,new,`);
    fireEvent.click(screen.getByRole("button", { name: /Import 1 contact/ }));
    await waitFor(() => expect(screen.getByText("Import 1 contact?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Import contacts" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Import summary" })).toBeInTheDocument());
    const summaryCard = screen.getByRole("heading", { name: "Import summary" }).closest(".card") as HTMLElement;
    expect(summaryCard.textContent).toMatch(/1\s*contact queued/);
    expect(summaryCard.textContent).toMatch(/1\s*row were rejected before import/);
    expect(screen.getByRole("link", { name: "View contacts" })).toBeInTheDocument();
    // No auto-redirect.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("GAP-CRM-CONTACTS-IMPORT-05: chunks a >500-row import into multiple POSTs", async () => {
    browserFetchMock.mockResolvedValue(makeRes(true, 202, { id: "batch" }));
    renderPage();
    const rows = Array.from({ length: 1200 }, (_, i) => `Person ${i},,,,new,`).join("\n");
    body(`${HEADER}\n${rows}`);
    fireEvent.click(screen.getByRole("button", { name: /Import 1,200 contacts/ }));
    await waitFor(() => expect(screen.getByText("Import 1,200 contacts?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Import contacts" }));
    // 1200 rows / 500 per batch = 3 POSTs to the bulk endpoint.
    await waitFor(() => {
      const posts = browserFetchMock.mock.calls.filter((c) => c[0] === "v1/crm/contacts/bulk/import");
      expect(posts).toHaveLength(3);
    });
    // The single-string status banner carries the batch count.
    await waitFor(() => expect(screen.getByText(/1,200 contacts queued in 3 batches/)).toBeInTheDocument());
  });

  it("GAP-CRM-CONTACTS-IMPORT-05: labels the preview 'first 50 of N'", () => {
    renderPage();
    const rows = Array.from({ length: 120 }, (_, i) => `Person ${i},,,,new,`).join("\n");
    body(`${HEADER}\n${rows}`);
    expect(screen.getByRole("heading", { name: /showing first 50 of 120/ })).toBeInTheDocument();
  });

  it("GAP-CRM-CONTACTS-IMPORT-05: refuses an import above the row cap", () => {
    renderPage();
    const rows = Array.from({ length: 5001 }, (_, i) => `Person ${i},,,,new,`).join("\n");
    body(`${HEADER}\n${rows}`);
    expect(screen.getByRole("button", { name: /Import 5,001 contacts/ })).toBeDisabled();
    expect(screen.getByText(/Too many rows \(5001\)/)).toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-CONTACTS-IMPORT-04 (backend): the page polls the job-status endpoint
  // and shows the TRUE server-side outcome (created vs skipped) + a server
  // "Download rejected rows (CSV)" built from the server result.
  it("GAP-CRM-CONTACTS-IMPORT-04: polls the batch status endpoint and shows the server result", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/contacts/bulk/import") {
        return Promise.resolve(makeRes(true, 202, { id: "batch-xyz" }));
      }
      if (path === "v1/crm/contacts/import/batch-xyz") {
        return Promise.resolve(
          makeRes(true, 200, {
            batchId: "batch-xyz",
            status: "completed",
            total: 2,
            accepted: 1,
            rejected: 1,
            errored: 0,
            rejectedRows: [{ index: 1, reason: "duplicate_email" }],
          }),
        );
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    renderPage();
    body(`${HEADER}\nAsha Rao,asha@example.com,,,new,\nAsha Dup,asha@example.com,,,new,`);
    fireEvent.click(screen.getByRole("button", { name: /Import 2 contacts/ }));
    await waitFor(() => expect(screen.getByText("Import 2 contacts?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Import contacts" }));

    // The server-polled outcome shows created + skipped counts.
    await waitFor(() =>
      expect(browserFetchMock).toHaveBeenCalledWith("v1/crm/contacts/import/batch-xyz"),
    );
    await waitFor(() =>
      expect(
        screen.getByText((_c, el) => el?.textContent === "Server result: 1 created, 1 skipped (duplicates or errors)."),
      ).toBeInTheDocument(),
    );
    // A server-rejected CSV download is offered.
    expect(screen.getByRole("button", { name: /Download rejected rows \(CSV\)/ })).toBeInTheDocument();
  });
});
