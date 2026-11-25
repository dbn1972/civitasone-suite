import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock("@/lib/useFormError", () => ({
  useFormError: () => ({ fromResponse: async () => ({ message: "failed" }) }),
}));

import { NewNoticeForm } from "./NewNoticeForm";

describe("NewNoticeForm", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("blocks submit until notice no, party and subject are filled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewNoticeForm />);
    fireEvent.click(screen.getByRole("button", { name: "Register notice" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the createNoticeBody shape after confirmation and returns to the register", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ id: "n1" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<NewNoticeForm />);
    fireEvent.change(screen.getByLabelText(/Notice no/), { target: { value: "LN/2026/0142" } });
    fireEvent.change(screen.getByLabelText(/Party/), { target: { value: "M/s Sharma Constructions Pvt. Ltd., Bhopal" } });
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Notice under Section 80 CPC, Ward 14 road resurfacing" } });
    fireEvent.change(screen.getByLabelText(/Direction/), { target: { value: "sent" } });
    fireEvent.click(screen.getByRole("button", { name: "Register notice" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Register notice")!);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/legal/notices"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/legal/notices");
    expect(JSON.parse(init.body as string)).toEqual({
      noticeNo: "LN/2026/0142",
      subject: "Notice under Section 80 CPC, Ward 14 road resurfacing",
      partyRef: "M/s Sharma Constructions Pvt. Ltd., Bhopal",
      direction: "sent",
    });
  });
});
