// scripts/governance/hooks-validate.property.test.ts
//
// Property tests for the hook validator (tasks 10.5-10.8). Uses fast-check
// (already a devDependency) — see design.md's "Correctness Properties"
// section for Properties 11-14's full statements.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseHookFile,
  validateHookSchema,
  fixMissingVersion,
  fixInvalidWhenType,
  fixEmptyPromptFromTemplate,
  type EventType,
  type ActionType,
} from "./hooks-validate.js";

const EVENT_TYPES: EventType[] = [
  "fileEdited",
  "fileCreated",
  "fileDeleted",
  "postTaskExecution",
  "preTaskExecution",
  "userTriggered",
];

const ACTION_TYPES: ActionType[] = ["askAgent", "runCommand"];

// ─────────────────────────────────────────────────────────────────────────────
// Property 11: Hook JSON parsing never silently succeeds on invalid input
// _Requirements: 5.1
// ─────────────────────────────────────────────────────────────────────────────

describe("Property 11: Hook JSON parsing never silently succeeds on invalid input", () => {
  // Feature: agent-context-governance-refresh, Property 11: For any string (including deliberately corrupted JSON — truncated, trailing commas, unquoted keys, non-JSON text), parseHookFile either returns { ok: true, value } for genuinely valid JSON, or { ok: false, error } — it never throws uncaught, and never returns ok: true for malformed input.

  it("never throws, and returns ok:true only when JSON.parse itself would succeed, for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        let result: ReturnType<typeof parseHookFile>;
        expect(() => {
          result = parseHookFile(raw);
        }).not.toThrow();

        // Cross-check against the ground truth: JSON.parse itself.
        let expectedOk = true;
        try {
          JSON.parse(raw);
        } catch {
          expectedOk = false;
        }

        expect(result!.ok).toBe(expectedOk);
      }),
      { numRuns: 100 },
    );
  });

  it("never throws and never returns ok:true for deliberately corrupted JSON strings", () => {
    const corruptedGenerators = fc.oneof(
      // Truncated JSON
      fc.jsonValue().map((v) => {
        const s = JSON.stringify(v);
        return s.slice(0, Math.max(0, s.length - 1));
      }),
      // Trailing commas
      fc
        .array(fc.jsonValue(), { minLength: 1, maxLength: 5 })
        .map((arr) => `[${arr.map((v) => JSON.stringify(v)).join(",")},]`),
      // Unquoted keys
      fc
        .dictionary(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,6}$/), fc.jsonValue(), { minKeys: 1, maxKeys: 4 })
        .map((obj) => {
          const entries = Object.entries(obj).map(([k, v]) => `${k}:${JSON.stringify(v)}`);
          return `{${entries.join(",")}}`;
        }),
      // Non-JSON text
      fc.stringMatching(/^[A-Za-z0-9 .,;:!?_-]{1,40}$/),
    );

    fc.assert(
      fc.property(corruptedGenerators, (raw) => {
        let result: ReturnType<typeof parseHookFile>;
        expect(() => {
          result = parseHookFile(raw);
        }).not.toThrow();

        // If the corrupted string happens to still be valid JSON (e.g. a
        // plain number or the string "null" matches /^[A-Za-z0-9 ...]+$/),
        // ok:true is legitimate — only assert ok:false when JSON.parse
        // itself would also reject it.
        let genuinelyValid = true;
        try {
          JSON.parse(raw);
        } catch {
          genuinelyValid = false;
        }

        if (!genuinelyValid) {
          expect(result!.ok).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("returns ok:true with the parsed value for genuinely valid JSON", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const raw = JSON.stringify(value);
        const result = parseHookFile(raw);
        expect(result.ok).toBe(true);
        if (result.ok) {
          // Compare against JSON.parse(JSON.stringify(value)) rather than
          // `value` directly: JSON.stringify/parse round-tripping is not
          // always identity-preserving at the bit level (e.g. -0 loses its
          // sign, becoming 0), and that lossiness belongs to JSON itself,
          // not to parseHookFile — this normalizes the expectation to what
          // JSON.parse would actually produce for `raw`.
          expect(result.value).toEqual(JSON.parse(raw));
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 12: Hook schema validation totality and correctness
// _Requirements: 5.2
// ─────────────────────────────────────────────────────────────────────────────

/** A well-formed hook object, as a base for mutation-based generators below. */
function wellFormedHook(): {
  enabled: boolean;
  name: string;
  description: string;
  version: string;
  when: { type: "fileEdited"; patterns: string[] };
  then: { type: "askAgent"; prompt: string };
} {
  return {
    enabled: true,
    name: "Some Hook",
    description: "Some description",
    version: "1",
    when: { type: "fileEdited", patterns: ["**/routes.ts"] },
    then: { type: "askAgent", prompt: "Do something." },
  };
}

const REQUIRED_TOP_LEVEL_KEYS = ["enabled", "name", "description", "version", "when", "then"] as const;

describe("Property 12: Hook schema validation totality and correctness", () => {
  // Feature: agent-context-governance-refresh, Property 12: For any generated hook-like object (with required keys present/missing in random combinations, and when.type/then.type set to valid or invalid values), validateHookSchema reports valid: false with a non-empty errors list whenever a required key is missing or an enum value is invalid, and reports valid: true with an empty errors list when the object is fully well-formed.

  it("never throws for arbitrary values (totality), always returning a valid/errors pair", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        let result: ReturnType<typeof validateHookSchema>;
        expect(() => {
          result = validateHookSchema(value);
        }).not.toThrow();
        expect(typeof result!.valid).toBe("boolean");
        expect(Array.isArray(result!.errors)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("reports valid:false with non-empty errors whenever a required top-level key is missing", () => {
    fc.assert(
      fc.property(
        fc.subarray(REQUIRED_TOP_LEVEL_KEYS as unknown as string[], { minLength: 1 }),
        (keysToRemove) => {
          const hook: Record<string, unknown> = { ...wellFormedHook() };
          for (const key of keysToRemove) {
            delete hook[key];
          }
          const result = validateHookSchema(hook);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports valid:false with a non-empty errors list when when.type is an invalid enum value", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(EVENT_TYPES as string[]).includes(s)),
        (invalidType) => {
          const hook = wellFormedHook();
          const bad = { ...hook, when: { ...hook.when, type: invalidType as unknown as "fileEdited" } };
          const result = validateHookSchema(bad);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports valid:false with a non-empty errors list when then.type is an invalid enum value", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(ACTION_TYPES as string[]).includes(s)),
        (invalidType) => {
          const hook = wellFormedHook();
          const bad = { ...hook, then: { ...hook.then, type: invalidType as unknown as "askAgent" } };
          const result = validateHookSchema(bad);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports valid:true with an empty errors list for a fully well-formed hook (any supported event/action type combination)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EVENT_TYPES),
        fc.constantFrom(...ACTION_TYPES),
        (eventType, actionType) => {
          const when: Record<string, unknown> =
            eventType === "fileEdited" || eventType === "fileCreated"
              ? { type: eventType, patterns: ["**/foo.ts"] }
              : { type: eventType };
          const then: Record<string, unknown> =
            actionType === "askAgent" ? { type: actionType, prompt: "Do something." } : { type: actionType, command: "pnpm test" };

          const hook = {
            enabled: true,
            name: "Some Hook",
            description: "Some description",
            version: "1",
            when,
            then,
          };

          const result = validateHookSchema(hook);
          expect(result.errors).toEqual([]);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 13: Conditional required-field checks fire exactly when their
// trigger condition holds
// _Requirements: 5.3, 5.4
// ─────────────────────────────────────────────────────────────────────────────

const arbPatternsValue = fc.oneof(
  fc.constant(undefined),
  fc.constant([]),
  fc.array(fc.string(), { minLength: 1, maxLength: 4 }),
  fc.string(), // wrong type (not an array)
);

const arbPromptValue = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc.constant("   \t\n  "), // whitespace-only
  fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
);

describe("Property 13: Conditional required-field checks fire exactly when their trigger condition holds", () => {
  // Feature: agent-context-governance-refresh, Property 13: For any hook-like object: (a) if when.type is fileEdited or fileCreated, validation fails with a patterns-related error if and only if when.patterns is missing or empty; (b) if then.type is askAgent, validation fails with a prompt-related error if and only if then.prompt is missing, empty, or whitespace-only.

  it("(a) patterns-related error fires iff when.patterns is missing/empty for fileEdited/fileCreated", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"fileEdited" | "fileCreated">("fileEdited", "fileCreated"),
        arbPatternsValue,
        (whenType, patternsValue) => {
          const hook = wellFormedHook();
          const when: Record<string, unknown> = { type: whenType };
          if (patternsValue !== undefined) {
            when.patterns = patternsValue;
          }
          const candidate = { ...hook, when };

          const result = validateHookSchema(candidate);
          const hasPatternsError = result.errors.some((e) => e.toLowerCase().includes("patterns"));

          const isMissingOrEmpty =
            patternsValue === undefined ||
            !Array.isArray(patternsValue) ||
            patternsValue.length === 0 ||
            !patternsValue.every((p) => typeof p === "string");

          expect(hasPatternsError).toBe(isMissingOrEmpty);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("(b) prompt-related error fires iff then.prompt is missing/empty/whitespace-only for askAgent", () => {
    fc.assert(
      fc.property(arbPromptValue, (promptValue) => {
        const hook = wellFormedHook();
        const then: Record<string, unknown> = { type: "askAgent" };
        if (promptValue !== undefined) {
          then.prompt = promptValue;
        }
        const candidate = { ...hook, then };

        const result = validateHookSchema(candidate);
        const hasPromptError = result.errors.some((e) => e.toLowerCase().includes("prompt"));

        const isEmptyish =
          promptValue === undefined || typeof promptValue !== "string" || promptValue.trim().length === 0;

        expect(hasPromptError).toBe(isEmptyish);
      }),
      { numRuns: 100 },
    );
  });

  it("no patterns-related error is required when when.type is not fileEdited/fileCreated (trigger condition does not hold)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<EventType>("fileDeleted", "postTaskExecution", "preTaskExecution", "userTriggered"),
        (whenType) => {
          const hook = wellFormedHook();
          const candidate = { ...hook, when: { type: whenType } };
          const result = validateHookSchema(candidate);
          const hasPatternsError = result.errors.some((e) => e.toLowerCase().includes("patterns"));
          expect(hasPatternsError).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("no prompt-related error is required when then.type is not askAgent (trigger condition does not hold)", () => {
    fc.assert(
      fc.property(fc.constant("runCommand" as const), () => {
        const hook = wellFormedHook();
        const candidate = { ...hook, then: { type: "runCommand", command: "pnpm test" } };
        const result = validateHookSchema(candidate);
        const hasPromptError = result.errors.some((e) => e.toLowerCase().includes("prompt"));
        expect(hasPromptError).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 14: A structurally corrected hook always passes validation
// afterward
// _Requirements: 5.5
// ─────────────────────────────────────────────────────────────────────────────

describe("Property 14: A structurally corrected hook always passes validation afterward", () => {
  // Feature: agent-context-governance-refresh, Property 14: For any hook object with a mechanically-fixable schema defect (missing version, invalid when.type string with an obvious intended value, empty then.prompt restored from a known-good template), applying the corresponding fix function and re-running validateHookSchema on the result yields valid: true.

  it("fixMissingVersion: a hook missing `version` passes validation after the fix is applied", () => {
    fc.assert(
      fc.property(fc.constantFrom(...EVENT_TYPES), fc.constantFrom(...ACTION_TYPES), (eventType, actionType) => {
        const hook = wellFormedHook();
        const when: Record<string, unknown> =
          eventType === "fileEdited" || eventType === "fileCreated"
            ? { type: eventType, patterns: ["**/foo.ts"] }
            : { type: eventType };
        const then: Record<string, unknown> =
          actionType === "askAgent" ? { type: actionType, prompt: "Do something." } : { type: actionType, command: "pnpm test" };

        const broken: Record<string, unknown> = {
          enabled: hook.enabled,
          name: hook.name,
          description: hook.description,
          // version intentionally omitted
          when,
          then,
        };

        // Sanity check: the defect is real before the fix.
        expect(validateHookSchema(broken).valid).toBe(false);

        const fixed = fixMissingVersion(broken);
        const result = validateHookSchema(fixed);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("fixInvalidWhenType: a hook with an obvious-typo when.type passes validation after the fix is applied", () => {
    // Typos within edit distance <= 2 of exactly one EventType value, so
    // findObviousIntendedValue can unambiguously resolve them.
    const typoCases: { typo: string; intended: EventType }[] = [
      { typo: "fileEditted", intended: "fileEdited" },
      { typo: "filecreated", intended: "fileCreated" },
      { typo: "fileEdite", intended: "fileEdited" },
    ];

    fc.assert(
      fc.property(fc.constantFrom(...typoCases), fc.constantFrom(...ACTION_TYPES), ({ typo, intended }, actionType) => {
        const then: Record<string, unknown> =
          actionType === "askAgent" ? { type: actionType, prompt: "Do something." } : { type: actionType, command: "pnpm test" };

        const patterns = intended === "fileEdited" || intended === "fileCreated" ? ["**/foo.ts"] : undefined;
        const when: Record<string, unknown> = patterns ? { type: typo, patterns } : { type: typo };

        const broken = {
          enabled: true,
          name: "Some Hook",
          description: "Some description",
          version: "1",
          when,
          then,
        };

        // Sanity check: the defect is real before the fix.
        expect(validateHookSchema(broken).valid).toBe(false);

        const fixed = fixInvalidWhenType(broken);
        const result = validateHookSchema(fixed);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("fixEmptyPromptFromTemplate: a hook with an empty then.prompt passes validation after being restored from a template", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EVENT_TYPES),
        arbPromptValue.filter((p) => p === undefined || typeof p !== "string" || p.trim().length === 0),
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (eventType, emptyPromptValue, template) => {
          const when: Record<string, unknown> =
            eventType === "fileEdited" || eventType === "fileCreated"
              ? { type: eventType, patterns: ["**/foo.ts"] }
              : { type: eventType };

          const then: Record<string, unknown> = { type: "askAgent" };
          if (emptyPromptValue !== undefined) {
            then.prompt = emptyPromptValue;
          }

          const broken = {
            enabled: true,
            name: "Some Hook",
            description: "Some description",
            version: "1",
            when,
            then,
          };

          // Sanity check: the defect is real before the fix.
          expect(validateHookSchema(broken).valid).toBe(false);

          const fixed = fixEmptyPromptFromTemplate(broken, template);
          const result = validateHookSchema(fixed);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
