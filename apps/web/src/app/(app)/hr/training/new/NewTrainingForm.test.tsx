import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { NewTrainingForm } from "./NewTrainingForm";

function renderForm(locale: "en" | "hi" = "en", extra?: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      {extra}
      <NewTrainingForm />
    </NextIntlClientProvider>,
  );
}

describe("NewTrainingForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The fixtures use hard-coded 2026-10-0x dates; the form warns about a
    // From Date in the past relative to "today", so pin only Date (timers stay
    // real so waitFor/findBy keep polling) to keep them in the future forever.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T05:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fillRequiredFields() {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Advanced Excel Training" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText(/max participants/i), { target: { value: "30" } });
  }

  function fillAndSubmit() {
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
  }

  describe("UX-016 clerk-safe errors", () => {
    it("shows a clerk-safe message, never the raw server text, when creation fails", async () => {
      fetchMock.mockResolvedValue(new Response("hrms-service training-create trace at line 40", { status: 500 }));
      fillAndSubmit();

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
      expect(alert.textContent).not.toMatch(/hrms-service/);
      expect(alert.textContent).not.toMatch(/\b500\b/);
    });
  });

  describe("GAP-HR-TRAINING-NEW-01 — honest async-create messaging", () => {
    it("never claims the program was 'created successfully' for a 202-accepted response, and disables the button after success", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t-1", status: "accepted" }), { status: 202 }));
      fillAndSubmit();

      const status = await screen.findByRole("status");
      expect(status.textContent).toMatch(/submitted/i);
      expect(status.textContent).not.toMatch(/created successfully/i);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /create training program/i })).toBeDisabled(),
      );
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  describe("GAP-HR-TRAINING-NEW-03 — validation", () => {
    it("rejects a non-integer Max Participants without making a network call", async () => {
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/max participants/i), { target: { value: "2.5" } });
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));

      await waitFor(() => expect(screen.getByText(/please fix the highlighted fields/i)).toBeInTheDocument());
      // GAP-HR-TRAINING-NEW-03: a human message, never the bare zod token.
      expect(screen.getByText("Enter a whole number, 1 or more.")).toBeInTheDocument();
      expect(screen.queryByText("invalidInt")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a To Date before the From Date without making a network call", async () => {
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-01" } });
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));

      await waitFor(() => expect(screen.getByText(/to date must be on or after from date/i)).toBeInTheDocument());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("warns (but does not block) a From Date in the past", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2020-01-01" } });
      expect(screen.getByText(/this start date is in the past/i)).toBeInTheDocument();
    });
  });

  describe("GAP-HR-TRAINING-NEW-01 — confirmation poll replaces the fixed redirect", () => {
    const PROGRAM_ID = "11111111-2222-4333-8444-555555555555";

    /** POST -> 202 {id}; each GET of the programmes list answers the next entry of `lists`. */
    function routeFetch(lists: unknown[]) {
      let gets = 0;
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ id: PROGRAM_ID, status: "accepted" }), { status: 202 });
        }
        gets += 1;
        return new Response(JSON.stringify(lists[Math.min(gets - 1, lists.length - 1)]), { status: 200 });
      });
      return () => gets;
    }
    const getCalls = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== "POST");

    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-15T05:00:00Z"));
    });

    async function submit() {
      fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    async function elapse(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    it("moves to the list once the programmes list contains the new id (found on the 2nd poll)", async () => {
      const gets = routeFetch([[{ id: "someone-else" }], [{ id: "someone-else" }, { id: PROGRAM_ID }]]);
      await submit();

      // Accepted, polling has not found it yet: honest wording, no redirect, no extra navigation.
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i);
      expect(pushMock).not.toHaveBeenCalled();

      await elapse(500); // 1st poll: not there yet
      expect(gets()).toBe(1);
      expect(pushMock).not.toHaveBeenCalled();

      await elapse(800); // 2nd poll: present
      expect(gets()).toBe(2);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/hr/training");
      expect(refreshMock).toHaveBeenCalled();
      // It polls the real list endpoint, uncached.
      expect(String(getCalls()[0]?.[0])).toContain("/api/proxy/v1/hrms/training-programs");
    });

    it("also accepts the { data: [...] } list envelope", async () => {
      routeFetch([{ data: [{ id: PROGRAM_ID }] }]);
      await submit();
      await elapse(500);
      expect(pushMock).toHaveBeenCalledWith("/hr/training");
    });

    it("never finding the id shows a non-error still-processing notice with a ?created= link, and does not redirect", async () => {
      routeFetch([[]]);
      await submit();
      await elapse(10_000); // beyond the full bounded poll budget

      expect(getCalls().length).toBe(5);
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/still processing/i);
      const link = screen.getByRole("link", { name: /view training programmes/i });
      expect(link).toHaveAttribute("href", `/hr/training?created=${PROGRAM_ID}`);
      // No fabricated success claim.
      expect(screen.getByRole("status").textContent).not.toMatch(/created successfully/i);
    });

    it("keeps the form locked after a 202 so an unsure user cannot submit a duplicate", async () => {
      routeFetch([[]]);
      await submit();
      await elapse(10_000);
      const button = screen.getByRole("button", { name: /create training program/i });
      expect(button).toBeDisabled();
      fireEvent.submit(button.closest("form") as HTMLFormElement);
      await elapse(0);
      expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
    });

    it("a poll that errors out is only 'not visible yet' -- it neither redirects nor shows an error", async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(JSON.stringify({ id: PROGRAM_ID }), { status: 202 });
        return new Response("boom", { status: 500 });
      });
      await submit();
      await elapse(10_000);
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/still processing/i);
    });

    it("stops polling when the form unmounts mid-wait (cleanup-safe, no stray navigation)", async () => {
      routeFetch([[{ id: PROGRAM_ID }]]);
      fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      cleanup();
      await elapse(10_000);
      expect(getCalls()).toHaveLength(0);
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  describe("GAP-HR-TRAINING-NEW-03 — human validation messages and the past-date rule", () => {
    it("shows translated, human field errors (no zod tokens) when an empty form is submitted", async () => {
      renderForm();
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
      await waitFor(() => expect(screen.getAllByText("This field is required.").length).toBeGreaterThanOrEqual(4));
      for (const token of ["required", "tooLong", "invalid", "invalidInt"]) {
        expect(screen.queryByText(token)).not.toBeInTheDocument();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports an over-long title with its limit", async () => {
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "x".repeat(257) } });
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
      await waitFor(() => expect(screen.getByText("Must be 256 characters or fewer.")).toBeInTheDocument());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("warns for a From Date of yesterday (IST) but not for today", () => {
      renderForm();
      const from = screen.getByLabelText(/from date/i);
      fireEvent.change(from, { target: { value: "2026-09-14" } });
      expect(screen.getByText(/this start date is in the past/i)).toBeInTheDocument();
      fireEvent.change(from, { target: { value: "2026-09-15" } });
      expect(screen.queryByText(/this start date is in the past/i)).not.toBeInTheDocument();
    });

    it("a past From Date only warns -- it does not block the submit", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t-9" }), { status: 202 }));
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Back-dated session" } });
      fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-09-01" } });
      fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-02" } });
      fireEvent.change(screen.getByLabelText(/max participants/i), { target: { value: "10" } });
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });
  });

  describe("GAP-HR-TRAINING-NEW-04 — Hindi locale", () => {
    it("renders the form, placeholders and validation messages in Hindi", async () => {
      renderForm("hi");
      expect(screen.getByLabelText(/^शीर्षक/)).toBeInTheDocument();
      expect(screen.getByLabelText(/आरंभ तिथि/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText("जैसे उन्नत एक्सेल प्रशिक्षण")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "प्रशिक्षण कार्यक्रम बनाएँ" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "रद्द करें" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "प्रशिक्षण कार्यक्रम बनाएँ" }));
      await waitFor(() => expect(screen.getAllByText("यह फ़ील्ड आवश्यक है।").length).toBeGreaterThan(0));
      expect(screen.getByText("कृपया चिह्नित फ़ील्ड ठीक करें।")).toBeInTheDocument();
    });
  });

  describe("GAP-HR-TRAINING-NEW-05 — unsaved-changes guard", () => {
    function fireBeforeUnload(): Event {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e;
    }

    it("asks the browser to confirm a reload / tab close only while the form is dirty", () => {
      renderForm();
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it("no longer prompts on unload once the programme has been submitted", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t-1" }), { status: 202 }));
      fillAndSubmit();
      await screen.findByRole("status");
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });

    it("guards in-app links outside the form (e.g. the PageHeader back link) with the discard dialog", () => {
      renderForm("en", <a href="/hr/training">Back to Training</a>);
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      const notPrevented = fireEvent.click(screen.getByRole("link", { name: "Back to Training" }));
      expect(notPrevented).toBe(false);
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("Discard on an outside link navigates to THAT link's destination", () => {
      renderForm("en", <a href="/hr/leave?empId=1">Leave</a>);
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      fireEvent.click(screen.getByRole("link", { name: "Leave" }));
      fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
      expect(pushMock).toHaveBeenCalledWith("/hr/leave?empId=1");
    });

    /** Runs `fn`, swallowing the click's default so jsdom does not attempt a real navigation. */
    function withoutRealNavigation(fn: () => void): void {
      const swallow = (e: Event) => e.preventDefault();
      document.addEventListener("click", swallow);
      try {
        fn();
      } finally {
        document.removeEventListener("click", swallow);
      }
    }

    it("leaves in-app links alone while the form is clean", () => {
      renderForm("en", <a href="/hr/training">Back to Training</a>);
      withoutRealNavigation(() => fireEvent.click(screen.getByRole("link", { name: "Back to Training" })));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("Cancel does not open the discard dialog after a successful submit", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t-1" }), { status: 202 }));
      fillAndSubmit();
      await screen.findByRole("status");
      withoutRealNavigation(() => fireEvent.click(screen.getByRole("link", { name: /^cancel$/i })));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  describe("SF-19 discard ConfirmDialog (replaces native confirm)", () => {
    function cancelLink() {
      return screen.getByRole("link", { name: /^cancel$/i });
    }

    it("opens the dialog without navigating when a dirty form is cancelled, and never calls window.confirm", () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      const notPrevented = fireEvent.click(cancelLink());
      expect(notPrevented).toBe(false);
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("Escape closes the dialog and keeps the form without navigating", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^title/i)).toHaveValue("typed something");
    });

    it("Keep editing closes the dialog and keeps the form without navigating", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      fireEvent.click(screen.getByRole("button", { name: /^keep editing$/i }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^title/i)).toHaveValue("typed something");
    });

    it("Discard navigates to the list", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
      expect(pushMock).toHaveBeenCalledWith("/hr/training");
    });

    it("a clean form does not open the dialog on Cancel", () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      renderForm();
      const swallow = (e: Event) => e.preventDefault();
      let guardCancelled = true;
      const record = (e: Event) => { guardCancelled = e.defaultPrevented; };
      document.addEventListener("click", record);
      document.addEventListener("click", swallow);
      fireEvent.click(cancelLink());
      document.removeEventListener("click", record);
      document.removeEventListener("click", swallow);
      expect(guardCancelled).toBe(false);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
