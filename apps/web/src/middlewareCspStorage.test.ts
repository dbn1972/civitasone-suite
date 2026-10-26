/**
 * V4-A-02: pages upload straight to object storage with a presigned PUT, a
 * cross-origin fetch that connect-src 'self' blocks. The storage origin (from
 * env, same pattern as the Keycloak origin) must be allow-listed in connect-src,
 * and nothing broader than that origin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const ENV_KEYS = ["NEXT_PUBLIC_STORAGE_ORIGIN", "AWS_ENDPOINT_URL", "AWS_S3_BUCKET", "AWS_DEFAULT_REGION", "NEXT_PUBLIC_KEYCLOAK_ISSUER_URL"];

async function connectSrc(env: Record<string, string>): Promise<string> {
  for (const k of ENV_KEYS) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  const { middleware } = await import("./middleware");
  const csp = middleware(new NextRequest(new URL("https://demo.test/auth/login"))).headers.get("Content-Security-Policy") ?? "";
  return csp.split("; ").find((d) => d.startsWith("connect-src")) ?? "";
}

describe("middleware CSP connect-src storage origin (V4-A-02)", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("allows the configured browser-facing storage origin (path stripped)", async () => {
    const d = await connectSrc({ NEXT_PUBLIC_STORAGE_ORIGIN: "https://files.example.gov.in/civitasone" });
    expect(d).toBe("connect-src 'self' https://files.example.gov.in");
  });

  it("falls back to AWS_ENDPOINT_URL (LocalStack / S3-compatible endpoint)", async () => {
    const d = await connectSrc({ AWS_ENDPOINT_URL: "http://localhost:4566" });
    expect(d).toBe("connect-src 'self' http://localhost:4566");
  });

  it("derives the virtual-hosted AWS S3 origin from bucket + region when no endpoint is set", async () => {
    const d = await connectSrc({ AWS_S3_BUCKET: "civ-docs", AWS_DEFAULT_REGION: "ap-south-1" });
    expect(d).toBe("connect-src 'self' https://civ-docs.s3.ap-south-1.amazonaws.com");
  });

  it("keeps both the Keycloak and storage origins", async () => {
    const d = await connectSrc({ NEXT_PUBLIC_KEYCLOAK_ISSUER_URL: "https://sso.example.gov.in/realms/c", NEXT_PUBLIC_STORAGE_ORIGIN: "https://files.example.gov.in" });
    expect(d).toBe("connect-src 'self' https://sso.example.gov.in https://files.example.gov.in");
  });

  it("stays 'self' only when nothing is configured and never adds wildcards or junk", async () => {
    expect(await connectSrc({})).toBe("connect-src 'self'");
    expect(await connectSrc({ NEXT_PUBLIC_STORAGE_ORIGIN: "javascript:alert(1)" })).toBe("connect-src 'self'");
    expect(await connectSrc({ NEXT_PUBLIC_STORAGE_ORIGIN: "not a url; script-src *" })).toBe("connect-src 'self'");
  });
});
