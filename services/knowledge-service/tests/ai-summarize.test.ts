/**
 * AI Document Summarization + PII Redaction tests.
 *
 * Covers:
 * - PII redaction: phone, Aadhaar, PAN, email stripped
 * - PII redaction: name replacement from context
 * - Summary generation with mocked LLM
 * - Document not found → 404
 * - Feature disabled → 404
 * - 400 on invalid documentId
 *
 * Validates: Requirements 20.4, 20.5, 20.7
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["knowledge_user"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

// ── PII Redaction Unit Tests ──────────────────────────────────────

describe("PII Redaction", () => {
  it("redacts phone numbers (10 digits)", async () => {
    const { redactPii } = await import("../src/modules/ai/pii-redact.js");
    const input = "Call me at 9876543210 for more details.";
    const { redactedText, redactions } = redactPii(input);
    expect(redactedText).toBe("Call me at [PHONE] for more details.");
    expect(redactions.phones).toBe(1);
    expect(redactedText).not.toContain("9876543210");
  });

  it("redacts Aadhaar numbers (12 digits with optional spaces)", async () => {
    const { redactPii } = await import("../src/modules/ai/pii-redact.js");

    // Without spaces
    const r1 = redactPii("Aadhaar: 123456789012");
    expect(r1.redactedText).toContain("[AADHAAR]");
    expect(r1.redactions.aadhaar).toBe(1);
    expect(r1.redactedText).not.toContain("123456789012");

    // With spaces (4-4-4)
    const r2 = redactPii("Aadhaar: 1234 5678 9012");
    expect(r2.redactedText).toContain("[AADHAAR]");
    expect(r2.redactions.aadhaar).toBe(1);
    expect(r2.redactedText).not.toContain("1234 5678 9012");
  });

  it("redacts PAN numbers (5 letters + 4 digits + 1 letter)", async () => {
    const { redactPii } = await import("../src/modules/ai/pii-redact.js");
    const input = "PAN: ABCDE1234F is registered.";
    const { redactedText, redactions } = redactPii(input);
    expect(redactedText).toBe("PAN: [PAN] is registered.");
    expect(redactions.pan).toBe(1);
    expect(redactedText).not.toContain("ABCDE1234F");
  });

  it("redacts email addresses", async () => {
    const { redactPii } = await import("../src/modules/ai/pii-redact.js");
    const input = "Send to john.doe@example.com for approval.";
    const { redactedText, redactions } = redactPii(input);
    expect(redactedText).toBe("Send to [EMAIL] for approval.");
    expect(redactions.emails).toBe(1);
    expect(redactedText).not.toContain("john.doe@example.com");
  });

  it("redacts names from context/metadata", async () => {
    const { redactPii } = await import("../src/modules/ai/pii-redact.js");
    const input = "Document prepared by Rajesh Kumar and reviewed by Priya Sharma.";
    const { redactedText, redactions } = redactPii(input, {
      names: ["Rajesh Kumar", "Priya Sharma"],
    });
    expect(redactedText).toBe("Document prepared by [NAME] and reviewed by [NAME].");
    expect(redactions.names).toBe(2);
    expect(redactedText).not.toContain("Rajesh Kumar");
    expect(redactedText).not.toContain("Priya Sharma");
  });

  it("redacts multiple PII types in a single document", async () => {
    const { redactPii } = await import("../src/modules/ai/pii-redact.js");
    const input = [
      "Subject: Transfer request",
      "From: Amit Verma (amit.verma@gov.in)",
      "Phone: 9988776655",
      "Aadhaar: 1234 5678 9012",
      "PAN: BCDPF1234G",
    ].join("\n");

    const { redactedText, redactions } = redactPii(input, {
      names: ["Amit Verma"],
    });

    expect(redactedText).not.toContain("Amit Verma");
    expect(redactedText).not.toContain("amit.verma@gov.in");
    expect(redactedText).not.toContain("9988776655");
    expect(redactedText).not.toContain("1234 5678 9012");
    expect(redactedText).not.toContain("BCDPF1234G");
    expect(redactions.phones).toBe(1);
    expect(redactions.aadhaar).toBe(1);
    expect(redactions.pan).toBe(1);
    expect(redactions.emails).toBe(1);
    expect(redactions.names).toBe(1);
  });

  it("returns text unchanged when no PII is present", async () => {
    const { redactPii } = await import("../src/modules/ai/pii-redact.js");
    const input = "This document contains no personal information.";
    const { redactedText, redactions } = redactPii(input);
    expect(redactedText).toBe(input);
    expect(redactions.phones).toBe(0);
    expect(redactions.aadhaar).toBe(0);
    expect(redactions.pan).toBe(0);
    expect(redactions.emails).toBe(0);
    expect(redactions.names).toBe(0);
  });
});

// ── Summarize Route Tests ─────────────────────────────────────────

describe("AI Summarize route — feature disabled", () => {
  it("POST /v1/knowledge/ai/summarize returns 404 when feature disabled", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/summarize",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ documentId: "aaaaaaaa-1111-4000-8000-000000000001" }),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("AI Summarize route — feature enabled", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("returns 400 for invalid documentId (not UUID)", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/summarize",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ documentId: "not-a-uuid" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when document does not exist", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/summarize",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ documentId: "aaaaaaaa-1111-4000-8000-000000000099" }),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 401 without auth token", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/summarize",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId: "aaaaaaaa-1111-4000-8000-000000000001" }),
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with summary when document exists (mocked DB + LLM)", async () => {
    vi.resetModules();

    // Mock the summarize module to avoid needing a real DB
    vi.doMock("../src/modules/ai/summarize.js", () => ({
      summarizeDocument: vi.fn().mockResolvedValue({
        documentId: "aaaaaaaa-1111-4000-8000-000000000001",
        summary: "This is a brief summary of the document content.",
      }),
      DocumentNotFoundError: class DocumentNotFoundError extends Error {
        constructor() { super("Document not found"); this.name = "DocumentNotFoundError"; }
      },
    }));

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/summarize",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ documentId: "aaaaaaaa-1111-4000-8000-000000000001" }),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.documentId).toBe("aaaaaaaa-1111-4000-8000-000000000001");
    expect(body.data.summary).toBeTruthy();
  });

  it("returns 503 when circuit breaker is open", async () => {
    vi.resetModules();

    const { CircuitBreakerOpenError } = await import("@civitasone/circuit-breaker");
    vi.doMock("../src/modules/ai/summarize.js", () => ({
      summarizeDocument: vi.fn().mockRejectedValue(new CircuitBreakerOpenError("anthropic-claude")),
      DocumentNotFoundError: class DocumentNotFoundError extends Error {
        constructor() { super("Document not found"); this.name = "DocumentNotFoundError"; }
      },
    }));

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/summarize",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ documentId: "aaaaaaaa-1111-4000-8000-000000000001" }),
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("CIRCUIT_OPEN");
  });
});
