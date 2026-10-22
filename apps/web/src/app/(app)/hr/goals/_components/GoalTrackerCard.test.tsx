import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { ToastProvider } from "@/app/_components/ds";
import { GoalTrackerCard } from "./GoalTrackerCard";

// One shared refresh spy so the check-in tests can assert router.refresh() ran
// (the global next/navigation mock builds a fresh, unobservable one per call).
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: refreshMock }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

// GAP-HR-GOALS-01/05: this component now calls useTranslations("goals") (for
// the real check-in error copy) -- wrapped the same way every other
// "use client" component's test in this tree is (see e.g.
// hr/_components/ShiftChangeRequestForm.test.tsx), matching next-intl's own
// requirement that useTranslations run under a NextIntlClientProvider.
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const PROPS = {
  id: "g1",
  title: "Digitize 10,000 land records",
  progress: 40,
  status: "on_track" as const,
  category: "Digital India",
};

// UX-008 tranche 2: Edit/Check-in/Cancel/Save were ad hoc inline-styled
// buttons (no shared design-system class at all) -- converted onto the
// shared Button component. No prior test existed for this file, so these
// cover that the click/toggle/callback wiring still works post-conversion.
describe("GoalTrackerCard", () => {
  it("calls onEdit with the goal id when Edit is clicked", () => {
    const onEdit = vi.fn();
    render(<GoalTrackerCard {...PROPS} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith("g1");
  });

  it("does not render an Edit button when onEdit is not supplied", () => {
    render(<GoalTrackerCard {...PROPS} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("opens the check-in form, then Cancel closes it without calling onCheckin", () => {
    const onCheckin = vi.fn();
    render(<GoalTrackerCard {...PROPS} onCheckin={onCheckin} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    expect(screen.getByText("New progress (%)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("New progress (%)")).not.toBeInTheDocument();
    expect(onCheckin).not.toHaveBeenCalled();
  });

  it("Save submits the edited progress and note, then closes the form", () => {
    const onCheckin = vi.fn();
    render(<GoalTrackerCard {...PROPS} onCheckin={onCheckin} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));

    fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "65" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Surveyed 3 more districts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onCheckin).toHaveBeenCalledWith("g1", 65, "Surveyed 3 more districts");
    expect(screen.queryByText("New progress (%)")).not.toBeInTheDocument();
  });

  // GAP-HR-GOALS-01: with no `onCheckin` override (the real production
  // usage from goals/page.tsx, a Server Component that can't pass one),
  // Save must actually call POST /v1/hrms/goals/:id/checkin instead of
  // silently closing the form with nothing persisted.
  describe("without an onCheckin override (real production path)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("POSTs the check-in, then closes the form and shows the new progress", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "checked_in", progress: 65 }),
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<GoalTrackerCard {...PROPS} />);
      fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
      fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "65" } });
      fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Surveyed 3 more districts" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await screen.findByText("65%");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/proxy/v1/hrms/goals/g1/checkin",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ progress: 65, note: "Surveyed 3 more districts" }),
        }),
      );
      expect(screen.queryByText("New progress (%)")).not.toBeInTheDocument();
    });

    it("keeps the form open and shows an error when the request fails", async () => {
      // A real Response: the error now goes through useFormError, which reads
      // the body/status itself instead of echoing the server's raw `message`.
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Goal not found" }), { status: 404 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      render(<GoalTrackerCard {...PROPS} />);
      fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
      fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "65" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/couldn.t find/i);
      expect(alert).not.toHaveTextContent("Goal not found");
      expect(screen.getByText("New progress (%)")).toBeInTheDocument();
      // Still shows the original, unsaved progress -- the optimistic update
      // only happens after a confirmed 2xx.
      expect(screen.getByText("40%")).toBeInTheDocument();
    });

    it("blocks an out-of-range progress value with an inline error and makes no request (mirrors goalCheckinSchema)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      render(<GoalTrackerCard {...PROPS} />);
      fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
      fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "150" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Progress cannot be above 100.")).toBeInTheDocument();
      expect(screen.getByLabelText(/New progress/)).toHaveAttribute("aria-invalid", "true");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

// GAP-HR-GOALS-01 acceptance, verbatim: "Save fires POST with {progress:60,note};
// 200 -> toast and card shows 60%. 500 keeps the form open with an error.
// Progress 100 shows completed and refresh reflects Completed stat."
describe("GoalTrackerCard check-in outcome (GAP-HR-GOALS-01)", () => {
  beforeEach(() => refreshMock.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  function renderWithToast(ui: React.ReactElement, messages: Record<string, unknown> = enMessages, locale = "en") {
    return rtlRender(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>,
    );
  }

  function checkin(progress: string, note?: string) {
    fireEvent.click(screen.getByRole("button", { name: /check-in|चेक-इन/i }));
    fireEvent.change(screen.getByLabelText(/New progress|नई प्रगति/), { target: { value: progress } });
    if (note !== undefined) fireEvent.change(screen.getByLabelText(/Note|टिप्पणी/), { target: { value: note } });
    fireEvent.click(screen.getByRole("button", { name: /^(Save|सहेजें)$/ }));
  }

  it("Save POSTs {progress:60,note}; on 200 a success toast appears and the card shows 60%", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "checked_in", progress: 60, goalStatus: "active", health: "on_track" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithToast(<GoalTrackerCard {...PROPS} />);
    checkin("60", "Two more districts");

    expect(await screen.findByText("Check-in saved. Progress is now 60%.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/goals/g1/checkin",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ progress: 60, note: "Two more districts" }) }),
    );
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.queryByText("New progress (%)")).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("with no ToastProvider mounted the confirmation still shows, as a role=status line", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "checked_in", progress: 60 }), { status: 200 })));
    render(<GoalTrackerCard {...PROPS} />);
    checkin("60");
    expect(await screen.findByRole("status")).toHaveTextContent("Check-in saved. Progress is now 60%.");
  });

  it("a 500 keeps the form open with an error, shows no success confirmation and does not refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "boom" }), { status: 500 })));
    renderWithToast(<GoalTrackerCard {...PROPS} />);
    checkin("60", "x");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t save/i);
    expect(alert).not.toHaveTextContent("boom");
    expect(screen.getByText("New progress (%)")).toBeInTheDocument();
    expect(screen.queryByText(/Check-in saved/)).not.toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("progress 100 shows the goal as completed (Achieved), says so, and refreshes the list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "checked_in", progress: 100, goalStatus: "completed", health: "completed" }), { status: 200 }),
    ));
    renderWithToast(<GoalTrackerCard {...PROPS} />);
    expect(screen.getByText("On Track")).toBeInTheDocument();
    checkin("100");

    expect(await screen.findByText("Check-in saved. This goal is now complete.")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Achieved")).toBeInTheDocument();
    expect(screen.queryByText("On Track")).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

// GAP-HR-GOALS-04: after a check-in the card used to force "active" (shown as
// On Track) whatever the server's health was, and never resynced to the
// refreshed props, while the refreshed stat counted the same goal At Risk.
describe("GoalTrackerCard badge follows server health (GAP-HR-GOALS-04)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the health the check-in response reports (Behind), not On Track", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "checked_in", progress: 20, goalStatus: "active", health: "behind" }), { status: 200 }),
    ));
    render(<GoalTrackerCard {...PROPS} status="on_track" />);
    expect(screen.getByText("On Track")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Behind")).toBeInTheDocument();
    expect(screen.queryByText("On Track")).not.toBeInTheDocument();
  });

  it("falls back to On Track (active) when an older service sends no health", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "checked_in", progress: 65 }), { status: 200 })));
    render(<GoalTrackerCard {...PROPS} status="at_risk" />);
    expect(screen.getByText("At Risk")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "65" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("65%")).toBeInTheDocument();
    expect(screen.getByText("On Track")).toBeInTheDocument();
  });

  it("resyncs the badge and progress when the refreshed server props change", async () => {
    const { rerender } = render(<GoalTrackerCard {...PROPS} status="on_track" progress={40} />);
    expect(screen.getByText("On Track")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GoalTrackerCard {...PROPS} status="at_risk" progress={55} />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("At Risk")).toBeInTheDocument());
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.queryByText("On Track")).not.toBeInTheDocument();
  });
});

// GAP-HR-GOALS-05: status / cascade / due-date text used to be hard-coded
// English, so the card stayed English when the locale was hi.
describe("GoalTrackerCard labels follow the locale (GAP-HR-GOALS-05)", () => {
  const hi = (ui: React.ReactElement) =>
    rtlRender(<NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);
  const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

  it("renders status, cascade, parent-goal and due-date text in English", () => {
    render(<GoalTrackerCard {...PROPS} status="at_risk" cascadeLevel="individual" parentGoalTitle="Digital Bharat" dueDate={daysFromNow(-3)} />);
    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("Org")).toBeInTheDocument();
    expect(screen.getByText("Dept")).toBeInTheDocument();
    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByText(/Cascaded from:/)).toBeInTheDocument();
    expect(screen.getByText("3d overdue")).toBeInTheDocument();
  });

  it("renders the same text in Hindi, with no English left over", () => {
    hi(<GoalTrackerCard {...PROPS} status="at_risk" cascadeLevel="individual" parentGoalTitle="Digital Bharat" dueDate={daysFromNow(-3)} />);
    expect(screen.getByText("जोखिम में")).toBeInTheDocument();
    expect(screen.getByText("संगठन")).toBeInTheDocument();
    expect(screen.getByText("विभाग")).toBeInTheDocument();
    expect(screen.getByText("व्यक्तिगत")).toBeInTheDocument();
    expect(screen.getByText(/मूल लक्ष्य:/)).toBeInTheDocument();
    expect(screen.getByText("3 दिन विलंबित")).toBeInTheDocument();
    for (const english of ["At Risk", "Org", "Dept", "Cascaded from", "overdue"]) {
      expect(screen.queryByText(new RegExp(english))).not.toBeInTheDocument();
    }
  });

  it("renders Due today / N days left through the catalogue", () => {
    const { unmount } = render(<GoalTrackerCard {...PROPS} dueDate={new Date().toISOString()} />);
    // "today" is a ceil() of a few-ms-negative diff, i.e. 0 -> Due today.
    expect(screen.getByText("Due today")).toBeInTheDocument();
    unmount();
    render(<GoalTrackerCard {...PROPS} dueDate={daysFromNow(5)} />);
    expect(screen.getByText("5d left")).toBeInTheDocument();
  });
});
