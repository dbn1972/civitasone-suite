import { describe, it, expect, afterEach } from "vitest";
import { careersPrivacyPolicyUrl } from "./consent";

afterEach(() => { delete process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL; });

describe("careersPrivacyPolicyUrl", () => {
  const url = (v: string) => { process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL = v; return careersPrivacyPolicyUrl(); };
  it("accepts https and same-origin paths", () => {
    expect(url("https://example.gov.in/privacy")).toBe("https://example.gov.in/privacy");
    expect(url("/privacy")).toBe("/privacy");
  });
  it("rejects protocol-relative //host and other schemes", () => {
    expect(url("//evil.example/x")).toBeNull();
    expect(url("javascript:alert(1)")).toBeNull();
  });
});
