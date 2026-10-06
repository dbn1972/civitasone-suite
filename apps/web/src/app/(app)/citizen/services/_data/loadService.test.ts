import { describe, expect, it } from "vitest";
import { classifyServiceLoad, type LoadServiceResult } from "./loadService";
import type { PublishedServiceRuntime } from "./runtimeApi";

// GAP-CITIZEN-SERVICES-SERVICEKEY-01: a transient gateway failure (5xx /
// network / missing base url) or an expired session must NOT be rendered as a
// 404 "service does not exist". classifyServiceLoad is the decision the two
// server pages branch on; these cases fail on the old `!service || source ===
// 'error' -> notFound()` behaviour.

const SERVICE: PublishedServiceRuntime = {
  id: "s1",
  serviceKey: "k",
  name: "Svc",
  servicePattern: "certificate",
  description: "",
  slaDays: null,
  channels: ["portal"],
  allowedApplicantTypes: ["citizen"],
  applicantTypeRejectMessage: null,
  requiredDocuments: [],
  feeFromMinor: null,
  feeCurrency: "INR",
  formDesign: null,
};

function r(partial: Partial<LoadServiceResult>): LoadServiceResult {
  return { service: null, source: "error", ...partial };
}

describe("classifyServiceLoad", () => {
  it("ok when a service is returned from the api", () => {
    expect(classifyServiceLoad(r({ service: SERVICE, source: "api" }))).toEqual({
      kind: "ok",
      service: SERVICE,
    });
  });

  it("503 is retryable 'unavailable', NOT not_found", () => {
    expect(classifyServiceLoad(r({ status: 503 }))).toEqual({ kind: "unavailable", status: 503 });
  });

  it("network/no-base-url error (no status) is 'unavailable', NOT not_found", () => {
    expect(classifyServiceLoad(r({}))).toEqual({ kind: "unavailable", status: undefined });
  });

  it("404 is not_found", () => {
    expect(classifyServiceLoad(r({ status: 404 }))).toEqual({ kind: "not_found" });
  });

  it("api source with no service (missing/invalid payload) is not_found", () => {
    expect(classifyServiceLoad(r({ source: "api", service: null }))).toEqual({ kind: "not_found" });
  });

  it("401 is unauthorized (redirect to login)", () => {
    expect(classifyServiceLoad(r({ status: 401 }))).toEqual({ kind: "unauthorized" });
  });

  it("403 is treated as not_found and NOT retryable", () => {
    expect(classifyServiceLoad(r({ status: 403 }))).toEqual({ kind: "not_found" });
  });
});
