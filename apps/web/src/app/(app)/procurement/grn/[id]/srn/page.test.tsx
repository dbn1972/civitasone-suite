import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";

// Server component: resolve namespaced keys against the real en messages.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => createTranslator({ locale: "en", messages: en as never, namespace: ns as never }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getSrnByGrn = vi.fn();
const getProcurementGRNById = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({
  getSrnByGrn: (...a: unknown[]) => getSrnByGrn(...a),
  getProcurementGRNById: (...a: unknown[]) => getProcurementGRNById(...a),
}));

import SrnDetailPage from "./page";

const draftSrn = { id: "s1", grnId: "g1", status: "draft", storeOfficerId: "—", receivedAt: null, remarks: null };

describe("SrnDetailPage (GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-01)", () => {
  beforeEach(() => {
    getSrnByGrn.mockReset();
    getProcurementGRNById.mockReset();
    getProcurementGRNById.mockResolvedValue({ data: { grnNo: "GRN/2026/1", vendor: "Acme" }, source: "api" });
  });

  it("shows the 'saved as Draft - signing failed' banner when ?signFailed=1 and the SRN is still a draft", async () => {
    getSrnByGrn.mockResolvedValue({ data: draftSrn, source: "api", status: 200 });
    render(await SrnDetailPage({ params: { id: "g1" }, searchParams: { signFailed: "1" } }));
    expect(screen.getByRole("alert")).toHaveTextContent(/saved as Draft/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/sign/i);
  });

  it("shows no banner without the flag", async () => {
    getSrnByGrn.mockResolvedValue({ data: draftSrn, source: "api", status: 200 });
    render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no banner when the SRN is already signed, even with the flag", async () => {
    getSrnByGrn.mockResolvedValue({ data: { ...draftSrn, status: "signed", receivedAt: "2026-10-01" }, source: "api", status: 200 });
    render(await SrnDetailPage({ params: { id: "g1" }, searchParams: { signFailed: "1" } }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // GAP-PROCUREMENT-GRN-DETAIL-SRN-01 - an outage must not read as "no SRN yet".
  it("SRN-01: a failed SRN fetch shows a retryable error and NO 'Create SRN' link", async () => {
    getSrnByGrn.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.queryByRole("link", { name: "Create SRN" })).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("SRN-01: a genuine 'no SRN' (api null, or 404) shows the empty state with Create SRN", async () => {
    getSrnByGrn.mockResolvedValue({ data: null, source: "api", status: 200 });
    const first = render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.getByRole("link", { name: "Create SRN" })).toHaveAttribute("href", "/procurement/grn/g1/srn/new");
    first.unmount();
    getSrnByGrn.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.getByRole("link", { name: "Create SRN" })).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-GRN-DETAIL-SRN-02 - a name, never a bare UUID; a draft has no received date yet.
  it("SRN-02: shows the store officer's name when supplied, else a short hint - never the raw UUID", async () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    getSrnByGrn.mockResolvedValue({ data: { ...draftSrn, storeOfficerId: uuid, storeOfficerName: "A. Officer" }, source: "api", status: 200 });
    const first = render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.getByText("A. Officer")).toBeInTheDocument();
    first.unmount();
    getSrnByGrn.mockResolvedValue({ data: { ...draftSrn, storeOfficerId: uuid }, source: "api", status: 200 });
    render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.queryByText(uuid)).toBeNull();
    expect(screen.getByText("Officer (…555555)")).toBeInTheDocument();
  });

  it("SRN-02: a draft SRN reads 'Pending - set on signing' for the received date", async () => {
    getSrnByGrn.mockResolvedValue({ data: draftSrn, source: "api", status: 200 });
    render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.getByText(/Pending — set on signing/)).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-GRN-DETAIL-SRN-04 - the GRN number links back to the GRN.
  it("SRN-04: the GRN number links back to the GRN detail", async () => {
    getSrnByGrn.mockResolvedValue({ data: draftSrn, source: "api", status: 200 });
    render(await SrnDetailPage({ params: { id: "g1" } }));
    expect(screen.getByRole("link", { name: "GRN/2026/1" })).toHaveAttribute("href", "/procurement/grn/g1");
  });
});
