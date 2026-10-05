import { describe, it, expect } from "vitest";
import { isAllowedUploadUrl } from "./uploadUrl";

describe("isAllowedUploadUrl", () => {
  it("always accepts https", () => {
    expect(isAllowedUploadUrl("https://s3.example.com/b/k?sig=1", { development: false })).toBe(true);
  });
  it("outside development rejects plain http elsewhere, but allows loopback hosts", () => {
    expect(isAllowedUploadUrl("http://s3.example.com/b/k", { development: false })).toBe(false);
    expect(isAllowedUploadUrl("http://localhost:9000/b/k", { development: false })).toBe(true);
    expect(isAllowedUploadUrl("http://127.0.0.1:9000/b/k", { development: false })).toBe(true);
    expect(isAllowedUploadUrl("http://[::1]:9000/b/k", { development: false })).toBe(true);
    expect(isAllowedUploadUrl("http://localhost.evil.example/b/k", { development: false })).toBe(false);
  });
  it("in development / test builds http is allowed", () => {
    expect(isAllowedUploadUrl("http://minio.internal/b/k", { development: true })).toBe(true);
  });
  it("never accepts other schemes or garbage", () => {
    for (const u of ["javascript:alert(1)", "ftp://x/y", "//evil.example/x", "not a url", "", "data:text/plain,hi"]) expect(isAllowedUploadUrl(u, { development: true })).toBe(false);
  });
});
