import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import HalfDayLeaveSettings from "./HalfDayLeaveSettings";

function renderIt() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}><HalfDayLeaveSettings /></NextIntlClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("HalfDayLeaveSettings (GAP-HR-LEAVE-APPLY-05)", () => {
  it("both switches start OFF and Save is disabled until something changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ halfDayEnabled: false, shortLeaveEnabled: false }) })));
    renderIt();
    const half = screen.getByLabelText("Allow half-day Casual Leave") as HTMLInputElement;
    expect(half.checked).toBe(false);
    expect((screen.getByLabelText("Allow short leave") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });

  it("loads the saved switches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ halfDayEnabled: true, shortLeaveEnabled: false }) })));
    renderIt();
    await waitFor(() => expect((screen.getByLabelText("Allow half-day Casual Leave") as HTMLInputElement).checked).toBe(true));
  });

  it("PUTs exactly both booleans with an idempotency key, and confirms", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? ({ ok: true, json: async () => ({}) }) : ({ ok: true, json: async () => ({ halfDayEnabled: false, shortLeaveEnabled: false }) }));
    vi.stubGlobal("fetch", fetchMock);
    renderIt();
    fireEvent.click(screen.getByLabelText("Allow half-day Casual Leave"));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT")!;
    expect(put[0]).toBe("/api/proxy/v1/hrms/leave-config");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ halfDayEnabled: true, shortLeaveEnabled: false });
    expect((put[1]!.headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
  });

  it("a failed save shows a clerk-safe message, not the raw status", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response("boom", { status: 500 }) : ({ ok: true, json: async () => ({ halfDayEnabled: false, shortLeaveEnabled: false }) })));
    renderIt();
    fireEvent.click(screen.getByLabelText("Allow short leave"));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/500|boom/);
  });
});
