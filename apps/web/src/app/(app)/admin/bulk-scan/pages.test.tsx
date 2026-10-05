import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import enMessages from "@/messages/en.json";
import { reviewDetail, settingsObject } from "@/lib/bulkScan/fixtures";

const { roles, loaders } = vi.hoisted(() => ({
  roles: { current: [] as string[] },
  loaders: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current, getSessionUserId: () => "me", getSessionTenantId: () => "t1", requireAnyRole: vi.fn() }));
vi.mock("@/app/_data/bulkScanLoaders", () => {
  const paged = { data: { items: [], page: { hasMore: false, pageSize: 0, total: null } }, source: "api" };
  for (const n of ["getBulkScanBatches", "getBulkScanBatchFiles", "getBulkScanReviewQueue", "getBulkScanLinks", "getBulkScanSearch"]) loaders[n] = vi.fn(async () => paged);
  loaders.getBulkScanBatch = vi.fn(async () => ({ data: null, source: "error", status: 404 }));
  loaders.getBulkScanReview = vi.fn(async () => ({ data: null, source: "error", status: 404 }));
  loaders.getBulkScanSettings = vi.fn(async () => ({ data: { settings: {}, version: 1, degraded: false, pendingRequests: [] }, source: "api" }));
  loaders.getBulkScanProfiles = vi.fn(async () => ({ data: [], source: "api" }));
  loaders.getBulkScanProviders = vi.fn(async () => ({ data: [], source: "api" }));
  return { ...loaders };
});
vi.mock("@/app/(app)/documents/_data/loaders", () => ({ getDocumentFolders: vi.fn(async () => ({ data: [], source: "api" })) }));

import ListPage from "./page";
import NewPage from "./new/page";
import DetailPage from "./[batchId]/page";
import QueuePage from "./review/page";
import ReviewPage from "./review/[batchId]/[fileId]/page";
import LinksPage from "./links/page";
import SettingsPage from "./settings/page";
import ProfilesPage from "./profiles/page";
import SearchPage from "./search/page";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const PAGES: Array<[string, () => Promise<ReactElement>]> = [
  ["list", () => ListPage()],
  ["new", () => NewPage({})],
  ["detail", () => DetailPage({ params: { batchId: UUID } })],
  ["queue", () => QueuePage()],
  ["review", () => ReviewPage({ params: { batchId: UUID, fileId: UUID } })],
  ["links", () => LinksPage({})],
  ["settings", () => SettingsPage()],
  ["profiles", () => ProfilesPage()],
  ["search", () => SearchPage()],
];
const intl = (el: ReactElement) => render(<NextIntlClientProvider locale="en" messages={enMessages}>{el}</NextIntlClientProvider>);

describe("bulk scan page role gates", () => {
  beforeEach(() => { for (const fn of Object.values(loaders)) fn.mockClear(); });

  it.each(PAGES)("%s: a caller without document_admin / super_admin sees Access restricted and no loader runs", async (_n, page) => {
    for (const r of [["employee"], ["tenant_admin"], ["hr_admin"], ["platform_admin"], []]) {
      roles.current = r;
      const { unmount } = intl(await page());
      expect(screen.getByText("Access restricted")).toBeInTheDocument();
      for (const fn of Object.values(loaders)) expect(fn).not.toHaveBeenCalled();
      unmount();
    }
  });

  it.each(["document_admin", "super_admin"])("%s gets the list page and its loader runs", async (role) => {
    roles.current = [role];
    intl(await ListPage());
    expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bulk scan" })).toBeInTheDocument();
    expect(loaders.getBulkScanBatches).toHaveBeenCalled();
  });

  it("an unknown link state in the URL falls back to awaiting approval", async () => {
    roles.current = ["document_admin"];
    intl(await LinksPage({ searchParams: { state: "../../etc" } }));
    expect(loaders.getBulkScanLinks).toHaveBeenCalledWith("awaiting_approval");
  });

  it("resume mode only trusts a real uuid in ?batch=", async () => {
    roles.current = ["document_admin"];
    await NewPage({ searchParams: { batch: "not-a-uuid" } });
    expect(loaders.getBulkScanBatch).not.toHaveBeenCalled();
    loaders.getBulkScanBatch!.mockResolvedValueOnce({ data: null, source: "error", status: 404 });
    await NewPage({ searchParams: { batch: UUID } });
    expect(loaders.getBulkScanBatch).toHaveBeenCalledWith(UUID);
  });

  it("the review page distinguishes not found from a load error", async () => {
    roles.current = ["document_admin"];
    const a = intl(await ReviewPage({ params: { batchId: UUID, fileId: UUID } }));
    expect(screen.getByText("File not found")).toBeInTheDocument();
    a.unmount();
    loaders.getBulkScanReview!.mockResolvedValueOnce({ data: null, source: "error", status: 500 });
    intl(await ReviewPage({ params: { batchId: UUID, fileId: UUID } }));
    expect(screen.queryByText("File not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("a failed queue or awaiting-links load is passed on as an error, never rendered as an empty queue", async () => {
    roles.current = ["document_admin"];
    loaders.getBulkScanReview!.mockResolvedValueOnce({ data: reviewDetail(), source: "api" });
    loaders.getBulkScanReviewQueue!.mockResolvedValueOnce({ data: { items: [], page: { hasMore: false, pageSize: 200, total: 0 } }, source: "error", status: 500 });
    loaders.getBulkScanLinks!.mockResolvedValueOnce({ data: { items: [], page: { hasMore: false, pageSize: 200, total: 0 } }, source: "error", status: 500 });
    loaders.getBulkScanSettings!.mockResolvedValueOnce({ data: { settings: settingsObject(), version: 1, degraded: false, pendingRequests: [] }, source: "api" });
    const el = (await ReviewPage({ params: { batchId: UUID, fileId: "f1" } })) as ReactElement<{ queueFailed: boolean; awaitingFailed: boolean }>;
    expect(el.props.queueFailed).toBe(true);
    expect(el.props.awaitingFailed).toBe(true);
  });

  it("the review workspace is keyed by file so the next file never inherits the previous draft", async () => {
    roles.current = ["document_admin"];
    loaders.getBulkScanReview!.mockResolvedValueOnce({ data: reviewDetail(), source: "api" });
    loaders.getBulkScanSettings!.mockResolvedValueOnce({ data: { settings: settingsObject(), version: 1, degraded: false, pendingRequests: [] }, source: "api" });
    const el = await ReviewPage({ params: { batchId: UUID, fileId: "f1" } });
    expect((el as ReactElement).key).toBe("f1");
  });
});
