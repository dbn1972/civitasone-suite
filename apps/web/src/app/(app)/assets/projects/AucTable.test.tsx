import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AucTable, type AucRow } from "./AucTable";
import { renderIntl as render } from "../testIntl";

const UNDER_CONSTRUCTION: AucRow = {
  id: "11111111-1111-1111-1111-111111111111",
  projectCode: "AUC-001",
  name: "New District Office Wing",
  wbsRef: "WBS-42",
  accumulatedMinor: 1500000,
  status: "under_construction",
  assetId: null,
};

describe("AucTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders the guided empty state with no rows", () => {
    render(<AucTable rows={[]} />);
    expect(screen.getByText("No AUC projects yet")).toBeInTheDocument();
  });

  it("capitalizes an AUC project on confirm (happy path, maker-checker switched off)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "22222222-2222-2222-2222-222222222222" }), { status: 202 }),
    );

    render(<AucTable rows={[UNDER_CONSTRUCTION]} makerChecker={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
    await waitFor(() => expect(screen.getByText('Capitalize "AUC-001"?')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Authorised by finance controller" } });
    fireEvent.click(screen.getByText("Capitalize to fixed asset"));

    await waitFor(() => {
      expect(screen.getByText(/Capitalization submitted for "AUC-001"/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "AUC not found" }), { status: 404 }),
    );

    render(<AucTable rows={[UNDER_CONSTRUCTION]} makerChecker={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
    await waitFor(() => expect(screen.getByText('Capitalize "AUC-001"?')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Authorised by finance controller" } });
    fireEvent.click(screen.getByText("Capitalize to fixed asset"));

    // status 404 -> kind "load", not "save" (this is the one file in the UX-020
    // batch where the fixture's status actually maps to the "load" catalogue entry).
    await waitFor(() => {
      expect(screen.getByText(/We couldn't find this information\. It may have been removed or the link may be wrong\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/NOT_FOUND: AUC not found/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-ASSETS-PROJECTS-09: maker != checker
  describe("maker-checker capitalization", () => {
    const PENDING: AucRow = { ...UNDER_CONSTRUCTION, id: "44444444-4444-4444-4444-444444444444", projectCode: "AUC-777", status: "pending_capitalization" };
    const calls = () => (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;

    it("by default a request is submitted with a reason and the chosen capitalisation date, and says approval is pending", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: UNDER_CONSTRUCTION.id }), { status: 202 }));
      render(<AucTable rows={[UNDER_CONSTRUCTION]} />);
      fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
      await waitFor(() => expect(screen.getByText(/A different asset administrator must approve it/)).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Capitalisation date"), { target: { value: "2026-06-15" } });
      fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Commissioned 15 June" } });
      fireEvent.click(screen.getByText("Request capitalization"));
      await waitFor(() => expect(screen.getByText(/awaiting approval by a different asset administrator/)).toBeInTheDocument());
      expect(String(calls()[0]![0])).toBe(`/api/proxy/v1/asset/projects/auc/${UNDER_CONSTRUCTION.id}/capitalize`);
      expect(JSON.parse(String(calls()[0]![1].body))).toEqual({ reason: "Commissioned 15 June", capitalizationDate: "2026-06-15" });
    });

    it("blocks a future capitalisation date before any request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      render(<AucTable rows={[UNDER_CONSTRUCTION]} />);
      fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
      await waitFor(() => expect(screen.getByLabelText("Capitalisation date")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Capitalisation date"), { target: { value: "2999-01-01" } });
      fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Commissioned" } });
      fireEvent.click(screen.getByText("Request capitalization"));
      expect(await screen.findByText(/not in the future/)).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("shows Approve / Reject (and an awaiting-approval status) for a pending project, not Capitalize", () => {
      render(<AucTable rows={[PENDING]} />);
      expect(screen.getByRole("button", { name: "Approve capitalization of project AUC-777" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reject capitalization of project AUC-777" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Capitalize project/ })).not.toBeInTheDocument();
      expect(screen.getByText(/awaiting approval/i)).toBeInTheDocument();
    });

    it("approving by the same person who requested shows plain maker-checker copy, never the code", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER", message: "a different approver must approve this capitalisation" }), { status: 403 }));
      render(<AucTable rows={[PENDING]} />);
      fireEvent.click(screen.getByRole("button", { name: "Approve capitalization of project AUC-777" }));
      fireEvent.click(await screen.findByText("Approve capitalization"));
      expect(await screen.findByText(/You requested it, so you cannot approve it/)).toBeInTheDocument();
      expect(screen.queryByText(/MAKER_CHECKER/)).not.toBeInTheDocument();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it("rejecting needs a reason and posts it", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: PENDING.id }), { status: 202 }));
      render(<AucTable rows={[PENDING]} />);
      fireEvent.click(screen.getByRole("button", { name: "Reject capitalization of project AUC-777" }));
      const confirm = await screen.findByText("Reject capitalization");
      expect(confirm.closest("button")).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Completion certificate missing" } });
      fireEvent.click(confirm);
      await waitFor(() => expect(screen.getByText(/rejected; the project is back under construction/)).toBeInTheDocument());
      expect(String(calls()[0]![0])).toMatch(/capitalize\/reject$/);
      expect(JSON.parse(String(calls()[0]![1].body))).toEqual({ reason: "Completion certificate missing" });
    });
  });

  // fp-assets-01: GL heads + journal state
  describe("GL heads and journal state", () => {
    const calls = () => (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    const code409 = (code: string) => new Response(JSON.stringify({ code, message: "server text that must not be shown" }), { status: 409 });

    it("shows a clear message (en) when the GL accounts are not configured, never the server text or the code", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(code409("ASSET_GL_NOT_CONFIGURED"));
      render(<AucTable rows={[UNDER_CONSTRUCTION]} />);
      fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
      fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Commissioned" } });
      fireEvent.click(screen.getByText("Request capitalization"));
      expect(await screen.findByText(/GL accounts are not set up yet/)).toBeInTheDocument();
      expect(screen.queryByText(/server text/)).not.toBeInTheDocument();
      expect(screen.queryByText(/ASSET_GL_NOT_CONFIGURED/)).not.toBeInTheDocument();
      expect(refreshMock).not.toHaveBeenCalled();
      expect(calls()).toHaveLength(1);
    });

    it("shows the same message in Hindi", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(code409("ASSET_GL_NOT_CONFIGURED"));
      render(<AucTable rows={[UNDER_CONSTRUCTION]} />, "hi");
      fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
      fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Commissioned" } });
      fireEvent.click(screen.getByText("Request capitalization"));
      expect(await screen.findByText(/GL खाते अभी सेट नहीं हैं/)).toBeInTheDocument();
    });

    it("explains an invalid head and an unreachable finance in their own words", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(code409("GL_HEAD_INVALID"));
      render(<AucTable rows={[{ ...UNDER_CONSTRUCTION, id: "55555555-5555-5555-5555-555555555555", projectCode: "AUC-555" }]} />);
      fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-555" }));
      fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Commissioned" } });
      fireEvent.click(screen.getByText("Request capitalization"));
      expect(await screen.findByText(/is not accepted/)).toBeInTheDocument();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ code: "FINANCE_UNAVAILABLE" }), { status: 503 }));
      fireEvent.click(screen.getByText("Request capitalization"));
      expect(await screen.findByText(/Finance could not be reached/)).toBeInTheDocument();
    });

    it("a failed journal offers Repost (after a confirm), posts to the repost route, and refreshes", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
      const failed: AucRow = { ...UNDER_CONSTRUCTION, id: "77777777-7777-7777-7777-777777777777", projectCode: "AUC-777F", status: "capitalized", assetId: null, glPostStatus: "failed" };
      render(<AucTable rows={[failed, { ...failed, id: "88888888-8888-8888-8888-888888888888", projectCode: "AUC-888P", glPostStatus: "pending" }]} />);
      expect(screen.getAllByRole("button", { name: /Repost journal/ })).toHaveLength(1); // only the failed row
      fireEvent.click(screen.getByRole("button", { name: "Repost journal: AUC-777F" }));
      expect(await screen.findByText("Repost this journal?")).toBeInTheDocument();
      expect(calls()).toHaveLength(0); // nothing is sent before Confirm
      fireEvent.click(screen.getByText("Repost"));
      await waitFor(() => expect(screen.getByText(/Journal sent to Finance again/)).toBeInTheDocument());
      expect(String(calls()[0]![0])).toBe("/api/proxy/v1/asset/projects/auc/77777777-7777-7777-7777-777777777777/journal/repost");
      expect(calls()[0]![1].method).toBe("POST");
      expect(refreshMock).toHaveBeenCalled();
    });

    it("a repost refused because the heads are not valid says so in plain words, and a non-admin 403 is plain too", async () => {
      const failed: AucRow = { ...UNDER_CONSTRUCTION, id: "77777777-7777-7777-7777-777777777777", projectCode: "AUC-777F", status: "capitalized", assetId: null, glPostStatus: "failed" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(code409("ASSET_GL_NOT_CONFIGURED"));
      render(<AucTable rows={[failed]} />, "hi");
      fireEvent.click(screen.getByRole("button", { name: /AUC-777F/ }));
      fireEvent.click(await screen.findByRole("button", { name: "पुनः भेजें" }));
      expect(await screen.findByText(/GL खाते अभी सेट नहीं हैं/)).toBeInTheDocument();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it("a capitalised project shows what finance did with its journal: pending / posted / not posted", () => {
      const cap = (n: number, glPostStatus: string): AucRow => ({ ...UNDER_CONSTRUCTION, id: `66666666-6666-6666-6666-66666666666${n}`, projectCode: `AUC-66${n}`, status: "capitalized", assetId: null, glPostStatus });
      render(<AucTable rows={[cap(1, "pending"), cap(2, "posted"), cap(3, "failed")]} />);
      expect(screen.getByText("Journal pending")).toBeInTheDocument();
      expect(screen.getByText("Journal posted")).toBeInTheDocument();
      const failed = screen.getByText("Journal not posted");
      expect(failed.className).toContain("bad");
    });
  });

  it("renders View asset as a client-side link with the asset href (GAP-ASSETS-PROJECTS-07)", () => {
    const CAP: AucRow = { ...UNDER_CONSTRUCTION, id: "22222222-2222-2222-2222-222222222222", projectCode: "AUC-009", status: "capitalized", assetId: "33333333-3333-3333-3333-333333333333" };
    render(<AucTable rows={[CAP]} />);
    const link = screen.getByRole("link", { name: "View capitalized asset for project AUC-009" });
    expect(link).toHaveAttribute("href", "/assets/33333333-3333-3333-3333-333333333333");
  });

  it("shows tone-mapped status pills for both lifecycle states (GAP-ASSETS-PROJECTS-06)", () => {
    const CAP: AucRow = { ...UNDER_CONSTRUCTION, id: "22222222-2222-2222-2222-222222222222", projectCode: "AUC-009", status: "capitalized", assetId: null };
    const { container } = render(<AucTable rows={[UNDER_CONSTRUCTION, CAP]} />);
    expect(container.querySelector(".pill.warn")?.textContent).toBe("Under Construction");
    expect(container.querySelector(".pill.good")?.textContent).toBe("Capitalized");
  });
});
