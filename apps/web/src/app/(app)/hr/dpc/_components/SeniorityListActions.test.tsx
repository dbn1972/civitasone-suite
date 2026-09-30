import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { SeniorityListActions, type SeniorityListSummary } from "./SeniorityListActions";

// UX-017: SeniorityListActions now reads its copy through next-intl
// (useTranslations("dpcSeniorityActions")), so every render needs a real
// provider in the tree — same pattern as
// hr/employees/[id]/edit/EditEmployeeForm.test.tsx. This file renders the
// component many times across its cases, so a small local helper keeps each
// call site short instead of repeating the wrap seven times.
function renderActions(props: { canAdminister: boolean; lists?: SeniorityListSummary[] }) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SeniorityListActions canAdminister={props.canAdminister} lists={props.lists ?? []} />
    </NextIntlClientProvider>,
  );
}

const GENERATED_LIST: SeniorityListSummary = {
  id: "22222222-2222-2222-2222-222222222222",
  status: "generated",
  asOf: "2026-04-01",
  createdAt: "2026-04-01T10:00:00Z",
  approvedAt: null,
};

describe("SeniorityListActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders no action for a role outside the backend's HR_ROLES gate", () => {
    renderActions({ canAdminister: false, lists: [GENERATED_LIST] });
    expect(screen.queryByRole("button", { name: "Generate Seniority List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the Generate action for an hr_admin/hr_officer/super_admin-gated caller, with no table when there are no persisted lists", () => {
    renderActions({ canAdminister: true, lists: [] });
    expect(screen.getByRole("button", { name: "Generate Seniority List" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("GAP-HR-DPC-04: renders a persisted 'generated' list's Approve action from the `lists` prop -- not from any client-side generate() state", () => {
    renderActions({ canAdminister: true, lists: [GENERATED_LIST] });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Approve List ${GENERATED_LIST.id.slice(0, 8)}…` }),
    ).toBeInTheDocument();
  });

  it("GAP-HR-DPC-04: a list already approved shows no Approve action", () => {
    renderActions({
      canAdminister: true,
      lists: [{ ...GENERATED_LIST, id: "33333333-3333-3333-3333-333333333333", status: "approved", approvedAt: "2026-04-02T09:00:00Z" }],
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve List/ })).not.toBeInTheDocument();
  });

  it("GAP-HR-DPC-04: multiple 'generated' lists each get their own independent Approve action", () => {
    const listA: SeniorityListSummary = { ...GENERATED_LIST, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
    const listB: SeniorityListSummary = { ...GENERATED_LIST, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
    renderActions({ canAdminister: true, lists: [listA, listB] });
    expect(screen.getByRole("button", { name: `Approve List ${listA.id.slice(0, 8)}…` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Approve List ${listB.id.slice(0, 8)}…` })).toBeInTheDocument();
  });

  it("calls POST /v1/hrms/seniority/generate and shows the queued message (happy path) -- Approve visibility is the parent page's job via a fresh `lists` prop, not this component's own state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", status: "accepted", correlationId: "c-1" }),
        { status: 202 },
      ),
    );

    renderActions({ canAdminister: true, lists: [] });
    fireEvent.click(screen.getByRole("button", { name: "Generate Seniority List" }));

    await waitFor(() => expect(screen.getByText("Generate a new seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.getByText(/Seniority list generation queued/)).toBeInTheDocument();
    });
    expect(screen.getByText(/11111111-1111-1111-1111-111111111111/)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/seniority/generate");
    expect(init.method).toBe("POST");
  });

  it("surfaces a generate failure on the confirm dialog instead of swallowing it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "FORBIDDEN", message: "HR admin role required." }), { status: 403 }),
    );

    renderActions({ canAdminister: true, lists: [] });
    fireEvent.click(screen.getByRole("button", { name: "Generate Seniority List" }));
    await waitFor(() => expect(screen.getByText("Generate a new seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/HR admin role required/)).not.toBeInTheDocument();
    // Failure must stay visible in the dialog, not disappear silently, and
    // must not fabricate a success message.
    expect(screen.queryByText(/Seniority list generation queued/)).not.toBeInTheDocument();
  });

  it("calls POST /v1/hrms/seniority/:id/approve for the targeted persisted list (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: GENERATED_LIST.id, status: "accepted" }), { status: 202 }),
    );

    renderActions({ canAdminister: true, lists: [GENERATED_LIST] });
    fireEvent.click(screen.getByRole("button", { name: `Approve List ${GENERATED_LIST.id.slice(0, 8)}…` }));
    await waitFor(() => expect(screen.getByText("Approve this seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      // DOM-023 fix: a 202 only means the approve command was queued, not
      // that the consumer's status-guarded UPDATE actually matched a row
      // (it silently no-ops otherwise -- see routes.ts/consumer.ts). The
      // copy must not assert "approved" as a confirmed, completed fact.
      expect(
        screen.getByText(`Seniority list approval submitted (list ID ${GENERATED_LIST.id}). It will be confirmed shortly.`),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(`Seniority list ${GENERATED_LIST.id} approved.`)).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/hrms/seniority/${GENERATED_LIST.id}/approve`);
    expect(init.method).toBe("POST");
  });

  it("surfaces an approve failure on its confirm dialog instead of swallowing it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderActions({ canAdminister: true, lists: [GENERATED_LIST] });
    fireEvent.click(screen.getByRole("button", { name: `Approve List ${GENERATED_LIST.id.slice(0, 8)}…` }));
    await waitFor(() => expect(screen.getByText("Approve this seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
    // The dialog stays open/available on failure -- the list is still
    // "generated" in `lists` (this test never changes that prop), so the
    // action must still be there, not consumed on a failed attempt.
    expect(
      screen.getByRole("button", { name: `Approve List ${GENERATED_LIST.id.slice(0, 8)}…` }),
    ).toBeInTheDocument();
  });

  it("DOM-023: a backend 422 (list already approved / no longer matches) surfaces as a real error, never as a fabricated success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "INVALID_STATUS", message: "seniority list is already approved" }),
        { status: 422 },
      ),
    );

    renderActions({ canAdminister: true, lists: [GENERATED_LIST] });
    fireEvent.click(screen.getByRole("button", { name: `Approve List ${GENERATED_LIST.id.slice(0, 8)}…` }));
    await waitFor(() => expect(screen.getByText("Approve this seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/INVALID_STATUS/)).not.toBeInTheDocument();
    // Must never show any approval-submitted/approved copy on this path.
    expect(screen.queryByText(/approval submitted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approved\./)).not.toBeInTheDocument();
  });
});
