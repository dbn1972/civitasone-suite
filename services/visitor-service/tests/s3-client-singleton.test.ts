/** V4-F-03 regression: document-scan must share one S3Client for the process lifetime. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ctor = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => {
    ctor();
    return { send: vi.fn(), destroy: vi.fn() };
  }),
}));

import { getS3Client, resetS3ClientForTests } from "../src/shared/s3-client.js";

function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("visitor-service S3 client (V4-F-03)", () => {
  beforeEach(async () => {
    await resetS3ClientForTests();
    ctor.mockClear();
  });

  it("returns the same client and constructs it once, even concurrently", async () => {
    const [a, b] = await Promise.all([getS3Client(), getS3Client()]);
    const c = await getS3Client();
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it("no other source file constructs an S3Client directly", () => {
    const offenders = walk(join(__dirname, "../src"))
      .filter((f) => !f.endsWith(join("shared", "s3-client.ts")))
      .filter((f) => /new\s+S3Client\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
