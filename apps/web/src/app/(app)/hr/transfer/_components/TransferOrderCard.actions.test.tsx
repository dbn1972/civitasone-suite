import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { TransferOrderCard, type TransferRow } from "./TransferOrderCard";

const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const row = (status: string, extra: Partial<TransferRow> = {}): TransferRow => ({
  id: "t-9", employee: "Asha Rao", fromOffice: "Estate", toOffice: "Finance", status, ...extra,
});

const ACTIONS = ["Issue Order", "Mark Relieved", "Mark Joined"];
const shown = () => ACTIONS.filter((a) => screen.queryByRole("button", { name: a }));

// GAP-HR-TRANSFER-08: one action per status, mirroring the backend guards in
// lifecycle/routes.ts (issue-order: requested|pending, relieve: ordered,
// join: relieved). Anything else is read-only.
describe("TransferOrderCard action per status (GAP-HR-TRANSFER-08)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
  });

  it.each([
    ["requested", ["Issue Order"]],
    ["pending", ["Issue Order"]], // legacy row: the backend still accepts issue-order from it
    ["ordered", ["Mark Relieved"]],
    ["relieved", ["Mark Joined"]],
    ["joined", []],
    ["completed", []],
    ["cancelled", []],
    ["pending_approval", []],
    ["pending_effective", []],
  ])("status %s offers exactly %j", (status, expected) => {
    render(<TransferOrderCard transfer={row(status)} />);
    expect(shown()).toEqual(expected);
  });

  it("'relieved' -> Mark Joined posts to the join route after a confirm, with the IST date", async () => {
    render(<TransferOrderCard transfer={row("relieved")} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Joined" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Asha Rao/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Joined" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/hrms/lifecycle/transfers/t-9/join");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).joinedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("'ordered' -> Mark Relieved posts to the relieve route", async () => {
    render(<TransferOrderCard transfer={row("ordered")} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Relieved" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Relieved" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/hrms/lifecycle/transfers/t-9/relieve");
  });

  it("advances one pipeline step per status and ends at Joined", () => {
    const current = (status: string) => {
      const { unmount } = render(<TransferOrderCard transfer={row(status)} />);
      const timeline = screen.getByLabelText("Transfer status timeline");
      const active = within(timeline).getAllByRole("listitem").findIndex((li) => li.getAttribute("aria-current") === "step");
      unmount();
      return active;
    };
    expect(["requested", "ordered", "relieved", "joined"].map(current)).toEqual([0, 1, 2, 3]);
  });

  it("colours the status pill from the shared transfer tone map (joined good, ordered warn, cancelled bad)", () => {
    const pill = (status: string) => {
      const { container, unmount } = render(<TransferOrderCard transfer={row(status)} />);
      const cls = container.querySelector(".card-h .pill")?.className ?? "";
      unmount();
      return cls;
    };
    expect(pill("joined")).toContain("good");
    expect(pill("ordered")).toContain("warn");
    expect(pill("pending_effective")).toContain("warn");
    expect(pill("cancelled")).toContain("bad");
  });
});
