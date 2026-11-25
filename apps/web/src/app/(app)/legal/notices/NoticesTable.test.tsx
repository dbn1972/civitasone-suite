import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock("@/lib/useFormError", () => ({
  useFormError: () => ({ fromResponse: async () => ({ message: "failed" }), fromException: () => ({ message: "failed" }) }),
}));

import { NoticesTable } from "./NoticesTable";

const ITEMS = [
  { id: "11111111-1111-4111-8111-111111111111", noticeNo: "LN/2026/0142", subject: "Section 80 CPC notice, Ward 14 resurfacing", partyRef: "M/s Sharma Constructions Pvt. Ltd.", direction: "received" as const, status: "open" as const, createdAt: "2026-11-02T05:00:00.000Z" },
  { id: "22222222-2222-4222-8222-222222222222", noticeNo: "LN/2026/0131", subject: "Reply to RTI-linked demand notice", partyRef: "Bhopal Jal Board", direction: "sent" as const, status: "responded" as const, createdAt: "2026-10-12T05:00:00.000Z" },
];

describe("NoticesTable", () => {
  beforeEach(() => refreshMock.mockReset());

  it("offers Respond only on open notices", () => {
    render(<NoticesTable items={ITEMS} />);
    expect(screen.getAllByRole("button", { name: /Respond to notice/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Respond to notice LN/2026/0142" })).toBeInTheDocument();
  });

  it("POSTs responseBody to the respond route", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<NoticesTable items={ITEMS} />);
    fireEvent.click(screen.getByRole("button", { name: "Respond to notice LN/2026/0142" }));
    fireEvent.change(await screen.findByLabelText(/Response/), { target: { value: "Payment is subject to measurement verification under the work order." } });
    fireEvent.click(screen.getByRole("button", { name: "Record response" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/legal/notices/11111111-1111-4111-8111-111111111111/respond");
    expect(JSON.parse(init.body as string)).toEqual({ responseBody: "Payment is subject to measurement verification under the work order." });
  });
});
