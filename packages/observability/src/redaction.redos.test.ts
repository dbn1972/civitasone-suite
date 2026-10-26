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

  it("redacts a DSN whose username contains '@' (no password leak)", () => {
    const out = JSON.stringify(redact({ msg: "pg://us@er:pw123@h/db failed" }));
    expect(out).not.toContain("pw123");
    expect(out).toContain("[REDACTED_DSN]");
  });

  it("redacts a DSN whose password contains '@' and ':'", () => {
    const out = JSON.stringify(redact({ msg: "redis://u:p@ss:w0rd@cache.internal:6379" }));
    expect(out).not.toContain("w0rd");
  });

  it("leaves credential-free URLs untouched", () => {
    const out = JSON.stringify(redact({ msg: "see https://host.example:8080/path?x=1" }));
    expect(out).toContain("https://host.example:8080/path?x=1");
  });

  it("is linear on a long dotted scheme-like run with no '://'", () => {
    const evil = "a.".repeat(20_000);
    const t0 = Date.now();
    redact({ msg: evil });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
