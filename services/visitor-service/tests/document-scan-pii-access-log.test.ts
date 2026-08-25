/**
 * Tests for modules/document-scan/repo.ts — pii_access_log coverage.
 *
 * `logPiiAccess` (modules/dpdp/consent.ts) is this service's ONLY
 * mechanism for writing to visitor.pii_access_log. A repo-wide search
 * confirms it is called from exactly three files in the whole service:
 *   modules/blacklist/repo.ts
 *   modules/dpdp/consent.ts        (its own definition)
 *   modules/visit-request/repo.ts  (getVisitRequestById / listVisitRequests)
 *
 * `document-scan/repo.ts#getOcrResult` — which returns a visitor's
 * decrypted fullName, dateOfBirth, idDocumentNumber and address, the most
 * sensitive PII this service handles — is not among them, and neither is
 * `getScanSession`. Both are reachable over HTTP with no PII-access audit
 * trail at all:
 *   GET /v1/visitor/scans/:sessionId/result  (device auth) -> getOcrResult
 *   GET /v1/visitor/scans/:sessionId         (admin auth)  -> getScanSession
 *
 * This test proves the gap directly against the real repo.ts (only
 * `scopedRead`/`cache` are mocked — `logPiiAccess` is imported unmocked
 * from the real consent.ts and spied on) rather than re-deriving it from
 * the grep alone. The `it.fails()` block encodes the CORRECT behavior
 * (every PII read logs to pii_access_log) and fails today because the
 * call doesn't exist; flip it to a plain `it()` once repo.ts calls
 * `logPiiAccess` on this path.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_key: string, loader: () => unknown) => loader()),
    makeKey: vi.fn((...args: unknown[]) => args.join(":")),
  },
}));

const OCR_RESULT_ROW = {
  id: "ocr-1",
  tenantId: "tenant-1",
  scanSessionId: "session-1",
  fullName: "Jane Doe",
  dateOfBirth: "1990-01-01",
  idDocumentNumber: "123456789012",
  idDocumentType: "aadhaar",
  address: "1 Test Street",
  photoRegionKey: "face-crops/session-1.jpg",
  verificationStatus: "verified",
};

const SCAN_SESSION_ROW = {
  id: "session-1",
  tenantId: "tenant-1",
  deviceId: "device-1",
  status: "completed",
};

function scopedReadReturning(rows: unknown[]) {
  return vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => rows }),
        }),
      }),
    }),
  );
}

describe("document-scan/repo.ts — PII access logging", () => {
  it("getOcrResult returns the visitor's decrypted PII (sanity check for the test fixture itself)", async () => {
    vi.resetModules();
    vi.doMock("../src/shared/db.js", () => ({
      scopedRead: scopedReadReturning([OCR_RESULT_ROW]),
    }));
    const { getOcrResult } = await import("../src/modules/document-scan/repo.js");

    const result = await getOcrResult("tenant-1", "session-1");
    expect(result?.fullName).toBe("Jane Doe");
    expect(result?.idDocumentNumber).toBe("123456789012");
  });

  it(
    "[FIXED] getOcrResult reads Aadhaar-grade PII and now calls logPiiAccess",
    async () => {
      vi.resetModules();
      const logPiiAccessSpy = vi.fn(async () => undefined);
      vi.doMock("../src/shared/db.js", () => ({
        scopedRead: scopedReadReturning([OCR_RESULT_ROW]),
      }));
      vi.doMock("../src/modules/dpdp/consent.js", () => ({
        logPiiAccess: logPiiAccessSpy,
        logConsent: vi.fn(async () => undefined),
      }));
      const { getOcrResult } = await import("../src/modules/document-scan/repo.js");

      await getOcrResult("tenant-1", "session-1");

      // Correct behavior: reading a visitor's OCR-extracted PII should be
      // audited exactly like visit-request's detail_view read is. Today
      // repo.ts never imports or calls logPiiAccess at all.
      expect(logPiiAccessSpy).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "[FIXED] getScanSession also now calls logPiiAccess",
    async () => {
      vi.resetModules();
      const logPiiAccessSpy = vi.fn(async () => undefined);
      vi.doMock("../src/shared/db.js", () => ({
        scopedRead: scopedReadReturning([SCAN_SESSION_ROW]),
      }));
      vi.doMock("../src/modules/dpdp/consent.js", () => ({
        logPiiAccess: logPiiAccessSpy,
        logConsent: vi.fn(async () => undefined),
      }));
      const { getScanSession } = await import("../src/modules/document-scan/repo.js");

      await getScanSession("tenant-1", "session-1");

      expect(logPiiAccessSpy).toHaveBeenCalledTimes(1);
    },
  );
});
