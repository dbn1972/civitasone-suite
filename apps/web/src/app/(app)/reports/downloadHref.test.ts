import { describe, it, expect } from "vitest";
import { reportDownloadHref } from "./downloadHref";

describe("reportDownloadHref (GAP-REPORTS-LIST-04)", () => {
  it("maps the authorising download path onto the same-origin proxy", () => {
    expect(reportDownloadHref("/v1/reports/jobs/job-1/download")).toBe("/api/proxy/v1/reports/jobs/job-1/download");
  });
  it("refuses absolute bearer URLs and foreign paths", () => {
    expect(reportDownloadHref("https://s3.example/x.pdf?X-Amz-Signature=abc")).toBeNull();
    expect(reportDownloadHref("//evil.example/v1/reports/jobs/a/download")).toBeNull();
    expect(reportDownloadHref("/v1/admin/users")).toBeNull();
    expect(reportDownloadHref("/v1/reports/jobs/../x/download")).toBeNull();
  });
  it("returns null for empty values", () => {
    expect(reportDownloadHref(null)).toBeNull();
    expect(reportDownloadHref(undefined)).toBeNull();
    expect(reportDownloadHref("")).toBeNull();
  });
});
