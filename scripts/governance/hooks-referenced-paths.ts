import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

// scripts/governance/hooks-referenced-paths.ts
//
// Referenced-Path Extractor & Checker — see design.md's
// "6. Referenced-Path Extractor & Checker
// (scripts/governance/hooks-referenced-paths.ts)" component.
//
// This file implements task 12.1 (`extractReferencedPaths()`) and task 12.2
// (`checkFileOrDirExists()`, `checkPnpmScriptExists()`).
//
// `checkFileOrDirExists`/`checkPnpmScriptExists` treat `repoRoot` as
// `civitasone-suite/` (not the outer `CivitasOne/` workspace root) — every
// Referenced_Path seen in the real hooks (`docs/api/`, `docs/database/`,
// `shared/pii-crypto.ts`, `migrations/`, `docs/user-guide/`) is written
// relative to `civitasone-suite/`, matching the worked example in design.md
// ("the actual DB schema doc is `civitasone-suite/docs/DATABASE-SCHEMA.md`,
// not a `docs/database/` directory").
//
// ─────────────────────────────────────────────────────────────────────────────
// Calibration against the real 11 `.kiro.hook` files under `.kiro/hooks/`
// (read in full during implementation):
//
//   - Only `enforce-coverage-80.kiro.hook`'s `then.prompt` contains a pnpm
//     invocation: `pnpm --filter @civitasone/<service> exec vitest run
//     --coverage` (a template — `<service>` is a placeholder, not a literal
//     path). This is the sole "pnpm-script" extraction across all 11 hooks.
//   - `then.prompt` file-or-dir references found: `shared/pii-crypto.ts`
//     (pii-encryption-check), `docs/api/` (sync-validators-docs,
//     update-api-docs), `migrations/` and `docs/database/`
//     (update-db-schema), `docs/user-guide/` (update-user-manual).
//     `docs/database/` does NOT exist on disk today (the real doc is
//     `civitasone-suite/docs/DATABASE-SCHEMA.md`) — this is the worked
//     example task 12.3/12.4 resolve; `docs/api/` DOES exist.
//   - `when.patterns[]` entries are file-or-dir/glob candidates too: every
//     real hook's patterns all contain `*` (e.g. `"**/routes.ts"`,
//     `"**/*.dart"`, `"**/migrations/*.sql"`), so all 11 hooks' `patterns`
//     extractions are classified `glob`, never `file-or-dir`.
//   - Several prose slashes that are NOT real paths also match the
//     file-or-dir rule as literally specified ("strings containing '/' and
//     not containing '*'") — e.g. `POST/PUT/PATCH/DELETE` and
//     `Approve/reject` (authz-guard-check), `200/201/202` and
//     `Razorpay/payment` (money-path-integrity). This is expected/inherent
//     to the extraction rule as specified, not a bug: extraction is
//     deliberately broad/inclusive here so nothing is missed (no false
//     negatives — Property 15), and it is `checkFileOrDirExists` (task 12.2,
//     NOT implemented in this file) that later determines these don't
//     resolve to a real path, which is the appropriate place to filter
//     rather than narrowing the extraction regex itself.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single reference to a file, directory, pnpm/npm script invocation, or
 * glob pattern found inside one field of an Agent_Hook.
 *
 * Matches design.md's `ReferencedPath` interface for this component.
 */
export interface ReferencedPath {
  hookFile: string;
  sourceField: "prompt" | "patterns" | "command";
  rawText: string;
  kind: "file-or-dir" | "pnpm-script" | "glob";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction regexes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Matches a full pnpm/npm command invocation inside free text (a
 * `then.prompt` or `then.command` string), e.g.:
 *   - "pnpm --filter @civitasone/<service> exec vitest run --coverage"
 *   - "pnpm run build"
 *   - "pnpm test"
 *
 * The whole matched substring (not just a capture group) is used as the
 * `rawText` for a "pnpm-script" ReferencedPath, per design.md's worked
 * example (`rawText: "pnpm --filter @civitasone/finance-service exec vitest
 * run --coverage"`) — a caller wanting just the script/tool name can parse
 * `rawText` further, but the full invocation is what needs to be checked
 * against a package.json / devDependency (task 12.2), so it is kept intact
 * here rather than truncated to a single regex capture group.
 */
const PNPM_SCRIPT_RE =
  /pnpm(?:\s+--filter\s+\S+)?\s+(?:run\s+)?(?:exec\s+)?[\w:-]+(?:\s+run)?(?:\s+--[\w-]+)*/g;

/**
 * Matches a contiguous "path-like" token in free text: a run of word
 * characters, dots, dashes, slashes, and asterisks. Applied AFTER pnpm-script
 * spans have been masked out of the text (see `maskSpans` below), so this
 * never re-derives a fragment of an already-classified pnpm invocation (e.g.
 * the `/` inside `@civitasone/<service>`).
 *
 * A matched token is then classified:
 *   - contains "*"                     -> "glob"
 *   - contains "/" (and no "*")        -> "file-or-dir"
 *   - neither ("/" nor "*")             -> not path-like, discarded
 */
const PATH_TOKEN_RE = /[\w.\-/*]+/g;

/** Replaces each `[start, end)` character span in `text` with spaces of the
 * same length, preserving all other character offsets/lengths. Used to
 * prevent the file-or-dir/glob token pass from re-matching a fragment of a
 * substring already extracted as a pnpm-script. */
function maskSpans(text: string, spans: Array<readonly [number, number]>): string {
  if (spans.length === 0) return text;
  const chars = text.split("");
  for (const [start, end] of spans) {
    for (let i = start; i < end; i++) {
      chars[i] = " ";
    }
  }
  return chars.join("");
}

/**
 * Extracts every pnpm-script, glob, and file-or-dir reference from a single
 * free-text field (`then.prompt` or `then.command`).
 */
function extractFromFreeText(
  text: string,
  hookFile: string,
  sourceField: "prompt" | "command"
): ReferencedPath[] {
  const results: ReferencedPath[] = [];

  const pnpmMatches = [...text.matchAll(PNPM_SCRIPT_RE)];
  for (const match of pnpmMatches) {
    results.push({ hookFile, sourceField, rawText: match[0], kind: "pnpm-script" });
  }

  const masked = maskSpans(
    text,
    pnpmMatches.map((match) => [match.index, match.index + match[0].length] as const)
  );

  const tokens = masked.match(PATH_TOKEN_RE) ?? [];
  for (const token of tokens) {
    if (token.includes("*")) {
      results.push({ hookFile, sourceField, rawText: token, kind: "glob" });
    } else if (token.includes("/")) {
      results.push({ hookFile, sourceField, rawText: token, kind: "file-or-dir" });
    }
    // A token with neither "/" nor "*" is a plain word (e.g. "resolveContext")
    // and is not path-like — deliberately discarded.
  }

  return results;
}

/**
 * Extracts every pnpm-script/glob/file-or-dir reference from `when.patterns`.
 * Each array element is treated as a single, already-delimited unit (never
 * regex-tokenized as free text), since `patterns` is an array of exact glob
 * strings, not prose.
 */
function extractFromPatterns(patterns: unknown, hookFile: string): ReferencedPath[] {
  if (!Array.isArray(patterns)) return [];
  const results: ReferencedPath[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (pattern.includes("*")) {
      results.push({ hookFile, sourceField: "patterns", rawText: pattern, kind: "glob" });
    } else if (pattern.includes("/")) {
      results.push({ hookFile, sourceField: "patterns", rawText: pattern, kind: "file-or-dir" });
    }
    // A pattern with neither "/" nor "*" (unusual, but possible for a bare
    // filename glob target like "*.ts" without a directory prefix) still
    // falls through to the glob branch above whenever it contains "*"; a
    // pattern with neither is not path-like and is discarded, matching the
    // free-text token rule for consistency.
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 12.1 extractReferencedPaths()
// _Requirements: 6.1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts every Referenced_Path mentioned in an Agent_Hook's `then.prompt`,
 * `when.patterns`, and `then.command` fields, tagging each with its `kind`
 * (`"file-or-dir"`, `"pnpm-script"`, or `"glob"`).
 *
 * `hook.name` (the hook's declared `name` field, e.g. "AuthZ Guard Check") is
 * used as `hookFile` on every result, per the literal shape of this
 * function's parameter (`{ name, when, then }` — no separate file-path
 * field is passed in). Callers that also need the on-disk filename can zip
 * this function's output with the filename they read the hook from.
 *
 * Extraction order per free-text field (`prompt`/`command`): pnpm-script
 * matches are found and masked out first, so that any "/" characters inside
 * a pnpm invocation (e.g. `@civitasone/<service>`) are never separately
 * re-extracted as a spurious file-or-dir/glob reference. `patterns` entries
 * are classified directly (whole-array-element units), never tokenized.
 *
 * Total/defensive: `hook.when`/`hook.then` may be malformed (not an object,
 * missing fields, wrong types) for a hook that failed `validateHookSchema`
 * — this function never throws on such input, it simply extracts nothing
 * from the malformed field(s).
 */
export function extractReferencedPaths(hook: {
  name: string;
  when: unknown;
  then: unknown;
}): ReferencedPath[] {
  const hookFile = hook.name;
  const results: ReferencedPath[] = [];

  if (isPlainObject(hook.then)) {
    const prompt = hook.then.prompt;
    if (typeof prompt === "string") {
      results.push(...extractFromFreeText(prompt, hookFile, "prompt"));
    }

    const command = hook.then.command;
    if (typeof command === "string") {
      results.push(...extractFromFreeText(command, hookFile, "command"));
    }
  }

  if (isPlainObject(hook.when)) {
    results.push(...extractFromPatterns(hook.when.patterns, hookFile));
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 12.2 checkFileOrDirExists() / checkPnpmScriptExists()
// _Requirements: 6.2, 6.3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A `ReferencedPath` together with the outcome of checking it against the
 * repository/package.json state.
 *
 * Matches design.md's `PathCheckResult` interface for this component.
 * `exists` is `"not-applicable"` for `kind: "glob"` results, since globs are
 * checked separately via `checkGlobLowConfidence` (task 10.2), not via
 * `checkFileOrDirExists`/`checkPnpmScriptExists`.
 */
export interface PathCheckResult extends ReferencedPath {
  exists: boolean | "not-applicable";
}

/**
 * Checks whether a `"file-or-dir"`-kind Referenced_Path (e.g. `"docs/api/"`,
 * `"shared/pii-crypto.ts"`) exists on disk, resolved relative to `repoRoot`.
 *
 * `repoRoot` is expected to be `civitasone-suite/`'s absolute path — every
 * real hook's file-or-dir references are written relative to that directory
 * (see the module-header note above), not the outer workspace root.
 *
 * A trailing slash on `path` (e.g. `"docs/api/"`) is immaterial to
 * `fs.existsSync`, which resolves the path either way; no special-casing is
 * needed for directory-vs-file, since the requirement (6.2) only asks
 * whether the path exists, not which kind of filesystem entry it is.
 *
 * Total/defensive: never throws. `path.resolve`/`fs.existsSync` on a
 * malformed or absolute-looking `path` string still produce a definite
 * boolean rather than throwing, so a caller iterating many extracted
 * Referenced_Paths never has one bad entry abort the whole checking pass.
 */
export function checkFileOrDirExists(repoRoot: string, path: string): boolean {
  try {
    const resolved = nodePath.resolve(repoRoot, path);
    return nodeFs.existsSync(resolved);
  } catch {
    return false;
  }
}

/**
 * The `<placeholder>` segment convention used by hook prompts/commands for a
 * templated service name, e.g. `@civitasone/<service>` in
 * `"pnpm --filter @civitasone/<service> exec vitest run --coverage"`. Matched
 * literally against angle-bracket-wrapped identifier text.
 */
const PLACEHOLDER_SEGMENT_RE = /<[\w-]+>/;

/**
 * Extracts the `@civitasone/<name>` (or `@civitasone/name`) package-name
 * argument following a `pnpm --filter` flag in a pnpm-script `command`
 * string, if present. Returns `null` if no `--filter @civitasone/...` token
 * is found (e.g. a bare `"pnpm test"` or `"pnpm run build"` command has no
 * specific package target).
 */
function extractFilterTarget(command: string): string | null {
  const match = command.match(/--filter\s+(@civitasone\/[\w<>-]+)/);
  return match?.[1] ?? null;
}

/**
 * Resolves a `--filter @civitasone/<name>` target against `packageJsons`
 * (keyed by package name, e.g. `"@civitasone/finance-service"`). When the
 * target contains a `<placeholder>` segment (a templated service name, not a
 * literal one — see `PLACEHOLDER_SEGMENT_RE`), it is treated as a wildcard:
 * it resolves successfully as long as `packageJsons` has *at least one*
 * entry under the `@civitasone/` scope (a real package.json — any one of
 * them — exists for the templated invocation to target once `<service>` is
 * substituted with a real service name). A literal (non-placeholder) target
 * must match an exact key in `packageJsons`.
 */
function resolveFilterTargetPackages(
  filterTarget: string,
  packageJsons: Record<string, { scripts: Record<string, string> }>
): Array<{ scripts: Record<string, string> }> {
  if (PLACEHOLDER_SEGMENT_RE.test(filterTarget)) {
    return Object.values(packageJsons);
  }
  const exact = packageJsons[filterTarget];
  return exact ? [exact] : [];
}

/**
 * Checks whether a `"pnpm-script"`-kind Referenced_Path (a full pnpm/npm
 * command invocation string, e.g. `"pnpm --filter @civitasone/<service>
 * exec vitest run --coverage"`, `"pnpm --filter @civitasone/finance-service
 * test"`, `"pnpm run build"`) resolves against `packageJsons` — a map of
 * package name (e.g. `"@civitasone/finance-service"`, or `"root"` for the
 * workspace root) to that package's `{ scripts }` shape.
 *
 * Two resolution modes, matching design.md's guidance:
 *
 *   1. **`exec <tool>`-style invocations** (e.g. `pnpm ... exec vitest run
 *      --coverage`): this is a direct CLI invocation, not a named script.
 *      Resolved as a literal-parts-only check: (a) the `--filter`-targeted
 *      package.json exists (with `<placeholder>` segments treated as a
 *      wildcard — see `resolveFilterTargetPackages`), and (b) `vitest` (the
 *      literal tool name following `exec`) is present as a devDependency of
 *      either the targeted package or the workspace root (keyed as
 *      `"root"` in `packageJsons`, per this module's tests/callers) — since
 *      `exec` only requires the binary to be resolvable on the pnpm
 *      workspace's node_modules path, which a root-level devDependency
 *      satisfies for every workspace package.
 *
 *   2. **Named-script invocations** (e.g. `pnpm --filter
 *      @civitasone/finance-service test`, `pnpm run build`, `pnpm test`):
 *      resolved by checking `scripts[<name>]` exists in the targeted
 *      package's package.json (or the root's, when there is no `--filter`).
 *
 * Total/defensive: never throws on a malformed `command` string — an
 * unparseable command (no recognizable script/tool name) simply resolves to
 * `false` rather than throwing.
 */
export function checkPnpmScriptExists(
  command: string,
  packageJsons: Record<string, { scripts: Record<string, string> }>
): boolean {
  const filterTarget = extractFilterTarget(command);
  const targetPackages = filterTarget
    ? resolveFilterTargetPackages(filterTarget, packageJsons)
    : packageJsons["root"]
      ? [packageJsons["root"]]
      : Object.values(packageJsons);

  if (targetPackages.length === 0) return false;

  const execMatch = command.match(/\bexec\s+([\w:-]+)/);
  const tool = execMatch?.[1];
  if (tool) {
    // Root package.json is always eligible: workspace-hoisted devDeps are
    // resolvable by every package under a pnpm workspace, so a root-level
    // `vitest` devDependency satisfies `exec vitest` for any `--filter`ed
    // package, even one whose own package.json doesn't list it directly.
    const rootHasTool = Boolean(
      (packageJsons["root"] as { devDependencies?: Record<string, string> } | undefined)
        ?.devDependencies?.[tool]
    );
    const anyTargetHasTool = targetPackages.some((pkg) =>
      Boolean((pkg as { devDependencies?: Record<string, string> }).devDependencies?.[tool])
    );
    return rootHasTool || anyTargetHasTool;
  }

  // Named-script mode: "pnpm run <name>", "pnpm <name>", or
  // "pnpm --filter <pkg> <name>". The script name is the token immediately
  // after an optional "run", following any "--filter <target>".
  const withoutFilter = filterTarget ? command.replace(/--filter\s+\S+/, "").trim() : command.trim();
  const scriptMatch = withoutFilter.match(/^pnpm\s+(?:run\s+)?([\w:-]+)/);
  const scriptName = scriptMatch?.[1];
  if (!scriptName) return false;

  return targetPackages.some((pkg) => Boolean(pkg.scripts?.[scriptName]));
}
