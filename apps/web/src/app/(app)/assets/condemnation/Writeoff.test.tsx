import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderIntl } from "../testIntl";
import { WriteoffApproveCard } from "./WriteoffApproveCard";
import { WriteoffRequestCard } from "../[id]/WriteoffRequestCard";
import { canApproveWriteoff, writeoffErrorKey } from "./writeoffApi";

const REF = "3f2b6c1e-8a4d-4c1b-9e57-2d6f0a9b1c34";
const ASSET = "22222222-2222-4222-8222-222222222222";

describe("write-off request / approve (UAT W4)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("approver gate mirrors WRITEOFF_APPROVER_ROLES (asset_manager may request but not approve)", () => {
    expect(canApproveWriteoff(["asset_manager"])).toBe(false);
    expect(canApproveWriteoff(["asset_admin"])).toBe(true);
    expect(canApproveWriteoff(["finance_officer"])).toBe(true);
    expect(writeoffErrorKey(403, "SELF_APPROVAL_FORBIDDEN")).toBe("selfApproval");
    expect(writeoffErrorKey(409, "CONFLICT")).toBe("alreadyDecided");
  });

  it("request: confirms, POSTs writeoff-request, and shows the reference", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: REF, status: "accepted" }), { status: 202 }));
    renderIntl(<WriteoffRequestCard assetId={ASSET} assetCode="AST-0142" />);
    fireEvent.click(screen.getByRole("button", { name: "Request write-off" }));
    await screen.findByRole("alertdialog");
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Request write-off" }).at(-1)!);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain(`v1/asset/assets/${ASSET}/writeoff-request`);
    expect(spy.mock.calls[0]![1]!.method).toBe("POST");
    expect(await screen.findByText(new RegExp(REF))).toBeInTheDocument();
  });

  it("approve: rejects a malformed reference before any call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    renderIntl(<WriteoffApproveCard />);
    fireEvent.change(screen.getByLabelText(/Write-off request reference/), { target: { value: "WO-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
    expect(await screen.findByText(/Enter the full reference/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("approve: maker is refused by the service (403 SELF_APPROVAL_FORBIDDEN) and nothing is faked", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN", message: "x" }), { status: 403 }));
    renderIntl(<WriteoffApproveCard />);
    fireEvent.change(screen.getByLabelText(/Write-off request reference/), { target: { value: REF } });
    fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
    await screen.findByRole("alertdialog");
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve write-off" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain(`v1/asset/writeoff-requests/${REF}/approve`);
    expect(await screen.findByText(/you cannot approve it/)).toBeInTheDocument();
    expect(screen.queryByText(/Approval for/)).toBeNull();
  });

  it("approve: success is reported as submitted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: REF, status: "accepted" }), { status: 202 }));
    renderIntl(<WriteoffApproveCard />);
    fireEvent.change(screen.getByLabelText(/Write-off request reference/), { target: { value: REF } });
    fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Approve write-off" }));
    expect(await screen.findByText(/Approval for .* submitted/)).toBeInTheDocument();
  });
});
