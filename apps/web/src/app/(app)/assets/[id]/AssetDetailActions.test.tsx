import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssetDetailActions } from "./AssetDetailActions";

const ASSET_ID = "44444444-4444-4444-4444-444444444444";

describe("AssetDetailActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("does not render once the asset is already disposed", () => {
    const { container } = render(<AssetDetailActions assetId={ASSET_ID} status="disposed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("directly disposes the asset on confirm, bypassing the eOffice workflow (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "d1", status: "accepted" }), { status: 202 }),
    );

    render(<AssetDetailActions assetId={ASSET_ID} status="active" />);

    fireEvent.change(screen.getByPlaceholderText("Proceeds (₹), leave blank for none"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Direct dispose" }));

    await waitFor(() => expect(screen.getByText("Directly dispose this asset?")).toBeInTheDocument());
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
  });

  it("rejects an invalid direct-dispose proceeds amount before opening the confirm dialog", () => {
    render(<AssetDetailActions assetId={ASSET_ID} status="active" />);
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

    render(<AssetDetailActions assetId={ASSET_ID} status="active" />);

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
    render(<AssetDetailActions assetId={ASSET_ID} status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Inter-org transfer" }));
    expect(screen.getByText("Enter the originating org unit.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("From org unit")).toHaveFocus();
  });

  it("surfaces a server error on inter-org transfer failure (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ORG_NOT_FOUND", { status: 404 }));

    render(<AssetDetailActions assetId={ASSET_ID} status="active" />);
    fireEvent.change(screen.getByPlaceholderText("From org unit"), { target: { value: "Dept of Health" } });
    fireEvent.change(screen.getByPlaceholderText("To org unit"), { target: { value: "Dept of Education" } });
    fireEvent.click(screen.getByRole("button", { name: "Inter-org transfer" }));
    await waitFor(() => expect(screen.getByText("Transfer this asset to another organisation?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Transfer to organisation" }));

    await waitFor(() => {
      expect(screen.getByText("ORG_NOT_FOUND")).toBeInTheDocument();
    });
  });
});
