import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { AssetDetailActions, safeProceedsNumber } from "./AssetDetailActions";

const ASSET_ID = "44444444-4444-4444-4444-444444444444";
const WRITER = ["asset_manager"];
const ok = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
const bodyOf = (spy: ReturnType<typeof ok>, i = 0) => JSON.parse((spy.mock.calls[i]![1] as RequestInit).body as string);

describe("AssetDetailActions (ml-assets-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  // GAP-ASSETS-DETAIL-04
  it("Schedule AMC opens a dialog and POSTs nothing until it is confirmed", async () => {
    const spy = ok();
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule AMC" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Frequency"), { target: { value: "quarterly" } });
    fireEvent.change(within(dialog).getByLabelText("Vendor / description"), { target: { value: "AMC — Acme Services" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Schedule AMC" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toBe(`/api/proxy/v1/asset/assets/${ASSET_ID}/maintenance`);
    expect(bodyOf(spy)).toMatchObject({ frequency: "quarterly", description: "AMC — Acme Services" });
    expect(bodyOf(spy).nextDue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("cancelling the AMC dialog sends nothing", async () => {
    const spy = ok();
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule AMC" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(spy).not.toHaveBeenCalled();
  });

  // GAP-ASSETS-DETAIL-05
  it("renders nothing for a written-off asset", () => {
    const { container } = render(<AssetDetailActions assetId={ASSET_ID} status="written_off" roles={WRITER} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a condemned asset keeps tagging but offers no transfer, disposal or AMC", () => {
    render(<AssetDetailActions assetId={ASSET_ID} status="condemned" roles={WRITER} />);
    expect(screen.getByRole("button", { name: "Tag" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request disposal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Direct dispose" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transfer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule AMC" })).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting auction/)).toBeInTheDocument();
  });

  // GAP-ASSETS-DETAIL-06
  it("Request disposal sends the chosen method and puts the reason in `notes` (the field the service reads)", async () => {
    const spy = ok();
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByLabelText("Disposal method", { selector: "#asset-request-method" }), { target: { value: "scrap" } });
    fireEvent.change(screen.getByPlaceholderText("Disposal proceeds (₹), blank for none"), { target: { value: "1250.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Request disposal" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("₹1,250.50")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason for disposal"), { target: { value: "Beyond economical repair" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit disposal" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const body = bodyOf(spy);
    expect(body).toMatchObject({ disposalMethod: "scrap", proceedsMinor: 125050, notes: "Beyond economical repair" });
    expect(body).not.toHaveProperty("reason");
  });

  it("blocks Request disposal for '12.345' instead of silently sending 0", () => {
    const spy = ok();
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByPlaceholderText("Disposal proceeds (₹), blank for none"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Request disposal" }));
    expect(screen.getByText(/Enter a valid non-negative proceeds amount/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks a proceeds amount too large to send as an exact number", () => {
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByPlaceholderText("Disposal proceeds (₹), blank for none"), { target: { value: "99999999999999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Request disposal" }));
    expect(screen.getByText("That amount is too large to submit.")).toBeInTheDocument();
  });

  it("safeProceedsNumber never rounds", () => {
    expect(safeProceedsNumber("125050")).toBe(125050);
    expect(safeProceedsNumber("0")).toBe(0);
    expect(safeProceedsNumber("9007199254740993")).toBeNull();
    expect(safeProceedsNumber("9999999999999999900")).toBeNull();
  });
});
