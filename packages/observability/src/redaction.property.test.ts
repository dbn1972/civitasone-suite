/**
 * Property-based tests for the redaction sanitizer (task 2.2).
 *
 * **Property 9: Structured-log and report redaction is total and policy-consistent**
 * **Validates: Requirements 3.5, 4.4, 13.1, 13.4, 15.4**
 *
 * For arbitrary nested structured-log/report-shaped objects (including
 * credential-shaped fields like password/dsn/token, PII-shaped fields like
 * email/aadhaar, and arbitrary nesting via objects/arrays):
 *
 *   - `redactLogPayload` is total (never throws) and always returns a
 *     non-empty `correlationId` (Req 15.4).
 *   - `redactLogPayload` always strips both credential-shaped AND PII-shaped
 *     fields (Req 15.4, 3.5, 4.4).
 *   - `redactReportPayload` is total (never throws) (Req 13.1).
 *   - `redactReportPayload` strips ONLY credential-shaped fields, never
 *     PII-shaped fields — policy-consistency: the two functions differ only
 *     in PII handling (Req 13.4).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { redactLogPayload, redactReportPayload } from "./redaction.js";

const REDACTED = "[REDACTED]";

/** Field names known to be credential-shaped (see redaction.ts's CREDENTIAL_KEYS). */
const CREDENTIAL_KEYS = [
  "password",
  "passwd",
  "pwd",
  "dsn",
  "connectionString",
  "databaseUrl",
  "secret",
  "secretKey",
  "clientSecret",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "privateKey",
  "accessKey",
  "awsSecretAccessKey",
] as const;

/** Field names known to be PII-shaped (see redaction.ts's PII_KEYS). */
const PII_KEYS = [
  "email",
  "aadhaar",
  "aadhaarNumber",
  "pan",
  "phone",
  "phoneNumber",
  "mobile",
  "bankAccount",
  "bankAccountNumber",
  "ifsc",
] as const;

const arbCredentialKey = fc.constantFrom(...CREDENTIAL_KEYS);
const arbPiiKey = fc.constantFrom(...PII_KEYS);

/** Arbitrary "safe" (non-credential, non-PII) field name for filler leaves. */
const arbSafeKey = fc.constantFrom(
  "tenantId",
  "correlationId",
  "service",
  "message",
  "outcome",
  "durationMs",
  "step",
  "runId",
  "status",
);

/** Arbitrary primitive leaf value (never a credential/PII-shaped string pattern). */
const arbSafeLeaf = fc.oneof(
  fc.string({ maxLength: 20 }).filter((s) => !/@/.test(s) && !/\d{4}\s?\d{4}\s?\d{4}/.test(s)),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);

/**
 * Recursive arbitrary structured-log/report-shaped object, with injected
 * credential/PII keys. Credential- and PII-shaped fields are always assigned
 * a primitive leaf value (matching their real-world shape — a password or
 * email is a string, never a container) so the redaction policy's effect on
 * them is unambiguous, while "safe" fields may recurse into further nested
 * objects/arrays that themselves contain credential/PII-shaped fields at any
 * depth — this is where the "arbitrary nesting" comes from.
 */
function arbNestedPayload(depth: number): fc.Arbitrary<Record<string, unknown>> {
  const leaf = fc.oneof(arbSafeLeaf, fc.array(arbSafeLeaf, { maxLength: 3 }));

  const safeValue: fc.Arbitrary<unknown> =
    depth > 0
      ? fc.oneof(
          { weight: 2, arbitrary: leaf },
          { weight: 1, arbitrary: fc.oneof(arbNestedPayload(depth - 1), fc.array(arbNestedPayload(depth - 1), { maxLength: 2 })) },
        )
      : leaf;

  const safeDict = fc.dictionary(arbSafeKey, safeValue, { minKeys: 0, maxKeys: 3 });
  const credDict = fc.dictionary(arbCredentialKey, leaf, { minKeys: 0, maxKeys: 2 });
  const piiDict = fc.dictionary(arbPiiKey, leaf, { minKeys: 0, maxKeys: 2 });

  return fc.tuple(safeDict, credDict, piiDict).map(([a, b, c]) => ({ ...a, ...b, ...c }));
}

const arbPayload = arbNestedPayload(2);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Recursively collect every (key, value) pair reachable in a plain object/array structure. */
function collectEntries(value: unknown, acc: Array<[string, unknown]> = []): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    for (const item of value) collectEntries(item, acc);
    return acc;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      acc.push([key, val]);
      collectEntries(val, acc);
    }
  }
  return acc;
}

describe("Property 9: redaction is total and policy-consistent", () => {
  it("redactLogPayload never throws and always returns a non-empty correlationId", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        let result: Record<string, unknown> | undefined;
        expect(() => {
          result = redactLogPayload(payload);
        }).not.toThrow();

        expect(typeof result!.correlationId).toBe("string");
        expect((result!.correlationId as string).trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("redactLogPayload strips every credential-shaped and PII-shaped key-named field", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const result = redactLogPayload(payload);
        const entries = collectEntries(result);

        for (const [key, value] of entries) {
          const normalized = normalizeKey(key);
          const isCredential = CREDENTIAL_KEYS.some((k) => normalizeKey(k) === normalized);
          const isPii = PII_KEYS.some((k) => normalizeKey(k) === normalized);
          if (isCredential || isPii) {
            expect(value).toBe(REDACTED);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("redactReportPayload never throws", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        expect(() => redactReportPayload(payload)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("redactReportPayload strips ONLY credential-shaped key-named fields, never PII-shaped ones", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const originalEntries = collectEntries(payload);
        const result = redactReportPayload(payload);
        const resultEntries = collectEntries(result);

        // Every credential-shaped field must be redacted.
        for (const [key, value] of resultEntries) {
          const normalized = normalizeKey(key);
          const isCredential = CREDENTIAL_KEYS.some((k) => normalizeKey(k) === normalized);
          if (isCredential) {
            expect(value).toBe(REDACTED);
          }
        }

        // Every PII-shaped field's value must be preserved untouched.
        const originalPiiValues = originalEntries.filter(([key]) => {
          const normalized = normalizeKey(key);
          return PII_KEYS.some((k) => normalizeKey(k) === normalized);
        });
        const resultPiiValues = resultEntries.filter(([key]) => {
          const normalized = normalizeKey(key);
          return PII_KEYS.some((k) => normalizeKey(k) === normalized);
        });

        expect(resultPiiValues.map(([, v]) => v)).toEqual(originalPiiValues.map(([, v]) => v));
      }),
      { numRuns: 200 },
    );
  });

  it("policy-consistency: redactLogPayload and redactReportPayload agree on credential redaction, differing only on PII", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const logResult = redactLogPayload(payload);
        const reportResult = redactReportPayload(payload);

        const logEntries = collectEntries(logResult);
        const reportEntries = collectEntries(reportResult);

        // Same set of credential-keyed fields, both redacted identically.
        for (const [key, logValue] of logEntries) {
          const normalized = normalizeKey(key);
          const isCredential = CREDENTIAL_KEYS.some((k) => normalizeKey(k) === normalized);
          if (isCredential) {
            const match = reportEntries.find(([rKey]) => normalizeKey(rKey) === normalized);
            expect(logValue).toBe(REDACTED);
            expect(match?.[1]).toBe(REDACTED);
          }
        }

        // PII fields: log redacts, report preserves — this is the one deliberate divergence.
        for (const [key, logValue] of logEntries) {
          const normalized = normalizeKey(key);
          const isPii = PII_KEYS.some((k) => normalizeKey(k) === normalized);
          if (isPii) {
            expect(logValue).toBe(REDACTED);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
