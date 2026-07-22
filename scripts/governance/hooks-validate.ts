// scripts/governance/hooks-validate.ts
//
// Hook Validator — see design.md's "5. Hook Validator
// (scripts/governance/hooks-validate.ts)" component.
//
// Implements tasks 10.1–10.3:
//   10.1 parseHookFile()               — total, non-throwing JSON parse wrapper
//   10.2 validateHookSchema() /
//        checkGlobLowConfidence()      — schema validation + low-confidence glob check
//   10.3 mechanical fix functions      — missing version / invalid when.type /
//                                         empty then.prompt
//
// Verified against the real 11 `.kiro.hook` files under `.kiro/hooks/` during
// implementation: every real hook uses `when.type` of `fileEdited`,
// `fileCreated`, or `postTaskExecution`, and `then.type` of `askAgent` only —
// both are subsets of design.md's placeholder `EventType`/`ActionType`
// unions below, so the unions are kept as-is (no narrower/wider adjustment
// needed; `fileDeleted`, `preTaskExecution`, `userTriggered`, and
// `runCommand` are not exercised by any real hook today but remain valid
// per the Glossary's Hook_Schema_Validity definition, which is intentionally
// generic since this is a repeatable governance tool, not a one-shot fix).
//
// `minimatch`/`picomatch` are NOT reliably resolvable from
// `civitasone-suite` (confirmed via `require.resolve` during implementation:
// both exist only inside `node_modules/.pnpm/*` as transitive deps of other
// tooling, and pnpm's strict, non-hoisting linking means they are not
// accessible as a phantom dependency from this module). Per task 10.2's
// instruction to fall back to a minimal glob matcher rather than add a new
// dependency, `checkGlobLowConfidence()` below uses a small hand-rolled
// glob-to-RegExp converter (`globToRegExp`) supporting the two glob
// constructs actually used by every real hook's `when.patterns`: `**`
// (any number of path segments, including zero) and `*` (any run of
// non-separator characters).

/**
 * The set of event types a real `.kiro.hook` file's `when.type` may declare.
 * Matches design.md's placeholder `EventType` union — verified to be a
 * superset of every value found across the 11 real hooks (`fileEdited`,
 * `fileCreated`, `postTaskExecution`).
 */
export type EventType =
  | "fileEdited"
  | "fileCreated"
  | "fileDeleted"
  | "postTaskExecution"
  | "preTaskExecution"
  | "userTriggered";

/**
 * The set of action types a real `.kiro.hook` file's `then.type` may
 * declare. Matches design.md's placeholder `ActionType` union — verified to
 * be a superset of every value found across the 11 real hooks (`askAgent`
 * only; no real hook uses `runCommand` today).
 */
export type ActionType = "askAgent" | "runCommand";

const EVENT_TYPES: readonly EventType[] = [
  "fileEdited",
  "fileCreated",
  "fileDeleted",
  "postTaskExecution",
  "preTaskExecution",
  "userTriggered",
];

const ACTION_TYPES: readonly ActionType[] = ["askAgent", "runCommand"];

const REQUIRED_TOP_LEVEL_KEYS = ["enabled", "name", "description", "version", "when", "then"] as const;

/**
 * Per-hook validation result, matching design.md's `HookValidationResult`
 * shape. Not produced directly by any function in this file (each of
 * `parseHookFile`/`validateHookSchema`/`checkGlobLowConfidence` returns its
 * own narrower result) — exported so `run.ts` (task 16) can assemble one of
 * these per hook from the three calls without redeclaring the shape.
 */
export interface HookValidationResult {
  file: string;
  parseOk: boolean;
  schemaValid: boolean;
  errors: string[];
  lowConfidenceTrigger: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10.1 parseHookFile()
// _Requirements: 5.1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total, non-throwing JSON parse wrapper for a `.kiro.hook` file's raw text.
 *
 * Never throws: `JSON.parse` failures (truncated JSON, trailing commas,
 * unquoted keys, non-JSON text, empty string, etc.) are caught and reported
 * as `{ ok: false, error }` rather than propagating. This is what makes
 * Property 11 ("Hook JSON parsing never silently succeeds on invalid input")
 * hold — the function only ever returns `ok: true` for genuinely valid JSON,
 * since it is `JSON.parse` itself (not a hand-rolled parser) doing the
 * validity check; every non-throwing path is either a real parse success or
 * a caught, stringified parse error.
 */
export function parseHookFile(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(raw);
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10.2 validateHookSchema() / checkGlobLowConfidence()
// _Requirements: 5.2, 5.3, 5.4, 6.5
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates Hook_Schema_Validity for a parsed hook value (the `value` from a
 * successful `parseHookFile` result). Checks, in order, exactly as specified
 * by design.md's `validateHookSchema` contract:
 *
 *   1. object-ness — `hook` is a non-null, non-array object.
 *   2. required top-level keys present with the expected primitive/object
 *      type: `enabled` (boolean), `name` (string), `description` (string),
 *      `version` (string), `when` (object), `then` (object).
 *   3. `when.type` is one of the supported `EventType` values.
 *   4. IF `when.type` is `fileEdited` or `fileCreated`: `when.patterns` is a
 *      non-empty array of strings.
 *   5. `then.type` is one of the supported `ActionType` values.
 *   6. IF `then.type` is `askAgent`: `then.prompt` is a non-empty
 *      (post-trim) string.
 *      IF `then.type` is `runCommand`: `then.command` is a non-empty
 *      (post-trim) string.
 *
 * All applicable checks are run and every violation is accumulated into
 * `errors` (rather than short-circuiting on the first failure), so a hook
 * with multiple defects is fully diagnosed in one call. Checks 3–6 are
 * skipped (not run, not counted as passing) when their prerequisite
 * structure (`when`/`then` being an object) is itself missing/invalid —
 * this keeps the function total (never throws on malformed input) while
 * still reporting the root-cause error for that missing structure.
 *
 * Returns `{ valid: true, errors: [] }` iff the hook is fully well-formed —
 * this is Property 12's correctness half; the totality half is that this
 * function never throws and always returns a `valid`/`errors` pair for any
 * input, including `null`, arrays, and primitives.
 */
export function validateHookSchema(hook: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(hook)) {
    return { valid: false, errors: ["hook is not a non-null object"] };
  }

  if (typeof hook.enabled !== "boolean") {
    errors.push(hook.enabled === undefined ? "missing required key: enabled" : "enabled must be a boolean");
  }
  if (typeof hook.name !== "string") {
    errors.push(hook.name === undefined ? "missing required key: name" : "name must be a string");
  }
  if (typeof hook.description !== "string") {
    errors.push(hook.description === undefined ? "missing required key: description" : "description must be a string");
  }
  if (typeof hook.version !== "string") {
    errors.push(hook.version === undefined ? "missing required key: version" : "version must be a string");
  }

  const when = hook.when;
  const whenIsObject = isPlainObject(when);
  if (!whenIsObject) {
    errors.push(when === undefined ? "missing required key: when" : "when must be an object");
  }

  const then = hook.then;
  const thenIsObject = isPlainObject(then);
  if (!thenIsObject) {
    errors.push(then === undefined ? "missing required key: then" : "then must be an object");
  }

  if (whenIsObject) {
    const whenType = when.type;
    if (typeof whenType !== "string" || !EVENT_TYPES.includes(whenType as EventType)) {
      errors.push(`when.type ${JSON.stringify(whenType)} is not a supported EventType`);
    } else if (whenType === "fileEdited" || whenType === "fileCreated") {
      const patterns = when.patterns;
      const patternsValid =
        Array.isArray(patterns) && patterns.length > 0 && patterns.every((p) => typeof p === "string");
      if (!patternsValid) {
        errors.push(
          `when.patterns must be a non-empty array of strings when when.type is '${whenType}'`
        );
      }
    }
  }

  if (thenIsObject) {
    const thenType = then.type;
    if (typeof thenType !== "string" || !ACTION_TYPES.includes(thenType as ActionType)) {
      errors.push(`then.type ${JSON.stringify(thenType)} is not a supported ActionType`);
    } else if (thenType === "askAgent") {
      const prompt = then.prompt;
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        errors.push("then.prompt must be a non-empty string when then.type is 'askAgent'");
      }
    } else if (thenType === "runCommand") {
      const command = then.command;
      if (typeof command !== "string" || command.trim().length === 0) {
        errors.push("then.command must be a non-empty string when then.type is 'runCommand'");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Minimal glob matcher (no minimatch/picomatch dependency available) ──────

const GLOB_SPECIAL_RE_CHARS = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

/**
 * Converts a glob pattern using only `**` and `*` (the two constructs used
 * by every real hook's `when.patterns`, e.g. `"**\/routes.ts"`,
 * `"**\/*-routes.ts"`, `"**\/*.dart"`, `"**\/migrations/*.sql"`) into an
 * anchored `RegExp`:
 *
 *   - `**\/` matches zero or more full path segments (so `"**\/routes.ts"`
 *     matches both `"routes.ts"` and `"services/x/src/modules/y/routes.ts"`).
 *   - A bare `**` (not immediately followed by `/`) matches any run of
 *     characters, including `/`.
 *   - `*` matches any run of characters *except* `/`.
 *   - `?` matches exactly one character that is not `/`.
 *   - every other character is escaped if it is a regex metacharacter.
 *
 * This intentionally does not support brace expansion (`{a,b}`), character
 * classes (`[abc]`), or extglob — none of those appear in any of the 11 real
 * hooks' `when.patterns`, and design.md's own worked description of
 * `checkGlobLowConfidence` only requires matching via "minimatch/picomatch"
 * for straightforward `**`/`*` globs.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++; // consume the second '*' of "**"
        if (pattern[i + 1] === "/") {
          re += "(?:.*/)?";
          i++; // consume the trailing '/'
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c !== undefined && GLOB_SPECIAL_RE_CHARS.has(c)) {
      re += `\\${c}`;
    } else {
      re += c ?? "";
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Requirement 6.5 / Property 18 support: true iff none of `patterns` match
 * any file in `repoFileList` — i.e. the hook's trigger glob(s) currently
 * match zero files in the repository. Matching uses the minimal glob
 * matcher above (equivalent to minimatch/picomatch for `**`/`*` patterns).
 *
 * Deliberately does NOT read or mutate the hook's `enabled` field, and does
 * not disable anything — it only computes a boolean finding for the
 * Governance_Report to surface as "low-confidence-trigger", per Requirement
 * 6.5's "without disabling the hook" instruction and Property 18.
 */
export function checkGlobLowConfidence(patterns: string[], repoFileList: string[]): boolean {
  if (patterns.length === 0) return true;
  const regexes = patterns.map(globToRegExp);
  return !repoFileList.some((file) => regexes.some((re) => re.test(file)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 10.3 Mechanical fix functions for schema defects
// _Requirements: 5.5
//
// Each function takes a hook value that has already failed
// `validateHookSchema` for a specific, narrowly-mechanical reason and
// returns a NEW hook object (the input is never mutated) with that one
// defect corrected. None of these change the hook's implied roles, the
// command being run, or a business-rule sentence in a prompt — they are
// exactly the class of "purely mechanical fixes" the design's
// `touchesRolesCommandsOrBusinessRules` flag (task 14.1) treats as `false`
// and therefore eligible for auto-apply.
//
// Callers (the Refresh_Process, task 14) are expected to re-run
// `validateHookSchema` on the returned object — Property 14 requires that a
// hook with exactly one of these three mechanically-fixable defects passes
// validation after the corresponding fix is applied.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_VERSION = "1";

/**
 * Fixes a missing/invalid `version` key by setting it to `"1"` — the
 * version value every real hook in `.kiro/hooks/` already uses. Only
 * applies the fix if `hook` is a plain object; a non-object input is
 * returned unchanged, since there is no mechanical fix for "the whole file
 * isn't a hook object".
 */
export function fixMissingVersion(hook: unknown): unknown {
  if (!isPlainObject(hook)) return hook;
  if (typeof hook.version === "string" && hook.version.length > 0) return hook;
  return { ...hook, version: DEFAULT_VERSION };
}

/** Case/whitespace-insensitive edit distance, used to find an "obvious
 * intended value" for a typo'd `when.type`/`then.type` string. */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) {
    const firstRow = dist[0];
    if (firstRow !== undefined) firstRow[j] = j;
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const prevRow = dist[i - 1];
      const currRow = dist[i];
      if (prevRow === undefined || currRow === undefined) continue;
      const deletion = (prevRow[j] ?? 0) + 1;
      const insertion = (currRow[j - 1] ?? 0) + 1;
      const substitution = (prevRow[j - 1] ?? 0) + cost;
      currRow[j] = Math.min(deletion, insertion, substitution);
    }
  }
  return dist[rows - 1]?.[cols - 1] ?? Math.max(a.length, b.length);
}

/**
 * Finds the "obvious intended value" for a typo'd enum string against a
 * known-valid set: the single candidate within edit distance 2 that is
 * strictly closer than every other candidate. Returns `null` if no
 * candidate is close enough, or if two or more candidates tie for closest
 * (an ambiguous typo has no single "obvious" fix and must be left for
 * manual review rather than mechanically guessed).
 */
function findObviousIntendedValue(typo: string, candidates: readonly string[]): string | null {
  const normalized = typo.trim().toLowerCase();
  let best: { candidate: string; distance: number } | null = null;
  let tie = false;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(normalized, candidate.toLowerCase());
    if (distance > 2) continue;
    if (best === null || distance < best.distance) {
      best = { candidate, distance };
      tie = false;
    } else if (distance === best.distance) {
      tie = true;
    }
  }

  if (best === null || tie) return null;
  return best.candidate;
}

/**
 * Fixes an invalid `when.type` string when an "obvious intended value" can
 * be determined (e.g. `"fileEditted"` → `"fileEdited"`, `"filecreated"` →
 * `"fileCreated"`) via case-insensitive edit-distance matching against the
 * supported `EventType` values.
 *
 * If `when.type` is already valid, or no unambiguous close match exists
 * (edit distance > 2, or a tie between two equally-close valid values),
 * `hook` is returned unchanged — this is intentionally conservative: an
 * ambiguous or unrecognizable `when.type` is a needs-manual-review finding,
 * not something this function should guess at.
 */
export function fixInvalidWhenType(hook: unknown): unknown {
  if (!isPlainObject(hook) || !isPlainObject(hook.when)) return hook;
  const currentType = hook.when.type;
  if (typeof currentType === "string" && EVENT_TYPES.includes(currentType as EventType)) return hook;
  if (typeof currentType !== "string") return hook;

  const intended = findObviousIntendedValue(currentType, EVENT_TYPES);
  if (intended === null) return hook;

  return { ...hook, when: { ...hook.when, type: intended } };
}

/**
 * Fixes an empty/missing/whitespace-only `then.prompt` (when `then.type` is
 * `askAgent`) by restoring it from a caller-supplied `template` string
 * (e.g. a known-good prompt recovered from the hook's `description` field or
 * a prior known-good version of the file). Only applies when `then.type` is
 * `askAgent` and the current `prompt` is genuinely empty — a non-empty
 * prompt is never overwritten, since that would risk silently discarding
 * real (if imperfect) content.
 */
export function fixEmptyPromptFromTemplate(hook: unknown, template: string): unknown {
  if (!isPlainObject(hook) || !isPlainObject(hook.then)) return hook;
  if (hook.then.type !== "askAgent") return hook;
  const currentPrompt = hook.then.prompt;
  const isEmpty = typeof currentPrompt !== "string" || currentPrompt.trim().length === 0;
  if (!isEmpty) return hook;

  return { ...hook, then: { ...hook.then, prompt: template } };
}
