import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RequestDetailClient } from "./RequestDetailClient";
import type { Grievance } from "../../_data/loaders";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const g: Grievance = {
  id: "gr1", category: "sanitation", subject: "Garbage not collected", description: "5 days", priority: "high",
  status: "open", departmentRef: "Sanitation Dept", assignedTo: null,
  createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-02T00:00:00Z", actions: [],
};

const ui = (props = {}) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <RequestDetailClient id="gr1" initialGrievance={g} initialSource="api" isOfficer {...props} />
  </NextIntlClientProvider>
);

describe("RequestDetailClient (CLOS-S1-06)", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("load failure offline shows generic copy, not raw 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    render(ui({ initialGrievance: null, initialSource: "error" }));
    expect(await screen.findByText("Failed to load request.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("add-action offline shows generic copy, not raw 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    render(ui());
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRequests.addAction }));
    fireEvent.submit(screen.getByLabelText(enMessages.citizenRequests.noteLabel).closest("form")!);
    expect(await screen.findByText("Could not record the action.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("the post-mutation polling chain stops on unmount (no fetch after unmount)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => g }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(ui());
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRequests.addAction }));
    fireEvent.submit(screen.getByLabelText(enMessages.citizenRequests.noteLabel).closest("form")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const before = fetchMock.mock.calls.length; // POST + first tick
    expect(before).toBeGreaterThanOrEqual(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
