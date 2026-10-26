import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { presignedPutUrl, presignedGetUrl, headObject, objectExists, resetClient } from "./index.js";

// Set test env before importing
beforeAll(() => {
  process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
  process.env.AWS_DEFAULT_REGION = "ap-south-1";
  process.env.AWS_S3_BUCKET = "civitasone-test";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  resetClient();
});

describe("@civitasone/storage presigned URLs", () => {
  it("presignedPutUrl includes X-Amz-Signature", async () => {
    const url = await presignedPutUrl({
      key: "uploads/tenant-1/resume/test.pdf",
      contentType: "application/pdf",
      expiresIn: 300,
    });
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Credential=");
    expect(url).toContain("civitasone-test");
    expect(url).toContain("uploads/tenant-1/resume/test.pdf");
  });

  it("presignedGetUrl includes X-Amz-Signature", async () => {
    const url = await presignedGetUrl({
      key: "reports/tenant-1/report-123.pdf",
      expiresIn: 3600,
    });
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Credential=");
    expect(url).toContain("reports/tenant-1/report-123.pdf");
  });

  it("presignedPutUrl uses configured endpoint", async () => {
    const url = await presignedPutUrl({
      key: "test/file.txt",
      contentType: "text/plain",
    });
    expect(url).toContain("localhost:4566");
  });

  it("no unsigned URL path remains (all URLs carry auth params)", async () => {
    const putUrl = await presignedPutUrl({ key: "a.txt", contentType: "text/plain" });
    const getUrl = await presignedGetUrl({ key: "a.txt" });
    // Neither URL is a bare endpoint/bucket/key without auth
    expect(putUrl).not.toMatch(/^http:\/\/localhost:4566\/civitasone-test\/a\.txt$/);
    expect(getUrl).not.toMatch(/^http:\/\/localhost:4566\/civitasone-test\/a\.txt$/);
  });
});

describe("presignedPutUrl contentLength (GAP-PAYROLL-REIMBURSEMENTS-03)", () => {
  it("signs content-length into the URL when given, so a body of another size is refused by the store", async () => {
    const url = await presignedPutUrl({ key: "r/a.pdf", contentType: "application/pdf", contentLength: 2048 });
    expect(decodeURIComponent(url)).toMatch(/X-Amz-SignedHeaders=[^&]*content-length/i);
  });

  it("does not sign content-length when the caller gives none (other callers unchanged)", async () => {
    const url = await presignedPutUrl({ key: "r/b.pdf", contentType: "application/pdf" });
    expect(decodeURIComponent(url)).not.toMatch(/X-Amz-SignedHeaders=[^&]*content-length/i);
  });

  it("headObject rejects (does not report 'missing') when the store cannot be reached", async () => {
    process.env.AWS_ENDPOINT_URL = "http://127.0.0.1:1"; // nothing listens here
    resetClient();
    await expect(headObject("does/not/exist.pdf")).rejects.toBeDefined();
    process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
    resetClient();
  });
});

/** CLOS2-S6-06: only a genuine not-found means "absent"; every other failure propagates. */
describe("objectExists / headObject error discrimination (CLOS2-S6-06)", () => {
  const fail = (e: Record<string, unknown>) =>
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(Object.assign(new Error("boom"), e) as never);
  afterEach(() => vi.restoreAllMocks());

  it("a 403 AccessDenied rejects instead of looking like a missing object", async () => {
    fail({ name: "Forbidden", $metadata: { httpStatusCode: 403 } });
    await expect(objectExists("k")).rejects.toThrow();
    await expect(headObject("k")).rejects.toThrow();
  });

  it("a 5xx rejects", async () => {
    fail({ name: "InternalError", $metadata: { httpStatusCode: 503 } });
    await expect(objectExists("k")).rejects.toThrow();
    await expect(headObject("k")).rejects.toThrow();
  });

  it("a NotFound / 404 / NoSuchKey is still false / null", async () => {
    for (const e of [{ name: "NotFound" }, { name: "NoSuchKey" }, { name: "Unknown", $metadata: { httpStatusCode: 404 } }]) {
      fail(e);
      expect(await objectExists("k")).toBe(false);
      expect(await headObject("k")).toBeNull();
      vi.restoreAllMocks();
    }
  });

  it("an existing object is still true / its metadata", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ ContentLength: 5, ContentType: "application/pdf" } as never);
    expect(await objectExists("k")).toBe(true);
    expect(await headObject("k")).toEqual({ contentLength: 5, contentType: "application/pdf" });
  });
});

describe("presignedPutUrl serverSideEncryption (GAP-PAYROLL-TAX-DECLARATION-02)", () => {
  it("signs the SSE header into the URL when asked", async () => {
    const url = await presignedPutUrl({ key: "p/a.pdf", contentType: "application/pdf", serverSideEncryption: "AES256" });
    // Signed as a header (not hoisted): the uploader must send it, so an upload
    // that omits it fails the signature check instead of landing unencrypted.
    expect(decodeURIComponent(url)).toMatch(/X-Amz-SignedHeaders=[^&]*x-amz-server-side-encryption/i);
  });

  it("does not request encryption when the caller does not", async () => {
    const url = await presignedPutUrl({ key: "p/b.pdf", contentType: "application/pdf" });
    expect(decodeURIComponent(url)).not.toMatch(/x-amz-server-side-encryption/i);
  });
});

describe("presignedPutUrl signContentType (V4-E-05)", () => {
  it("does not sign content-type unless asked (existing callers unchanged)", async () => {
    const url = await presignedPutUrl({ key: "r/a.pdf", contentType: "application/pdf" });
    expect(decodeURIComponent(url)).not.toMatch(/X-Amz-SignedHeaders=[^&]*content-type/i);
  });
  it("signs content-type into the URL when asked, so the store refuses any other Content-Type", async () => {
    const url = await presignedPutUrl({ key: "r/a.pdf", contentType: "application/pdf", signContentType: true });
    expect(decodeURIComponent(url)).toMatch(/X-Amz-SignedHeaders=[^&]*content-type/i);
  });
});
