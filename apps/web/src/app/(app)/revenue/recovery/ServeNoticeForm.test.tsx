import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ServeNoticeForm } from "./ServeNoticeForm";

describe("ServeNoticeForm (owner decision #4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires the notice number, the served-on date and a notice period", () => {
    render(<ServeNoticeForm assesseeId="a1" />);
    // the period is pre-filled with the tenant default; clearing it is an error
    fireEvent.change(screen.getByLabelText(/^Notice period/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Record served notice" }));
    expect(screen.getByText("Enter the demand notice number.")).toBeInTheDocument();
    expect(screen.getByText("Enter the date the notice was served.")).toBeInTheDocument();
    expect(screen.getByText("Enter the notice period in days (1 to 365).")).toBeInTheDocument();
  });

  it("F1: the period is pre-filled with the tenant default (15 unless configured) and cannot go below it", () => {
    const { unmount } = render(<ServeNoticeForm assesseeId="a1" />);
    expect(screen.getByLabelText(/^Notice period/)).toHaveValue(15);
    expect(screen.getByLabelText(/^Notice period/)).toHaveAttribute("min", "15");
    unmount();
    render(<ServeNoticeForm assesseeId="a1" defaultNoticePeriodDays={30} />);
    expect(screen.getByLabelText(/^Notice period/)).toHaveValue(30);
    fireEvent.change(screen.getByLabelText(/^Notice number/), { target: { value: "DN-1" } });
    fireEvent.change(screen.getByLabelText(/^Served on/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^Notice period/), { target: { value: "20" } });
    const spy = vi.spyOn(globalThis, "fetch");
    fireEvent.click(screen.getByRole("button", { name: "Record served notice" }));
    expect(screen.getByText("The notice period cannot be shorter than the default of 30 days; you can only lengthen it.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts the notice with the officer-entered (lengthened) period", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { messageId: "m1" } }), { status: 202 }));
    render(<ServeNoticeForm assesseeId="a1" />);
    fireEvent.change(screen.getByLabelText(/^Notice number/), { target: { value: "DN-2026-0007" } });
    fireEvent.change(screen.getByLabelText(/^Served on/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^Notice period/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Record served notice" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const body = JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ assesseeId: "a1", noticeNo: "DN-2026-0007", servedOn: "2026-08-01", noticePeriodDays: 30 });
    await waitFor(() => expect(screen.getByText(/Demand notice recorded/)).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error, never the raw server code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<ServeNoticeForm assesseeId="a1" />);
    fireEvent.change(screen.getByLabelText(/^Notice number/), { target: { value: "DN-1" } });
    fireEvent.change(screen.getByLabelText(/^Served on/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^Notice period/), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Record served notice" }));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
