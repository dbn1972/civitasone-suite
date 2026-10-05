/**
 * Server-side loaders for Admin > Bulk scan (GAP-ADMIN-BULK-SCAN-02). All go through the gateway to document-service
 * (/api/v1/documents/bulk-scan). A failed load is `source: "error"` with empty data: never an "empty list".
 */
import { fetchJson, type LoaderResult } from "./apiClient";
import {
  mapBatch, mapBatches, mapBatchFiles, mapLinks, mapProfiles, mapProviders, mapReviewDetail, mapReviewQueue, mapSearch, mapSettings,
} from "@/lib/bulkScan/mappers";
import { qs } from "@/lib/bulkScan/api";
import type {
  BatchFileView, BatchView, LinkRow, Paged, ProfileRow, ProviderInfo, ReviewDetail, ReviewQueueItem, SearchHit, SettingsPayload,
} from "@/lib/bulkScan/types";

const B = "/api/v1/documents/bulk-scan";
const emptyPaged = <T,>(): Paged<T> => ({ items: [], page: { hasMore: false, pageSize: 0, total: null } });

export function getBulkScanBatches(opts: { status?: string; limit?: number; offset?: number } = {}): Promise<LoaderResult<Paged<BatchView>>> {
  return fetchJson<unknown, Paged<BatchView>>(`${B}/batches${qs({ status: opts.status, limit: opts.limit ?? 50, offset: opts.offset })}`, emptyPaged(), {
    telemetryKey: "bulk-scan.batches", mapResponse: mapBatches,
  });
}

export function getBulkScanBatch(id: string): Promise<LoaderResult<BatchView | null>> {
  return fetchJson<unknown, BatchView | null>(`${B}/batches/${encodeURIComponent(id)}`, null, {
    telemetryKey: "bulk-scan.batch", mapResponse: (p) => mapBatch(p),
  });
}

export function getBulkScanBatchFiles(id: string, opts: { state?: string; limit?: number; offset?: number } = {}): Promise<LoaderResult<Paged<BatchFileView>>> {
  return fetchJson<unknown, Paged<BatchFileView>>(`${B}/batches/${encodeURIComponent(id)}/files${qs({ state: opts.state, limit: opts.limit ?? 200, offset: opts.offset })}`, emptyPaged(), {
    telemetryKey: "bulk-scan.batch-files", mapResponse: mapBatchFiles,
  });
}

export function getBulkScanReviewQueue(opts: { limit?: number; offset?: number; reason?: string } = {}): Promise<LoaderResult<Paged<ReviewQueueItem>>> {
  return fetchJson<unknown, Paged<ReviewQueueItem>>(`${B}/review-queue${qs({ limit: opts.limit ?? 100, offset: opts.offset, reason: opts.reason })}`, emptyPaged(), {
    telemetryKey: "bulk-scan.review-queue", mapResponse: mapReviewQueue,
  });
}

export function getBulkScanReview(batchId: string, fileId: string): Promise<LoaderResult<ReviewDetail | null>> {
  return fetchJson<unknown, ReviewDetail | null>(`${B}/batches/${encodeURIComponent(batchId)}/files/${encodeURIComponent(fileId)}/review`, null, {
    telemetryKey: "bulk-scan.review", mapResponse: mapReviewDetail,
  });
}

export function getBulkScanLinks(state: string, opts: { limit?: number; offset?: number } = {}): Promise<LoaderResult<Paged<LinkRow>>> {
  return fetchJson<unknown, Paged<LinkRow>>(`${B}/links${qs({ state, limit: opts.limit ?? 100, offset: opts.offset })}`, emptyPaged(), {
    telemetryKey: "bulk-scan.links", mapResponse: mapLinks,
  });
}

export function getBulkScanSettings(): Promise<LoaderResult<SettingsPayload | null>> {
  return fetchJson<unknown, SettingsPayload | null>(`${B}/settings`, null, { telemetryKey: "bulk-scan.settings", mapResponse: (p) => mapSettings(p) });
}

export function getBulkScanProfiles(): Promise<LoaderResult<ProfileRow[]>> {
  return fetchJson<unknown, ProfileRow[]>(`${B}/profiles`, [], { telemetryKey: "bulk-scan.profiles", mapResponse: mapProfiles });
}

export function getBulkScanProviders(): Promise<LoaderResult<ProviderInfo[]>> {
  return fetchJson<unknown, ProviderInfo[]>(`${B}/providers`, [], { telemetryKey: "bulk-scan.providers", mapResponse: mapProviders });
}

export function getBulkScanSearch(q: string, docType?: string, opts: { limit?: number; offset?: number } = {}): Promise<LoaderResult<Paged<SearchHit>>> {
  return fetchJson<unknown, Paged<SearchHit>>(`${B}/search${qs({ q, docType, limit: opts.limit ?? 25, offset: opts.offset })}`, emptyPaged(), {
    telemetryKey: "bulk-scan.search", mapResponse: mapSearch,
  });
}
