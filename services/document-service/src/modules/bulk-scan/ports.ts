/**
 * Injectable I/O seams for the pipeline: object store, malware scanner, OCR. Production defaults wrap
 * @civitasone/storage, the ClamAV endpoint of @civitasone/scanner (strict, see scan-strict.ts) and @civitasone/ocr; tests swap fakes with setPorts().
 * The OCR adapter is loaded lazily so the HTTP process never imports tesseract/pdf libraries.
 */
import {
  presignedPutUrl, presignedGetUrl, headObject, getObject, putObject, deleteObject,
} from "@civitasone/storage";
import { scanStrict } from "./scan-strict.js";
import type { OcrPipelinePort } from "./ocr-port.js";

export interface BlobStore {
  head(key: string): Promise<{ size: number | null; contentType: string | null } | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  del(key: string): Promise<void>;
  presignPut(o: { key: string; contentType: string; contentLength: number; expiresIn: number }): Promise<{ url: string; headers: Record<string, string> }>;
  /** Short-lived private GET URL (downloads, review page images). */
  presignGet(o: { key: string; expiresIn: number }): Promise<string>;
}

/**
 * Filing into the document module. Implemented OUTSIDE bulk-scan (src/modules/files/filing-adapter.ts) and
 * injected by the composition root (worker.ts) so bulk-scan never imports the files module's repo/schema.
 * Both calls run inside the caller's transaction and are idempotent (deterministic ids).
 */
export interface FilingInput {
  tenantId: string;
  documentId: string;
  actorId: string;
  folderId: string | null;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  tags: string[];
  originalKey: string;
  searchablePdfKey: string | null;
  textKey: string | null;
  structuredJsonKey: string | null;
}
export interface FilingPort {
  /** Create document.files + file_versions rows. Returns false when the document already exists (redelivery). */
  create(tx: unknown, input: FilingInput): Promise<boolean>;
  /** Soft-delete the document (retention). Returns false when it was already deleted / missing. */
  markDeleted(tx: unknown, a: { tenantId: string; documentId: string; actorId: string }): Promise<boolean>;
}

export type ScanVerdict = "clean" | "infected" | "error";
export interface ScannerPort {
  scan(buffer: Buffer, filename: string): Promise<ScanVerdict>;
}

export interface BulkScanPorts {
  store: BlobStore;
  scanner: ScannerPort;
  ocr: OcrPipelinePort;
  filing: FilingPort;
  now(): Date;
  random(): number;
}

const SSE = process.env.BULK_SCAN_S3_SSE === "aws:kms" ? "aws:kms" : process.env.BULK_SCAN_S3_SSE === "AES256" ? "AES256" : undefined;

const defaultStore: BlobStore = {
  async head(key) {
    const h = await headObject(key);
    return h ? { size: h.contentLength, contentType: h.contentType } : null;
  },
  get: (key) => getObject(key),
  put: (key, body, contentType) => putObject(key, body, contentType),
  del: (key) => deleteObject(key),
  presignGet: ({ key, expiresIn }) => presignedGetUrl({ key, expiresIn }),
  async presignPut({ key, contentType, contentLength, expiresIn }) {
    const url = await presignedPutUrl({ key, contentType, contentLength, expiresIn, ...(SSE ? { serverSideEncryption: SSE } : {}) });
    return { url, headers: { "Content-Type": contentType, ...(SSE ? { "x-amz-server-side-encryption": SSE } : {}) } };
  },
};

/** Positive-clean verification (fail closed): only an explicit clean body is "clean"; anything else is "error" (-> scan_pending). */
const defaultScanner: ScannerPort = {
  scan: (buffer, filename) => scanStrict(buffer, filename),
};

const lazyOcr: OcrPipelinePort = {
  async run(input) {
    const { createOcrAdapter } = await import("./ocr-adapter.js");
    return createOcrAdapter().run(input);
  },
};

const unconfiguredFiling: FilingPort = {
  create: () => { throw new Error("FILING_PORT_NOT_CONFIGURED: inject the document filing adapter with setPorts({ filing })"); },
  markDeleted: () => { throw new Error("FILING_PORT_NOT_CONFIGURED: inject the document filing adapter with setPorts({ filing })"); },
};

let overrides: Partial<BulkScanPorts> = {};

export function getPorts(): BulkScanPorts {
  return {
    store: overrides.store ?? defaultStore,
    scanner: overrides.scanner ?? defaultScanner,
    ocr: overrides.ocr ?? lazyOcr,
    filing: overrides.filing ?? unconfiguredFiling,
    now: overrides.now ?? ((): Date => new Date()),
    random: overrides.random ?? ((): number => Math.random()),
  };
}

export function setPorts(p: Partial<BulkScanPorts>): void { overrides = { ...overrides, ...p }; }
export function resetPorts(): void { overrides = {}; }
