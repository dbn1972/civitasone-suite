import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import NewGrievancePage from "./page";

describe("NewGrievancePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // Regression test for the CRITICAL bug: the form posted to
  // fetch("/api/v1/crm/grievances") instead of the only working
  // client-mutation prefix "/api/proxy/v1/crm/grievances" — a citizen could
  // never actually file a grievance, the request 404'd against the Next.js
  // app itself every time.
  it("submits the new grievance to the correct proxied endpoint and navigates to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: "new-grievance-1" } }), { status: 201 })),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water for 3 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/new-grievance-1"));

    // The form also loads the category master (GAP-CRM-GRIEVANCES-NEW-03) on
    // mount, so there may be a GET before the submit — assert on the POST call
    // specifically rather than a bare call count.
    const postCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeDefined();
    const [url, init] = postCall!;
    expect(url).toBe("/api/proxy/v1/crm/grievances");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.citizenName).toBe("Ravi Kumar");
    expect(body.category).toBe("Water Supply");
  });

  // UX-016: this used to surface the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error instead of the raw server text, and does not navigate away, on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid category" }), { status: 422 }),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water for 3 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(screen.queryByText("Invalid category")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-GRIEVANCES-NEW-01 — the DPDP purpose/retention notice is visible.
  it("shows the DPDP purpose notice for citizen contact data", () => {
    render(<NewGrievancePage />);
    expect(screen.getByText(/used only to respond to this grievance/i)).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-01 — an invalid phone blocks submit with an inline
  // message and never fires the request.
  it("blocks submit and shows an inline error for an invalid phone", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water" } });
    fireEvent.change(screen.getByLabelText(/^phone$/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    expect(await screen.findByText(/valid phone number/i)).toBeInTheDocument();
    // The mount-time category-master GET may fire, but no grievance POST must be made.
    const postCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeUndefined();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-GRIEVANCES-NEW-01 — an async contact search links the grievance to an
  // existing CRM contact; the chosen contactId is sent on the create, and a contact
  // that already has open grievances raises a (non-blocking) duplicate warning that
  // links to each of them.
  describe("link existing contact + duplicate-open warning (GAP-CRM-GRIEVANCES-NEW-01)", () => {
    function mockApi(openForContact: Array<{ id: string; referenceNo: string; subject: string }>) {
      return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/crm/contacts/lookup")) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [{ id: "ct-9", name: "Meera Devi", phone: "98XXXXX210" }] }), { status: 200 }),
          );
        }
        if (url.includes("/v1/crm/grievances?")) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: openForContact, meta: { total: openForContact.length } }), { status: 200 }),
          );
        }
        if (url.includes("/v1/crm/grievance-categories")) {
          return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
        }
        void init;
        return Promise.resolve(new Response(JSON.stringify({ data: { id: "g-linked" } }), { status: 201 }));
      });
    }

    async function pickContact() {
      const picker = screen.getByRole("combobox", { name: /link existing contact/i });
      fireEvent.change(picker, { target: { value: "Meera" } });
      fireEvent.mouseDown(await screen.findByText("Meera Devi"));
    }

    it("sends the chosen contactId on the create", async () => {
      const fetchSpy = mockApi([]);
      render(<NewGrievancePage />);
      await pickContact();
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
      fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water" } });
      fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/g-linked"));
      const post = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(JSON.parse((post![1] as RequestInit).body as string).contactId).toBe("ct-9");
      expect(screen.queryByRole("status", { name: /possible duplicate/i })).not.toBeInTheDocument();
    });

    it("omits contactId when no contact is linked", async () => {
      const fetchSpy = mockApi([]);
      render(<NewGrievancePage />);
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi" } });
      fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water" } });
      fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));
      await waitFor(() => expect(pushMock).toHaveBeenCalled());
      const post = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(JSON.parse((post![1] as RequestInit).body as string)).not.toHaveProperty("contactId");
    });

    it("warns, with links, when the linked contact already has open grievances", async () => {
      const fetchSpy = mockApi([
        { id: "g-old-1", referenceNo: "DARPG/2026/000001", subject: "No water for 3 days" },
        { id: "g-old-2", referenceNo: "DARPG/2026/000002", subject: "Broken pipe" },
      ]);
      render(<NewGrievancePage />);
      await pickContact();

      const warning = await screen.findByRole("status", { name: /possible duplicate/i });
      expect(warning).toHaveTextContent(/This contact already has 2 open grievances/i);
      expect(screen.getByRole("link", { name: "DARPG/2026/000001" })).toHaveAttribute("href", "/crm/grievances/g-old-1");
      expect(screen.getByRole("link", { name: "DARPG/2026/000002" })).toHaveAttribute("href", "/crm/grievances/g-old-2");
      const lookup = fetchSpy.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/v1/crm/grievances?"));
      expect(lookup).toBe("/api/proxy/v1/crm/grievances?contactId=ct-9&open=true&limit=5");
    });

    it("is advisory: the grievance can still be filed while the warning is showing", async () => {
      mockApi([{ id: "g-old-1", referenceNo: "DARPG/2026/000001", subject: "No water" }]);
      render(<NewGrievancePage />);
      await pickContact();
      await screen.findByRole("status", { name: /possible duplicate/i });
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
      fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Different issue" } });
      fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/g-linked"));
    });
  });

  // GAP-CRM-GRIEVANCES-NEW-01 - a TYPED phone / email that already belongs to a CRM contact. The picker above is
  // a name search (phone and email are encrypted at rest), so before this a clerk who typed a repeat citizen's
  // number got no warning unless they picked the contact by hand. The check runs through the existing contact
  // duplicate-check (ids, matched field names and a score back - never the number), debounced, advisory, and
  // announced through ONE always-mounted live region.
  describe("typed phone / email already belongs to an existing contact (GAP-CRM-GRIEVANCES-NEW-01)", () => {
    // The shape crm-service REALLY answers with: { data: [{ id, name, matchedFields, score 0-100 }] } (see
    // testFixtures/duplicateCheckResponse.ts). A name is optional; the score is a whole percent.
    type Match = { id: string; name?: string; matchedFields: string[]; score: number };
    type Handlers = {
      duplicates?: Match[] | "fail" | "forbidden";
      open?: Array<{ id: string; referenceNo: string; subject: string }>;
      /** Take over the duplicate-check answer (1-based call number, request body) - for deferred / per-value replies. */
      onCheck?: (call: number, body: Record<string, unknown>) => Response | Promise<Response>;
    };

    function mockApi(h: Handlers = {}) {
      const duplicates = h.duplicates ?? [{ id: "ct-9", name: "Meera Devi", matchedFields: ["phone"], score: 30 }];
      let checkCalls = 0;
      return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/crm/contacts/duplicate-check")) {
          checkCalls += 1;
          if (h.onCheck) return Promise.resolve(h.onCheck(checkCalls, JSON.parse((init?.body as string) ?? "{}")));
          return Promise.resolve(
            duplicates === "fail"
              ? new Response(JSON.stringify({ code: "INTERNAL" }), { status: 500 })
              : duplicates === "forbidden"
                ? new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: crm_user, crm_admin, super_admin" }), { status: 403 })
                : new Response(JSON.stringify({ data: duplicates }), { status: 200 }),
          );
        }
        if (url.includes("/v1/crm/contacts/lookup")) {
          return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "ct-9", name: "Meera Devi" }] }), { status: 200 }));
        }
        if (url.includes("/v1/crm/grievances?")) {
          const open = h.open ?? [];
          return Promise.resolve(new Response(JSON.stringify({ data: open, meta: { total: open.length } }), { status: 200 }));
        }
        if (url.includes("/v1/crm/grievance-categories")) {
          return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: { id: "g-new" } }), { status: 201 }));
      });
    }

    const region = () => screen.getByRole("status", { name: "Existing contact check" });
    const checks = (spy: ReturnType<typeof mockApi>) =>
      spy.mock.calls.filter(([u]) => String(u).endsWith("/v1/crm/contacts/duplicate-check"));
    const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const settle = () => new Promise((r) => setTimeout(r, 750));

    it("keeps ONE live region mounted from the start, empty until there is something to say", () => {
      mockApi();
      render(<NewGrievancePage />);
      expect(region()).toHaveAttribute("aria-live", "polite");
      expect(region()).toBeEmptyDOMElement();
    });

    it("warns, with a link to the contact, when a typed phone already belongs to one", async () => {
      const spy = mockApi();
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("An existing contact already has this phone number."), { timeout: 4000 });
      expect(within(region()).getByRole("link", { name: "Meera Devi" })).toHaveAttribute("href", "/crm/contacts/ct-9");
      // Only the typed phone travels - not the name, not an email nobody typed.
      expect(checks(spy)).toHaveLength(1);
      expect(bodyOf(checks(spy)[0]!)).toEqual({ phone: "9876543210" });
      // The number itself is never repeated back.
      expect(region().textContent).not.toContain("9876543210");
      expect(screen.getAllByRole("status", { name: "Existing contact check" })).toHaveLength(1);
    });

    it("warns for a typed email too, and says so in words", async () => {
      const spy = mockApi({ duplicates: [{ id: "ct-9", matchedFields: ["email"], score: 40 }] });
      render(<NewGrievancePage />);
      type(/^email/i, "meera@example.gov.in");
      await waitFor(() => expect(region()).toHaveTextContent("An existing contact already has this email address."), { timeout: 4000 });
      expect(bodyOf(checks(spy)[0]!)).toEqual({ email: "meera@example.gov.in" });
      expect(region().textContent).not.toContain("meera@example.gov.in");
    });

    it("sends both values in one check and names the right fields for several matches", async () => {
      const spy = mockApi({
        duplicates: [
          { id: "ct-9", matchedFields: ["phone"], score: 30 },
          { id: "ct-10", matchedFields: ["email"], score: 40 },
        ],
      });
      render(<NewGrievancePage />);
      type(/^phone/i, "+91-9876543210");
      type(/^email/i, "meera@example.gov.in");
      await waitFor(() => expect(region()).toHaveTextContent("2 existing contacts already have this phone number or email address."), { timeout: 4000 });
      expect(checks(spy)).toHaveLength(1);
      expect(bodyOf(checks(spy)[0]!)).toEqual({ phone: "+91-9876543210", email: "meera@example.gov.in" });
      expect(within(region()).getAllByRole("link")).toHaveLength(2);
    });

    it("debounces: rapid typing makes one check, with the final value", async () => {
      const spy = mockApi();
      render(<NewGrievancePage />);
      for (const v of ["9", "98", "9876", "987654", "9876543", "98765432", "987654321", "9876543210"]) type(/^phone/i, v);
      await waitFor(() => expect(region()).toHaveTextContent("already has this phone number"), { timeout: 4000 });
      expect(checks(spy)).toHaveLength(1);
      expect(bodyOf(checks(spy)[0]!)).toEqual({ phone: "9876543210" });
    });

    it("does not look up a half-typed phone or an invalid email", async () => {
      const spy = mockApi();
      render(<NewGrievancePage />);
      type(/^phone/i, "98765");
      type(/^email/i, "meera@");
      await settle();
      expect(checks(spy)).toHaveLength(0);
      expect(region()).toBeEmptyDOMElement();
    });

    it("says nothing when no contact matches", async () => {
      const spy = mockApi({ duplicates: [] });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(checks(spy)).toHaveLength(1), { timeout: 4000 });
      await settle();
      expect(region()).toBeEmptyDOMElement();
    });

    it("clears the warning when the typed value is no longer a complete number", async () => {
      mockApi();
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("already has this phone number"), { timeout: 4000 });
      type(/^phone/i, "98765");
      await waitFor(() => expect(region()).toBeEmptyDOMElement());
    });

    it("lists the matched contact's open grievances with links (a probable duplicate)", async () => {
      mockApi({ open: [{ id: "g-old-1", referenceNo: "DARPG/2026/000001", subject: "No water" }, { id: "g-old-2", referenceNo: "DARPG/2026/000002", subject: "Pipe" }] });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("2 open grievances:"), { timeout: 4000 });
      expect(within(region()).getByRole("link", { name: "DARPG/2026/000001" })).toHaveAttribute("href", "/crm/grievances/g-old-1");
      expect(within(region()).getByRole("link", { name: "DARPG/2026/000002" })).toHaveAttribute("href", "/crm/grievances/g-old-2");
    });

    it("a match without a name reads 'Existing contact' and never shows the id", async () => {
      mockApi({ duplicates: [{ id: "6f1c7d3e-0000-4000-8000-0000000000aa", matchedFields: ["phone"], score: 30 }] });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(within(region()).getByRole("link", { name: "Existing contact" })).toHaveAttribute("href", "/crm/contacts/6f1c7d3e-0000-4000-8000-0000000000aa"), { timeout: 4000 });
      expect(region().textContent).not.toContain("6f1c7d3e");
    });

    it("takes the name from the duplicate-check answer: it never reads the contact record itself (data minimisation)", async () => {
      const spy = mockApi();
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(within(region()).getByRole("link", { name: "Meera Devi" })).toBeInTheDocument(), { timeout: 4000 });
      const urls = spy.mock.calls.map(([u]) => String(u));
      expect(urls.filter((u) => /\/v1\/crm\/contacts\/ct-9(\?|$)/.test(u))).toEqual([]);
    });

    it("stops warning about a contact once the clerk has linked that contact", async () => {
      mockApi();
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("already has this phone number"), { timeout: 4000 });
      fireEvent.change(screen.getByRole("combobox", { name: /link existing contact/i }), { target: { value: "Meera" } });
      fireEvent.mouseDown(await screen.findByText("Meera Devi", { selector: "[role=option] *, [role=option]" }));
      await waitFor(() => expect(region()).toBeEmptyDOMElement());
    });

    it("is advisory and fails soft: a failed check says so, and the grievance can still be filed", async () => {
      mockApi({ duplicates: "fail" });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("Could not check whether this phone or email already belongs to a contact."), { timeout: 4000 });
      type(/full name/i, "Meera Devi");
      type(/category/i, "Water Supply");
      type(/subject/i, "No water");
      fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/g-new"));
    });

    const ok = (data: Match[]) => new Response(JSON.stringify({ data }), { status: 200 });
    const asha: Match = { id: "ct-A", name: "First Person", matchedFields: ["phone"], score: 30 };
    const meera: Match = { id: "ct-B", name: "Second Person", matchedFields: ["phone"], score: 30 };

    // A role that may file grievances but not read contacts (tenant_admin) gets a 403 from the lookup. That is not
    // an error to announce, and it must not be asked again on every keystroke.
    it("a refused lookup (403) is silent and is not repeated for later values; filing still works", async () => {
      const spy = mockApi({ duplicates: "forbidden" });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(checks(spy)).toHaveLength(1), { timeout: 4000 });
      await settle();
      expect(region()).toBeEmptyDOMElement(); // no "Could not check..." for a role that simply may not look
      type(/^phone/i, "9123456789");
      type(/^email/i, "meera@example.gov.in");
      await settle();
      expect(checks(spy)).toHaveLength(1);
      expect(region()).toBeEmptyDOMElement();
      type(/full name/i, "Meera Devi");
      type(/category/i, "Water Supply");
      type(/subject/i, "No water");
      fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/g-new"));
    });

    it("a 500 is still announced as 'could not check' (only a 403 is silent)", async () => {
      mockApi({ duplicates: "fail" });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("Could not check"), { timeout: 4000 });
    });

    // The guard against a late answer: the reply for the FIRST number arrives after the second number was typed
    // and must not overwrite what the second number found. (Remove `if (ctrl.signal.aborted) return` in page.tsx and
    // this fails: the late reply would clear or replace the current warning.)
    it("ignores a late answer to a value that has since been replaced", async () => {
      let releaseFirst: (r: Response) => void = () => {};
      const first = new Promise<Response>((resolve) => { releaseFirst = resolve; });
      const spy = mockApi({ onCheck: (call) => (call === 1 ? first : ok([meera])) });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(checks(spy)).toHaveLength(1), { timeout: 4000 }); // the first lookup is now in flight
      type(/^phone/i, "9123456789");
      await waitFor(() => expect(region()).toHaveTextContent("Second Person"), { timeout: 4000 });
      releaseFirst(ok([asha])); // the stale reply, long after the second lookup finished
      await new Promise((r) => setTimeout(r, 150));
      expect(region()).toHaveTextContent("Second Person");
      expect(region().textContent).not.toContain("First Person");
    });

    it("clears the warning for number A as soon as the number changes, while B is still being checked", async () => {
      let releaseSecond: (r: Response) => void = () => {};
      const second = new Promise<Response>((resolve) => { releaseSecond = resolve; });
      mockApi({ onCheck: (call) => (call === 1 ? ok([asha]) : second) });
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("First Person"), { timeout: 4000 });
      type(/^phone/i, "9123456789");
      // B is typed but not yet answered: A's warning is gone at once (it was about a different number).
      expect(region()).toBeEmptyDOMElement();
      await settle(); // the second lookup is in flight and still unanswered
      expect(region()).toBeEmptyDOMElement();
      releaseSecond(ok([meera]));
      await waitFor(() => expect(region()).toHaveTextContent("Second Person"), { timeout: 4000 });
      expect(region().textContent).not.toContain("First Person");
    });

    it("looks a phone up only once it is a whole number (10+ digits), not at 7, 8 or 9 while typing", async () => {
      const spy = mockApi();
      render(<NewGrievancePage />);
      for (const partial of ["9876543", "98765432", "987654321"]) {
        type(/^phone/i, partial); // all three pass the form's own PHONE_RE (7-15 digit international form)
        await settle();
        expect(checks(spy)).toHaveLength(0);
      }
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(checks(spy)).toHaveLength(1), { timeout: 4000 });
      expect(bodyOf(checks(spy)[0]!)).toEqual({ phone: "9876543210" });
    });

    it("waits 500 ms after the last keystroke (and not before) to look anything up", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const spy = mockApi();
        render(<NewGrievancePage />);
        type(/^phone/i, "9876543210");
        await vi.advanceTimersByTimeAsync(499);
        expect(checks(spy)).toHaveLength(0);
        // another keystroke restarts the wait
        type(/^phone/i, "98765432101");
        await vi.advanceTimersByTimeAsync(499);
        expect(checks(spy)).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(checks(spy)).toHaveLength(1);
        expect(bodyOf(checks(spy)[0]!)).toEqual({ phone: "98765432101" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("is advisory when it DOES match: the grievance can still be filed with the warning showing", async () => {
      mockApi();
      render(<NewGrievancePage />);
      type(/^phone/i, "9876543210");
      await waitFor(() => expect(region()).toHaveTextContent("already has this phone number"), { timeout: 4000 });
      type(/full name/i, "Meera Devi");
      type(/category/i, "Water Supply");
      type(/subject/i, "No water");
      fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/g-new"));
    });
  });

  // GAP-CRM-GRIEVANCES-NEW-02 — a server rejection for citizenEmail renders
  // beside the Email field, not just the top banner.
  it("renders a server field error for citizenEmail beside the Email field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "VALIDATION_FAILED", message: "validation", fieldErrors: [{ field: "citizenEmail", message: "Email already used" }] }),
        { status: 422 },
      ),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    expect(await screen.findByText("Email already used")).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-03: the select is fed by the per-tenant category
  // master. A configured active category appears as an option.
  it("offers the tenant's configured categories from the master", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/crm/grievance-categories")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "c1", code: "noise", label: "Noise Pollution", active: true, sortOrder: 0 }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }));
    });

    render(<NewGrievancePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Noise Pollution" })).toBeInTheDocument());
    expect(screen.queryByText(/standard category list/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-03: a failed master load falls back to the standard
  // CPGRAMS-aligned list with an inline notice — never an empty select.
  it("falls back to the standard category list with a notice when the master fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/crm/grievance-categories")) {
        return Promise.resolve(new Response("{}", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }));
    });

    render(<NewGrievancePage />);
    expect(await screen.findByText(/standard category list/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Water Supply" })).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-07 — a "Fields marked * are required" legend is
  // shown and the description field has a live character counter.
  it("shows the required-fields legend and a description character counter", () => {
    render(<NewGrievancePage />);
    expect(screen.getByText(/Fields marked/i)).toBeInTheDocument();
    expect(screen.getByText("0/5,000")).toBeInTheDocument();
  });

  it("updates the description counter as the clerk types", () => {
    render(<NewGrievancePage />);
    fireEvent.input(screen.getByLabelText(/description/i), { target: { value: "No water for days" } });
    expect(screen.getByText("17/5,000")).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-04 — a hint explains when Urgent applies.
  it("shows guidance on when to use the Urgent priority", () => {
    render(<NewGrievancePage />);
    expect(screen.getByText(/only for risk to life or safety/i)).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-05 — the POST carries the device id (browserFetch),
  // and the Cancel control is a client-side link, not a full-reload anchor.
  it("sends the device header on submit and renders Cancel as a client link", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: "g-1" } }), { status: 201 })),
    );

    render(<NewGrievancePage />);
    const cancel = screen.getByRole("link", { name: /cancel/i });
    expect(cancel).toHaveAttribute("href", "/crm/grievances");

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water for 3 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/g-1"));
    const postCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeDefined();
    const [url, init] = postCall!;
    expect(url).toBe("/api/proxy/v1/crm/grievances");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-device-id"]).toBeTruthy();
  });

  describe("SF-19 discard ConfirmDialog (replaces native confirm)", () => {
    function cancelLink() {
      return screen.getByRole("link", { name: /^cancel$/i });
    }

    it("opens the dialog without navigating when a dirty form is cancelled, and never calls window.confirm", () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      render(<NewGrievancePage />);
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "typed something" } });
      const notPrevented = fireEvent.click(cancelLink());
      expect(notPrevented).toBe(false);
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("Escape closes the dialog and keeps the form without navigating", () => {
      render(<NewGrievancePage />);
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/subject/i)).toHaveValue("typed something");
    });

    it("Keep editing closes the dialog and keeps the form without navigating", () => {
      render(<NewGrievancePage />);
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      fireEvent.click(screen.getByRole("button", { name: /^keep editing$/i }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/subject/i)).toHaveValue("typed something");
    });

    it("Discard navigates to the list", () => {
      render(<NewGrievancePage />);
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
      expect(pushMock).toHaveBeenCalledWith("/crm/grievances");
    });

    it("a clean form does not open the dialog on Cancel", () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      render(<NewGrievancePage />);
      const notPrevented = fireEvent.click(cancelLink());
      expect(notPrevented).toBe(true);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
