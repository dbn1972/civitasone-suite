import { describe, it, expect, beforeAll } from "vitest";
import { presignedPutUrl, presignedGetUrl, resetClient } from "./index.js";

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
