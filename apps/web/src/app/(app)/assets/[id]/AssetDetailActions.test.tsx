import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssetDetailActions, printAssetTag } from "./AssetDetailActions";

const ASSET_ID = "44444444-4444-4444-4444-444444444444";
const WRITER = ["asset_manager"];

describe("AssetDetailActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("does not render once the asset is already disposed", () => {
    const { container } = render(<AssetDetailActions assetId={ASSET_ID} status="disposed" roles={WRITER} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("directly disposes the asset on confirm, bypassing the eOffice workflow (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "d1", status: "accepted" }), { status: 202 }),
    );

    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);

    fireEvent.change(screen.getByPlaceholderText("Proceeds (₹), leave blank for none"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));

    await waitFor(() => expect(screen.getByText("Directly dispose this asset?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for direct disposal"), { target: { value: "Committee write-off WO-12 approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispose asset" }));

    await waitFor(() => {
      expect(screen.getByText("Direct disposal submitted (workflow bypassed).")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/asset/assets/${ASSET_ID}/dispose`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.proceedsMinor).toBe(500000); // ₹5,000.00 -> paise, never Math.round(n*100) drift
    expect(body.currency).toBe("INR");
    expect(body.notes).toBe("Committee write-off WO-12 approved");
  });

  it("rejects an invalid direct-dispose proceeds amount before opening the confirm dialog", () => {
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByPlaceholderText("Proceeds (₹), leave blank for none"), { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));
    expect(
      screen.getByText("Enter a valid non-negative proceeds amount (₹) with at most 2 decimals, or leave blank."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Directly dispose this asset?")).not.toBeInTheDocument();
  });

  it("submits an inter-org transfer on confirm (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "t1", status: "accepted" }), { status: 202 }),
    );

    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);

    fireEvent.change(screen.getByPlaceholderText("From org unit"), { target: { value: "Dept of Health" } });
    fireEvent.change(screen.getByPlaceholderText("To org unit"), { target: { value: "Dept of Education" } });
    fireEvent.click(screen.getByRole("button", { name: "Inter-org transfer" }));

    await waitFor(() => expect(screen.getByText("Transfer this asset to another organisation?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Transfer to organisation" }));

    await waitFor(() => {
      expect(screen.getByText("Inter-organisation transfer submitted.")).toBeInTheDocument();
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/asset/assets/${ASSET_ID}/inter-org-transfer`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.fromOrg).toBe("Dept of Health");
    expect(body.toOrg).toBe("Dept of Education");
  });

  it("blocks the inter-org transfer until both org units are filled in", () => {
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.click(screen.getByRole("button", { name: "Inter-org transfer" }));
    expect(screen.getByText("Enter the originating org unit.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("From org unit")).toHaveFocus();
  });

  it("surfaces a server error on inter-org transfer failure (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ORG_NOT_FOUND", { status: 404 }));

    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByPlaceholderText("From org unit"), { target: { value: "Dept of Health" } });
    fireEvent.change(screen.getByPlaceholderText("To org unit"), { target: { value: "Dept of Education" } });
    fireEvent.click(screen.getByRole("button", { name: "Inter-org transfer" }));
    await waitFor(() => expect(screen.getByText("Transfer this asset to another organisation?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Transfer to organisation" }));

    await waitFor(() => {
      expect(screen.getByText(/We couldn't find this information\. It may have been removed or the link may be wrong\./)).toBeInTheDocument();
      expect(screen.queryByText(/ORG_NOT_FOUND/)).not.toBeInTheDocument();
    });
  });

  it("shows a formatted rupee amount (not raw input text) on the direct-dispose confirm dialog", async () => {
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByPlaceholderText("Proceeds (₹), leave blank for none"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));

    await waitFor(() => expect(screen.getByText("Directly dispose this asset?")).toBeInTheDocument());
    const dialog = screen.getByText("Directly dispose this asset?").closest(".cd-panel") as HTMLElement;
    expect(dialog).toHaveTextContent("₹5,000.00");
    expect(dialog).not.toHaveTextContent("₹5000");
  });

  it("accepts zero-valued proceeds spellings ('00.00', '0.000') as no-proceeds rather than a spurious validation error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "d2", status: "accepted" }), { status: 202 }),
    );

    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByPlaceholderText("Proceeds (₹), leave blank for none"), { target: { value: "00.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));

    // No validation error, dialog opens straight away.
    expect(screen.queryByText(/Enter a valid non-negative proceeds amount/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Directly dispose this asset?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for direct disposal"), { target: { value: "Committee write-off WO-12 approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispose asset" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.proceedsMinor).toBe(0);
  });

  it("still rejects a proceeds value with more than 2 significant decimal digits", () => {
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByPlaceholderText("Proceeds (₹), leave blank for none"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));
    expect(
      screen.getByText("Enter a valid non-negative proceeds amount (₹) with at most 2 decimals, or leave blank."),
    ).toBeInTheDocument();
  });

  // GAP-ASSETS-DETAIL-02
  it("renders no actions (so no Direct dispose) for a role without asset write rights", () => {
    const { container } = render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={["audit_officer"]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Direct dispose" })).not.toBeInTheDocument();
  });

  it("keeps Direct dispose Confirm disabled until a reason is entered", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));
    await waitFor(() => expect(screen.getByText("Directly dispose this asset?")).toBeInTheDocument());
    const confirm = screen.getByRole("button", { name: "Dispose asset" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason for direct disposal"), { target: { value: "Approved write-off" } });
    expect(screen.getByRole("button", { name: "Dispose asset" })).toBeEnabled();
  });

  it("surfaces a server 403 inside the direct-dispose dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("requires one of: asset_manager", { status: 403 }));
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));
    await waitFor(() => expect(screen.getByText("Directly dispose this asset?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for direct disposal"), { target: { value: "Approved write-off" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispose asset" }));
    await waitFor(() => expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument());
    expect(screen.queryByText("Direct disposal submitted (workflow bypassed).")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-DETAIL-03
  it("prints a hostile barcode as literal text, never as markup", () => {
    const popup = document.implementation.createHTMLDocument("popup");
    const fake = { document: popup, opener: {}, print: vi.fn(), focus: vi.fn() };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fake as unknown as Window);
    const payload = "<img src=x onerror=alert(1)>";
    printAssetTag(payload);
    expect(openSpy).toHaveBeenCalled();
    expect(popup.querySelector("img")).toBeNull();
    expect(popup.querySelector("h2")?.textContent).toBe(payload);
    // GAP-ASSETS-DETAIL-03: a real QR (svg path) is drawn, built from DOM nodes -- not parsed from text.
    expect(popup.querySelector("svg path")?.getAttribute("d")).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    expect(fake.opener).toBeNull();
    expect(fake.print).toHaveBeenCalled();
  });

  it("rejects a barcode containing markup characters before any request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AssetDetailActions assetId={ASSET_ID} status="active" roles={WRITER} />);
    fireEvent.change(screen.getByLabelText("Barcode / QR code"), { target: { value: "<b>AST-1</b>" } });
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    expect(screen.getByText(/Use letters, digits and - _ \/ \. only/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
