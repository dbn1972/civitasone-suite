import { describe, it, expect } from "vitest";
import { redactLogPayload as redact } from "./redaction.js";

describe("DSN redaction pattern (CodeQL alert 938)", () => {
  it("still redacts scheme://user:pass@host DSNs", () => {
    const out = JSON.stringify(redact({ msg: "connect postgres://svc:hunter2@db.internal:5432/app failed" }));
    expect(out).not.toContain("hunter2");
  });

  it("is linear on a long run of ':' with no '@'", () => {
    const evil = "a://" + ":".repeat(100_000);
    const t0 = Date.now();
    redact({ msg: evil });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
