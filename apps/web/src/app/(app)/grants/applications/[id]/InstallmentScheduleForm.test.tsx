import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { InstallmentScheduleForm } from "./InstallmentScheduleForm";

const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

describe("InstallmentScheduleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("posts the schedule to the application installments route in paise", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<InstallmentScheduleForm applicationId="app-1" approvedMinor={50000000} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "250000.50" } });
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/applications/app-1/installments");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      currency: "INR",
      installments: [{ installmentNo: 1, amountMinor: 25000050, dueDate: "2026-12-01" }],
    });
  });

  it("blocks a schedule that exceeds the sanctioned amount without calling the API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<InstallmentScheduleForm applicationId="app-1" approvedMinor={100000} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    expect(screen.getByRole("alert").textContent).toMatch(/exceeds the sanctioned amount/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a plain error on a failed save", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(<InstallmentScheduleForm applicationId="app-1" approvedMinor={100000} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("accepts Indian comma-formatted amounts such as the placeholder", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<InstallmentScheduleForm applicationId="app-1" approvedMinor={50000000} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: " 2,50,000 " } });
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.installments[0].amountMinor).toBe(25000000);
  });
});
