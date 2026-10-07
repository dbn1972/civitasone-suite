import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LoaderResult } from "@/app/_data/apiClient";
import type { DesignerServiceDetail } from "../_data/designerLoader";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

const getByIdMock = vi.fn();
vi.mock("../_data/designerLoader", () => ({
  getDesignerServiceById: (...a: unknown[]) => getByIdMock(...a),
}));

import DesignerServiceEntry from "./page";

function result(
  data: DesignerServiceDetail | null,
  source: "api" | "error",
): LoaderResult<DesignerServiceDetail | null> {
  return { data, source };
}

const detail = (status: string): DesignerServiceDetail => ({
  id: "svc1",
  serviceKey: "k",
  name: "Svc",
  status,
  servicePattern: "certificate",
});

describe("DesignerServiceEntry (GAP-DESIGNER-HOME-02 status-aware redirect)", () => {
  beforeEach(() => {
    mockRedirect.mockReset();
    getByIdMock.mockReset();
  });

  it("redirects a published service to the read-only review view", async () => {
    getByIdMock.mockResolvedValue(result(detail("published"), "api"));
    await DesignerServiceEntry({ params: { id: "svc1" }, searchParams: {} });
    expect(mockRedirect).toHaveBeenCalledWith("/designer/svc1/review");
  });

  it("redirects an in_review service to the review view", async () => {
    getByIdMock.mockResolvedValue(result(detail("in_review"), "api"));
    await DesignerServiceEntry({ params: { id: "svc1" }, searchParams: {} });
    expect(mockRedirect).toHaveBeenCalledWith("/designer/svc1/review");
  });

  it("redirects a submitted service to the review view", async () => {
    getByIdMock.mockResolvedValue(result(detail("submitted"), "api"));
    await DesignerServiceEntry({ params: { id: "svc1" }, searchParams: {} });
    expect(mockRedirect).toHaveBeenCalledWith("/designer/svc1/review");
  });

  it("redirects a draft service to the b1 wizard", async () => {
    getByIdMock.mockResolvedValue(result(detail("draft"), "api"));
    await DesignerServiceEntry({ params: { id: "svc1" }, searchParams: {} });
    expect(mockRedirect).toHaveBeenCalledWith("/designer/svc1/b1");
  });

  it("redirects a rejected service to the b1 wizard (editable)", async () => {
    getByIdMock.mockResolvedValue(result(detail("rejected"), "api"));
    await DesignerServiceEntry({ params: { id: "svc1" }, searchParams: {} });
    expect(mockRedirect).toHaveBeenCalledWith("/designer/svc1/b1");
  });

  it("fails closed to the b1 wizard when the status load errors", async () => {
    getByIdMock.mockResolvedValue(result(null, "error"));
    await DesignerServiceEntry({ params: { id: "svc1" }, searchParams: {} });
    expect(mockRedirect).toHaveBeenCalledWith("/designer/svc1/b1");
  });

  it("preserves query string on redirect", async () => {
    getByIdMock.mockResolvedValue(result(detail("published"), "api"));
    await DesignerServiceEntry({
      params: { id: "svc1" },
      searchParams: { pattern: "certificate" },
    });
    expect(mockRedirect).toHaveBeenCalledWith("/designer/svc1/review?pattern=certificate");
  });
});
