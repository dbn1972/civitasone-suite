/**
 * Document Intelligence tests — POST /v1/contract/documents/:id/extract
 *
 * Covers:
 *   - Happy path: mock LLM response, verify extraction output shape
 *   - PII redaction: verify PII is stripped before reaching LLM
 *   - 503 when circuit breaker is open
 *   - 413 for oversized documents
 *   - Feature flag disabled → 503 ML_UNAVAILABLE
 *   - 404 when document not found
 *   - 422 when document has no text content
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mock setup ─────────────────────────────────────────────

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ACTOR_ID = "00000000-0000-0000-0000-000000000002";
const DOC_ID = "00000000-0000-0000-0000-000000000099";

function makeToken() {
  return {
    sub: ACTOR_ID,
    tid: TENANT_ID,
    roles: ["legal_officer"],
    sid: "sess-1",
  };
}

const MOCK_LLM_RESPONSE = JSON.stringify({
  clauses: [
    { type: "indemnity", text: "Party A shall indemnify Party B against all losses.", confidence: 0.92 },
    { type: "termination", text: "Either party may terminate with 30 days notice.", confidence: 0.88 },
    { type: "confidentiality", text: "All information shared shall remain confidential for 5 years.", confidence: 0.95 },
  ],
  obligations: [
    {
      description: "Party A must deliver reports quarterly",
      responsibleParty: "Party A",
      deadline: "2025-03-31",
      confidence: 0.85,
    },
  ],
  deadlines: [
    {
      description: "Quarterly report submission",
      date: "2025-03-31",
      responsibleParty: "Party A",
      confidence: 0.85,
    },
  ],
  courtOrderMetadata: {
    partyNames: ["State of Karnataka", "ABC Corp"],
    orderDate: "2024-11-15",
    nextHearingDate: "2025-01-20",
    directives: ["Submit compliance report", "Deposit security amount"],
  },
});

describe("POST /v1/contract/documents/:id/extract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function buildTestApp() {
    const { signToken } = await import("@civitasone/auth");
    const SECRET = "test_secret_for_civitasone_32chr";
    const token = signToken(makeToken(), SECRET, 3600);

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    return { app, token };
  }

  // ── Happy Path ────────────────────────────────────────────────

  it("extracts clauses, obligations, and deadlines from a document (happy path)", async () => {
    // Mock document queries to return a document with text
    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn().mockResolvedValue({
        id: DOC_ID,
        tenantId: TENANT_ID,
        matterId: "00000000-0000-0000-0000-000000000010",
        name: "Contract.pdf",
        type: "file",
        body: "This is a contract between Party A and Party B. Party A shall indemnify Party B.",
        legalHold: false,
        depth: 0,
        version: 1,
      }),
    }));

    // Mock the adapter to return a successful LLM response
    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn().mockResolvedValue(MOCK_LLM_RESPONSE),
      isEnabled: vi.fn().mockReturnValue(true),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError: class extends Error {
        constructor(name: string) { super(`Circuit breaker ${name} is open`); this.name = "CircuitBreakerOpenError"; }
      },
    }));

    const { app, token } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.clauses).toHaveLength(3);
    expect(body.data.clauses[0].type).toBe("indemnity");
    expect(body.data.clauses[0].confidence).toBeGreaterThan(0);
    expect(body.data.clauses[0].confidence).toBeLessThanOrEqual(1);
    expect(body.data.obligations).toHaveLength(1);
    expect(body.data.obligations[0].responsibleParty).toBe("Party A");
    expect(body.data.deadlines).toHaveLength(1);
    expect(body.data.deadlines[0].date).toBe("2025-03-31");
    expect(body.data.courtOrderMetadata).toBeDefined();
    expect(body.data.courtOrderMetadata.partyNames).toContain("State of Karnataka");
    expect(body.data.courtOrderMetadata.directives).toHaveLength(2);

    await app.close();
  });

  // ── PII Redaction ─────────────────────────────────────────────

  it("applies PII redaction before sending text to LLM", async () => {
    const capturedPrompt: string[] = [];

    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn().mockResolvedValue({
        id: DOC_ID,
        tenantId: TENANT_ID,
        matterId: "00000000-0000-0000-0000-000000000010",
        name: "Contract.pdf",
        type: "file",
        body: "Contact John at john@example.com or 9876543210. PAN: ABCDE1234F, Aadhaar: 1234 5678 9012",
        legalHold: false,
        depth: 0,
        version: 1,
      }),
    }));

    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn().mockImplementation((_system: string, userMsg: string) => {
        capturedPrompt.push(userMsg);
        return Promise.resolve(JSON.stringify({ clauses: [], obligations: [], deadlines: [] }));
      }),
      isEnabled: vi.fn().mockReturnValue(true),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError: class extends Error {
        constructor(name: string) { super(`Circuit breaker ${name} is open`); this.name = "CircuitBreakerOpenError"; }
      },
    }));

    const { app, token } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedPrompt.length).toBeGreaterThan(0);

    const sentText = capturedPrompt[0];
    // PII should be redacted
    expect(sentText).not.toContain("john@example.com");
    expect(sentText).not.toContain("9876543210");
    expect(sentText).not.toContain("ABCDE1234F");
    expect(sentText).not.toContain("1234 5678 9012");
    // Placeholders should be present
    expect(sentText).toContain("[EMAIL]");
    expect(sentText).toContain("[PHONE]");
    expect(sentText).toContain("[PAN]");
    expect(sentText).toContain("[AADHAAR]");

    await app.close();
  });

  // ── Circuit Breaker Open → 503 ────────────────────────────────

  it("returns 503 ML_UNAVAILABLE when circuit breaker is open", async () => {
    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn().mockResolvedValue({
        id: DOC_ID,
        tenantId: TENANT_ID,
        matterId: "00000000-0000-0000-0000-000000000010",
        name: "Contract.pdf",
        type: "file",
        body: "Some contract text here for analysis.",
        legalHold: false,
        depth: 0,
        version: 1,
      }),
    }));

    const { CircuitBreakerOpenError } = await import("@civitasone/circuit-breaker");

    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn().mockRejectedValue(new CircuitBreakerOpenError("legal-intelligence-anthropic")),
      isEnabled: vi.fn().mockReturnValue(true),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError,
    }));

    const { app, token } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("ML_UNAVAILABLE");

    await app.close();
  });

  // ── Feature Flag Disabled → 503 ──────────────────────────────

  it("returns 503 ML_UNAVAILABLE when FEATURE_ML_ENABLED is not true", async () => {
    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn().mockResolvedValue({
        id: DOC_ID,
        tenantId: TENANT_ID,
        matterId: "00000000-0000-0000-0000-000000000010",
        name: "Contract.pdf",
        type: "file",
        body: "Some text",
        legalHold: false,
        depth: 0,
        version: 1,
      }),
    }));

    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(false),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError: class extends Error {
        constructor(name: string) { super(`Circuit breaker ${name} is open`); this.name = "CircuitBreakerOpenError"; }
      },
    }));

    const { app, token } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("ML_UNAVAILABLE");

    await app.close();
  });

  // ── 413 for Large Documents ───────────────────────────────────

  it("returns 413 DOCUMENT_TOO_LARGE when document text exceeds 100KB", async () => {
    const largeText = "x".repeat(101 * 1024); // 101KB — exceeds 100KB limit

    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn().mockResolvedValue({
        id: DOC_ID,
        tenantId: TENANT_ID,
        matterId: "00000000-0000-0000-0000-000000000010",
        name: "LargeContract.pdf",
        type: "file",
        body: largeText,
        legalHold: false,
        depth: 0,
        version: 1,
      }),
    }));

    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError: class extends Error {
        constructor(name: string) { super(`Circuit breaker ${name} is open`); this.name = "CircuitBreakerOpenError"; }
      },
    }));

    const { app, token } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(413);
    const body = res.json();
    expect(body.error.code).toBe("DOCUMENT_TOO_LARGE");

    await app.close();
  });

  // ── 404 Document Not Found ────────────────────────────────────

  it("returns 404 when document does not exist", async () => {
    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn().mockResolvedValue(null),
    }));

    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError: class extends Error {
        constructor(name: string) { super(`Circuit breaker ${name} is open`); this.name = "CircuitBreakerOpenError"; }
      },
    }));

    const { app, token } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");

    await app.close();
  });

  // ── 422 No Extractable Content ────────────────────────────────

  it("returns 422 when document has no text body", async () => {
    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn().mockResolvedValue({
        id: DOC_ID,
        tenantId: TENANT_ID,
        matterId: "00000000-0000-0000-0000-000000000010",
        name: "EmptyDoc.pdf",
        type: "file",
        body: null,
        legalHold: false,
        depth: 0,
        version: 1,
      }),
    }));

    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError: class extends Error {
        constructor(name: string) { super(`Circuit breaker ${name} is open`); this.name = "CircuitBreakerOpenError"; }
      },
    }));

    const { app, token } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("NO_CONTENT");

    await app.close();
  });

  // ── 401 Unauthenticated ───────────────────────────────────────

  it("returns 401 when no auth token is provided", async () => {
    vi.doMock("../src/modules/documents/queries.js", () => ({
      getDocument: vi.fn(),
    }));

    vi.doMock("../src/modules/intelligence/adapter.js", () => ({
      sendPrompt: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
      LlmAdapterError: class extends Error {
        constructor(msg: string, public code: string) { super(msg); this.name = "LlmAdapterError"; }
      },
      CircuitBreakerOpenError: class extends Error {
        constructor(name: string) { super(`Circuit breaker ${name} is open`); this.name = "CircuitBreakerOpenError"; }
      },
    }));

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/documents/${DOC_ID}/extract`,
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── Domain Unit Tests (parseExtractionResponse) ─────────────────

describe("parseExtractionResponse", () => {
  let parseExtractionResponse: typeof import("../src/modules/intelligence/domain.js").parseExtractionResponse;

  beforeEach(async () => {
    const mod = await import("../src/modules/intelligence/domain.js");
    parseExtractionResponse = mod.parseExtractionResponse;
  });

  it("parses a valid JSON response with clauses, obligations, and deadlines", () => {
    const result = parseExtractionResponse(MOCK_LLM_RESPONSE);

    expect(result.clauses).toHaveLength(3);
    expect(result.clauses[0].type).toBe("indemnity");
    expect(result.clauses[1].type).toBe("termination");
    expect(result.clauses[2].type).toBe("confidentiality");
    expect(result.obligations).toHaveLength(1);
    expect(result.deadlines).toHaveLength(1);
    expect(result.courtOrderMetadata?.partyNames).toContain("State of Karnataka");
  });

  it("handles markdown-fenced JSON response", () => {
    const fenced = "```json\n" + MOCK_LLM_RESPONSE + "\n```";
    const result = parseExtractionResponse(fenced);
    expect(result.clauses).toHaveLength(3);
  });

  it("returns empty arrays for unparseable response", () => {
    const result = parseExtractionResponse("This is not valid JSON at all");
    expect(result.clauses).toEqual([]);
    expect(result.obligations).toEqual([]);
    expect(result.deadlines).toEqual([]);
  });

  it("filters out clauses with invalid types", () => {
    const response = JSON.stringify({
      clauses: [
        { type: "indemnity", text: "Valid clause", confidence: 0.9 },
        { type: "invalid_type", text: "Should be filtered", confidence: 0.8 },
      ],
      obligations: [],
      deadlines: [],
    });
    const result = parseExtractionResponse(response);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].type).toBe("indemnity");
  });

  it("clamps confidence values to [0, 1]", () => {
    const response = JSON.stringify({
      clauses: [
        { type: "payment", text: "Some clause", confidence: 1.5 },
        { type: "liability", text: "Another", confidence: -0.3 },
      ],
      obligations: [],
      deadlines: [],
    });
    const result = parseExtractionResponse(response);
    expect(result.clauses[0].confidence).toBe(1);
    expect(result.clauses[1].confidence).toBe(0);
  });

  it("omits courtOrderMetadata when no party names are present", () => {
    const response = JSON.stringify({
      clauses: [],
      obligations: [],
      deadlines: [],
      courtOrderMetadata: { partyNames: [], orderDate: null, nextHearingDate: null, directives: [] },
    });
    const result = parseExtractionResponse(response);
    expect(result.courtOrderMetadata).toBeUndefined();
  });
});

// ── PII Redaction Unit Tests ────────────────────────────────────

describe("redactPii", () => {
  let redactPii: typeof import("../src/modules/intelligence/pii-redact.js").redactPii;

  beforeEach(async () => {
    const mod = await import("../src/modules/intelligence/pii-redact.js");
    redactPii = mod.redactPii;
  });

  it("redacts email addresses", () => {
    const { redactedText, redactions } = redactPii("Contact: john.doe@example.com for details");
    expect(redactedText).toContain("[EMAIL]");
    expect(redactedText).not.toContain("john.doe@example.com");
    expect(redactions.emails).toBe(1);
  });

  it("redacts phone numbers (10 digits)", () => {
    const { redactedText, redactions } = redactPii("Call 9876543210 for help");
    expect(redactedText).toContain("[PHONE]");
    expect(redactedText).not.toContain("9876543210");
    expect(redactions.phones).toBe(1);
  });

  it("redacts Aadhaar numbers (12 digits, space-separated)", () => {
    const { redactedText, redactions } = redactPii("Aadhaar: 1234 5678 9012");
    expect(redactedText).toContain("[AADHAAR]");
    expect(redactedText).not.toContain("1234 5678 9012");
    expect(redactions.aadhaar).toBe(1);
  });

  it("redacts PAN numbers", () => {
    const { redactedText, redactions } = redactPii("PAN: ABCDE1234F");
    expect(redactedText).toContain("[PAN]");
    expect(redactedText).not.toContain("ABCDE1234F");
    expect(redactions.pan).toBe(1);
  });

  it("redacts named entities from options", () => {
    const { redactedText, redactions } = redactPii(
      "Mr. Rajesh Kumar filed the complaint against ABC Corp",
      { names: ["Rajesh Kumar", "ABC Corp"] },
    );
    expect(redactedText).not.toContain("Rajesh Kumar");
    expect(redactedText).not.toContain("ABC Corp");
    expect(redactions.names).toBe(2);
  });

  it("handles text with no PII", () => {
    const { redactedText, redactions } = redactPii("This is a simple contract clause.");
    expect(redactedText).toBe("This is a simple contract clause.");
    expect(redactions.phones).toBe(0);
    expect(redactions.aadhaar).toBe(0);
    expect(redactions.pan).toBe(0);
    expect(redactions.emails).toBe(0);
    expect(redactions.names).toBe(0);
  });

  it("handles multiple PII types in one text", () => {
    const text = "Email: test@x.com, Phone: 9876543210, PAN: ABCDE1234F";
    const { redactions } = redactPii(text);
    expect(redactions.emails).toBe(1);
    expect(redactions.phones).toBe(1);
    expect(redactions.pan).toBe(1);
  });
});
