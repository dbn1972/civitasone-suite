import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import NewContactPage from "./page";
import * as dq from "@/lib/crm/dataQuality";
import type { DuplicateCandidate } from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, duplicateCheck: vi.fn() };
});

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const fetchMock = vi.fn();
const cand: DuplicateCandidate = { id: "1", matchedFields: ["email"], score: 0.9, name: "Existing Asha" };

beforeEach(() => {
  vi.mocked(dq.duplicateCheck).mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("NewContactPage lead status + placeholders (GAP-CRM-CONTACTS-NEW-05 / -06)", () => {
  it("offers 'Disqualified' as a selectable lead status using the canonical label", () => {
    renderWithIntl(<NewContactPage />);
    const select = screen.getByLabelText("Lead status") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent }));
    expect(options).toContainEqual({ value: "disqualified", label: "Disqualified" });
    // Canonical shared labels (not "Engaged/Inactive Stakeholder").
    expect(options).toContainEqual({ value: "qualified", label: "Qualified" });
    expect(options).toContainEqual({ value: "unqualified", label: "Unqualified" });
    expect(select.textContent).not.toMatch(/Stakeholder/);
  });

  it("uses neutral/Odisha placeholders, not Karnataka-specific examples", () => {
    renderWithIntl(<NewContactPage />);
    expect(screen.getByPlaceholderText("Bhubaneswar")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("751001")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("21ABCDE1234F1Z5")).toBeInTheDocument();
    // No Karnataka (29/560001/Bengaluru) examples remain.
    expect(screen.queryByPlaceholderText("Bengaluru")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("560001")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("29ABCDE1234F1Z5")).not.toBeInTheDocument();
  });
});

describe("NewContactPage duplicate-check (DQ-001 findings 1,2,5)", () => {
  it("resets the 'continue anyway' acknowledgement when a dedup field is edited afterwards", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([cand]);

    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "asha@x.in" } });

    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    expect(await screen.findByText(/potential duplicates found/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/crm/contacts", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: /continue anyway/i }));
    expect(await screen.findByRole("button", { name: /create anyway/i })).toBeInTheDocument();

    fireEvent.change(email, { target: { value: "asha2@x.in" } });
    expect(screen.getByRole("button", { name: /^create contact$/i })).toBeInTheDocument();
    expect(screen.queryByText(/potential duplicates found/i)).not.toBeInTheDocument();

    vi.mocked(dq.duplicateCheck).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^create contact$/i }));
    await waitFor(() => expect(dq.duplicateCheck).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/potential duplicates found/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/crm/contacts", expect.anything());
  });

  it("ignores a stale in-flight check so a newer blur wins (finding 2)", async () => {
    let resolveSlow!: (v: DuplicateCandidate[]) => void;
    const slow = new Promise<DuplicateCandidate[]>((r) => { resolveSlow = r; });
    vi.mocked(dq.duplicateCheck)
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce([]);

    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "asha@x.in" } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "9900000000" } });

    fireEvent.blur(screen.getByLabelText("Email"));
    fireEvent.blur(screen.getByLabelText(/phone/i));

    await waitFor(() => expect(screen.queryByText(/potential duplicates found/i)).not.toBeInTheDocument());

    await act(async () => { resolveSlow([cand]); await slow; });
    expect(screen.queryByText(/potential duplicates found/i)).not.toBeInTheDocument();
  });

  it("surfaces a source=error affordance (not silent) when the check call fails, without blocking submit", async () => {
    vi.mocked(dq.duplicateCheck).mockRejectedValue(new Error("network"));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "new-1" }) });

    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "asha@x.in" } });
    fireEvent.blur(screen.getByLabelText("Email"));
    expect(await screen.findByText(/duplicate check unavailable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/crm/contacts", expect.anything()));
  });
});

describe("NewContactPage error + duplicate-submit (GAP-CRM-CONTACTS-NEW-01 / -04)", () => {
  /** Answer the lead-field-rules read with no rules and the contact POST with `post`. */
  function answerPost(post: unknown) {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("lead-field-rules")
          ? { ok: true, status: 200, json: async () => ({ data: [] }) }
          : post,
      ),
    );
  }

  it("GAP-CRM-CONTACTS-NEW-01: a 422 names the missing field (by this screen's own label) without echoing raw server text", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    answerPost({
      ok: false,
      status: 422,
      json: async () => ({ code: "MANDATORY_FIELDS_MISSING", message: "missing mandatory field(s): city" }),
    });
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));

    const banner = await screen.findByText(/Please fill in the required field\(s\)/);
    // The banner mentions City, from OUR copy, not the server's sentence.
    expect(banner.textContent).toContain("City");
    expect(banner.textContent).not.toMatch(/missing mandatory field/i);
    expect(banner.textContent).not.toMatch(/Could not create the contact/);
  });

  it("GAP-CRM-CONTACTS-NEW-01: the named field is flagged on its input (aria-invalid + linked message) until it is filled", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    answerPost({
      ok: false,
      status: 422,
      json: async () => ({ code: "MANDATORY_FIELDS_MISSING", message: "missing mandatory field(s): city, designation" }),
    });
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));

    const city = await screen.findByLabelText("City");
    await waitFor(() => expect(city).toHaveAttribute("aria-invalid", "true"));
    const note = document.getElementById(city.getAttribute("aria-describedby")!)!;
    expect(note).toHaveTextContent("City is required.");
    expect(screen.getByLabelText("Designation")).toHaveAttribute("aria-invalid", "true");
    // A field the server did not name stays clean.
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");

    // Typing a value clears that field's flag; the other stays flagged.
    fireEvent.change(city, { target: { value: "Cuttack" } });
    expect(city).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("City is required.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Designation")).toHaveAttribute("aria-invalid", "true");
  });

  it("GAP-CRM-CONTACTS-NEW-01: a 422 that names no known field falls back to the safe generic copy, never the server text", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    answerPost({
      ok: false,
      status: 422,
      json: async () => ({ code: "MANDATORY_FIELDS_MISSING", message: "missing mandatory field(s): <b>secret_internal</b>" }),
    });
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/weren.t accepted/i);
    expect(alert.textContent).not.toMatch(/secret_internal|mandatory/i);
  });

  it("GAP-CRM-CONTACTS-NEW-01: a network failure still shows the generic offline message", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("lead-field-rules")
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) })
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/connection|offline|internet|network/i);
    expect(alert.textContent).not.toMatch(/Failed to fetch/);
  });

  it("DQ-003: the real crm-service 400 (VALIDATION_FAILED + fieldErrors) lands INVALID_MOBILE under Phone", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    answerPost({
      ok: false,
      status: 400,
      json: async () => ({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        retryable: false,
        fieldErrors: [{ field: "phone", message: "INVALID_MOBILE" }],
      }),
    });
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));

    const phone = screen.getByLabelText(/phone/i);
    await waitFor(() => expect(phone).toHaveAttribute("aria-invalid", "true"));
    const described = phone.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described.join(" ")).toMatch(/valid 10-digit Indian mobile/i);
  });

  it("GAP-CRM-CONTACTS-NEW-04: a 201 with no id navigates to the list and disables a second submit", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    const pushSpy = vi.fn();
    // Replace the router push used by the component via a module mock.
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/crm/contacts", expect.anything()));
    // The submit button latches to "Created" and is disabled — no duplicate POST.
    await waitFor(() => expect(screen.getByRole("button", { name: /created/i })).toBeDisabled());
    const postCalls = () => fetchMock.mock.calls.filter((c) => c[0] === "/api/proxy/v1/crm/contacts").length;
    expect(postCalls()).toBe(1);
    void pushSpy;
  });
});

describe("NewContactPage DPDP + account link (GAP-CRM-CONTACTS-NEW-03 / -02)", () => {
  it("GAP-CRM-CONTACTS-NEW-03: consent is DPDP-only wording with a PAN/GSTIN notice", () => {
    renderWithIntl(<NewContactPage />);
    expect(screen.getByText(/DPDP Act, 2023/)).toBeInTheDocument();
    expect(screen.queryByText(/GDPR/)).not.toBeInTheDocument();
    expect(screen.getByText(/Personal data collected for KYC\/tax/i)).toBeInTheDocument();
  });

  it("GAP-CRM-CONTACTS-NEW-03: the PAN and GSTIN notices are tied to their inputs via aria-describedby", () => {
    renderWithIntl(<NewContactPage />);
    const pan = screen.getByLabelText("PAN");
    const gstin = screen.getByLabelText("GSTIN");
    const noteFor = (el: HTMLElement) =>
      el.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(noteFor(pan)).toMatch(/KYC\/tax.*role-scoped and logged/i);
    expect(noteFor(gstin)).toMatch(/invoicing and tax.*role-scoped and logged/i);
  });

  it("GAP-CRM-CONTACTS-NEW-02: offers an account picker plus a free-text organisation fallback", () => {
    renderWithIntl(<NewContactPage />);
    expect(screen.getByLabelText("Link to an existing account")).toBeInTheDocument();
    // With no account linked, the free-text organisation input is the fallback.
    expect(screen.getByPlaceholderText("Or type a new organisation")).toBeInTheDocument();
  });

  // GAP-CRM-CONTACTS-NEW-02 acceptance: "selecting an account and saving makes account detail Linked
  // Contacts increment" -- the create body must carry the picked account's id (crm-service counts and
  // lists a contact by contacts.account_id), with the account's name as the contact's company.
  it("GAP-CRM-CONTACTS-NEW-02: a picked account is sent as accountId (with its name as company), replacing the free-text organisation", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/v1/crm/accounts")
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [{ id: "acc-77", name: "Odisha Housing Board" }] }) })
        : Promise.resolve({ ok: true, status: 202, json: async () => ({ id: "c-9" }) }),
    );
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/^full name/i), { target: { value: "Asha Rao" } });
    const picker = screen.getByLabelText("Link to an existing account");
    fireEvent.change(picker, { target: { value: "Odisha" } });
    fireEvent.mouseDown(await screen.findByText("Odisha Housing Board"));
    // Linked: the free-text organisation fallback is gone and the "Linked to" line names the account.
    await waitFor(() => expect(screen.queryByPlaceholderText("Or type a new organisation")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Odisha Housing Board", { selector: "strong" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/proxy/v1/crm/contacts")).toBe(true));
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/proxy/v1/crm/contacts")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      name: "Asha Rao", accountId: "acc-77", company: "Odisha Housing Board",
    });
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-07: the create form uses the same consent
  // record control as the edit form, so a grant can't reach crm-service (which
  // now requires purpose + channel) without them.
  it("blocks a consent grant without purpose/channel, then sends both", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({ id: "c-1" }) });
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/^full name/i), { target: { value: "Asha Rao" } });
    fireEvent.click(screen.getByLabelText(/I consent to marketing communications/i));
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    expect(await screen.findByText(/choose the purpose and how consent was captured/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/proxy/v1/crm/contacts")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^purpose/i), { target: { value: "marketing" } });
    fireEvent.change(screen.getByLabelText(/^captured via/i), { target: { value: "in_person" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/proxy/v1/crm/contacts")).toBe(true));
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/proxy/v1/crm/contacts")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      marketingConsent: true, consentPurpose: "marketing", consentChannel: "in_person",
    });
  });
});
