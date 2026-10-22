import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { TravelApprovalsTable } from "./TravelApprovalsTable";
import type { TeamRow } from "./mapTravel";

const ME = "actor-approver";

function row(over: Partial<TeamRow>): TeamRow {
  return {
    id: "t1", destination: "Pune", purpose: "Field inspection", from_date: "2026-10-01", to_date: "2026-10-03",
    mode: "rail", status: "pending", advanceRequired: 250000, rejectionReason: "—", canClaim: false,
    employee: "Asha Verma", employeeId: "actor-asha", ...over,
  };
}

function renderTable(rows: TeamRow[], currentUserId: string | null = ME, locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <TravelApprovalsTable rows={rows} currentUserId={currentUserId} />
    </NextIntlClientProvider>,
  );
}

describe("TravelApprovalsTable (GAP-HR-TRAVEL-01)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("an approver sees Approve and Reject on another employee's pending request", () => {
    renderTable([row({})]);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("offers no actions on a request that is already decided", () => {
    renderTable([row({ id: "a", status: "approved" }), row({ id: "r", status: "rejected" })]);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("the viewer's OWN pending request never shows Approve / Reject (server would answer SELF_APPROVAL 403)", () => {
    renderTable([row({ employeeId: ME, employee: "Me Myself" })]);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.getByText("Your own request")).toBeInTheDocument();
  });

  it("mixed queue: actions only on the other person's row", () => {
    renderTable([
      row({ id: "own", employeeId: ME, employee: "Me Myself" }),
      row({ id: "other", employeeId: "actor-asha", employee: "Asha Verma" }),
    ]);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    const asha = screen.getByText("Asha Verma").closest("tr") as HTMLElement;
    expect(within(asha).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    const me = screen.getByText("Me Myself").closest("tr") as HTMLElement;
    expect(within(me).queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("approving PATCHes .../approve and refreshes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t1", status: "approved" }), { status: 200 }));
    renderTable([row({})]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/travel-requests/t1/approve",
      expect.objectContaining({ method: "PATCH" }),
    ));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("rejecting requires a reason and PATCHes .../reject with it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t1", status: "rejected" }), { status: 200 }));
    renderTable([row({})]);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), { target: { value: "Budget exceeded" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/hrms/travel-requests/t1/reject");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: "Budget exceeded" });
  });

  it("a server refusal shows a clerk-safe message, never the raw status", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    renderTable([row({})]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(dialog).toHaveTextContent(/permission/i));
    expect(dialog.textContent).not.toMatch(/\b403\b/);
  });

  it("the whole queue is localised (no English left in the Hindi table chrome)", () => {
    renderTable([row({})], ME, "hi");
    expect(screen.getByRole("button", { name: "स्वीकृत करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "अस्वीकृत करें" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("an empty queue explains itself", () => {
    renderTable([]);
    expect(screen.getByText("No requests to review")).toBeInTheDocument();
  });
});
