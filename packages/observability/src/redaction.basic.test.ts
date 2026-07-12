/**
 * Minimal unit tests for the redaction sanitizer (task 2.1), sufficient to
 * satisfy the package's ≥80% line-coverage requirement ahead of the detailed
 * property test planned for task 2.2 (redaction.property.test.ts).
 */
import { describe, expect, it } from "vitest";
import { redactLogPayload, redactReportPayload } from "./redaction.js";

describe("redactLogPayload", () => {
  it("strips credential-shaped and PII-shaped fields by key name", () => {
    const result = redactLogPayload({
      password: "s3cr3t",
      dsn: "postgres://user:pass@host:5432/db",
      email: "citizen@example.gov.in",
      aadhaar: "1234 5678 9012",
      tenantId: "tenant-1",
      correlationId: "corr-123",
    });

    expect(result.password).toBe("[REDACTED]");
    expect(result.dsn).toBe("[REDACTED]");
    expect(result.email).toBe("[REDACTED]");
    expect(result.aadhaar).toBe("[REDACTED]");
    expect(result.tenantId).toBe("tenant-1");
    expect(result.correlationId).toBe("corr-123");
  });

  it("generates a non-empty correlationId when missing", () => {
    const result = redactLogPayload({ message: "no id here" });
    expect(typeof result.correlationId).toBe("string");
    expect((result.correlationId as string).length).toBeGreaterThan(0);
  });

  it("generates a fresh correlationId when the input value is empty", () => {
    const result = redactLogPayload({ correlationId: "   " });
    expect((result.correlationId as string).trim().length).toBeGreaterThan(0);
  });

  it("redacts credential- and PII-shaped patterns embedded in free-text string values", () => {
    const result = redactLogPayload({
      errorMessage: "connection failed: postgres://svc:hunter2@db.internal:5432/civitas",
      note: "contact citizen@example.gov.in for follow-up, aadhaar 1234 5678 9012 on file",
      correlationId: "corr-1",
    });

    expect(result.errorMessage).not.toContain("hunter2");
    expect(result.note).not.toContain("citizen@example.gov.in");
    expect(result.note).not.toContain("1234 5678 9012");
  });

  it("recurses into nested objects and arrays", () => {
    const result = redactLogPayload({
      correlationId: "corr-1",
      context: {
        service: "install-service",
        secrets: { token: "abc123", apiKey: "xyz" },
        rows: [{ email: "a@b.com" }, { email: "c@d.com" }],
      },
    });

    const context = result.context as Record<string, unknown>;
    const secrets = context.secrets as Record<string, unknown>;
    const rows = context.rows as Array<Record<string, unknown>>;

    expect(secrets.token).toBe("[REDACTED]");
    expect(secrets.apiKey).toBe("[REDACTED]");
    expect(rows[0]?.email).toBe("[REDACTED]");
    expect(rows[1]?.email).toBe("[REDACTED]");
    expect(context.service).toBe("install-service");
  });

  it("leaves Date values untouched", () => {
    const now = new Date();
    const result = redactLogPayload({ correlationId: "corr-1", createdAt: now });
    expect(result.createdAt).toBe(now);
  });
});

describe("redactReportPayload", () => {
  it("strips only credential-shaped fields, preserving PII fields untouched", () => {
    const result = redactReportPayload({
      password: "s3cr3t",
      dsn: "postgres://user:pass@host:5432/db",
      email: "citizen@example.gov.in",
      aadhaar: "1234 5678 9012",
      tenantId: "tenant-1",
    });

    expect(result.password).toBe("[REDACTED]");
    expect(result.dsn).toBe("[REDACTED]");
    // PII is deliberately preserved in report mode (Req 13.4).
    expect(result.email).toBe("citizen@example.gov.in");
    expect(result.aadhaar).toBe("1234 5678 9012");
    expect(result.tenantId).toBe("tenant-1");
  });

  it("does not add or require a correlationId", () => {
    const result = redactReportPayload({ tableCount: 12 });
    expect(result.correlationId).toBeUndefined();
    expect(result.tableCount).toBe(12);
  });

  it("recurses into nested objects and arrays, redacting credentials only", () => {
    const result = redactReportPayload({
      sampleRows: [{ email: "a@b.com", secret: "shh" }],
      runner: { dsn: "postgres://u:p@h:5432/db" },
    });

    const sampleRows = result.sampleRows as Array<Record<string, unknown>>;
    const runner = result.runner as Record<string, unknown>;

    expect(sampleRows[0]?.email).toBe("a@b.com");
    expect(sampleRows[0]?.secret).toBe("[REDACTED]");
    expect(runner.dsn).toBe("[REDACTED]");
  });

  it("leaves Date values untouched", () => {
    const now = new Date();
    const result = redactReportPayload({ ranAt: now });
    expect(result.ranAt).toBe(now);
  });
});
