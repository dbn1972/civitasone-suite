import { describe, it, expect, afterEach } from "vitest";
import { GET } from "./route";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("GET /.well-known/security.txt (RFC 9116)", () => {
  it("returns 200 text/plain with Contact and a future Expires", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");

    const body = await res.text();
    expect(body).toMatch(/^Contact: mailto:.+@.+/m);
    const expiresLine = body.split("\n").find((l) => l.startsWith("Expires:"));
    expect(expiresLine).toBeDefined();
    const expires = new Date(expiresLine!.replace("Expires:", "").trim());
    expect(expires.getTime()).toBeGreaterThan(Date.now());
  });

  it("includes Policy and Canonical when a site URL is configured", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://civitasone.app";
    const body = await GET().text();
    expect(body).toContain("Policy: https://civitasone.app/contact");
    expect(body).toContain("Canonical: https://civitasone.app/.well-known/security.txt");
  });

  it("omits absolute-URL fields when no site URL is configured", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const body = await GET().text();
    expect(body).not.toContain("Policy:");
    expect(body).not.toContain("Canonical:");
    // Contact + Expires are still present.
    expect(body).toContain("Contact: mailto:");
    expect(body).toContain("Expires:");
  });
});
