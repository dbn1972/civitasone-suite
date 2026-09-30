import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { GoalTrackerCard } from "./GoalTrackerCard";

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
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: "Goal not found" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<GoalTrackerCard {...PROPS} />);
      fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
      fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "65" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Goal not found");
      expect(screen.getByText("New progress (%)")).toBeInTheDocument();
      // Still shows the original, unsaved progress -- the optimistic update
      // only happens after a confirmed 2xx.
      expect(screen.getByText("40%")).toBeInTheDocument();
    });
  });
});
