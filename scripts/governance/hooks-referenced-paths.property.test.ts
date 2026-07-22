// scripts/governance/hooks-referenced-paths.property.test.ts
//
// Property tests for the referenced-path extractor/checker (tasks
// 12.5-12.8). Uses fast-check (already a devDependency) — see design.md's
// "Correctness Properties" section for Properties 15-18's full statements.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkFileOrDirExists, checkPnpmScriptExists, extractReferencedPaths } from "./hooks-referenced-paths.js";
import { checkGlobLowConfidence } from "./hooks-validate.js";

// ─────────────────────────────────────────────────────────────────────────────
// Property 15: Referenced-path extraction has no false negatives for
// planted references
// _Requirements: 6.1
// ─────────────────────────────────────────────────────────────────────────────

// Generators for "known" substrings of each kind, chosen to avoid
// accidentally embedding one kind inside another (e.g. a pnpm-command
// substring containing a "/" that could also be sliced off as a
// file-or-dir token) and to avoid characters that would break word-boundary
// tokenization (whitespace, punctuation outside the allowed token charset).
const arbFileOrDirPath = fc
  .array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,6}$/), { minLength: 2, maxLength: 4 })
  .map((segments) => segments.join("/"));

const arbGlobPattern = fc
  .array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,6}$/), { minLength: 1, maxLength: 3 })
  .map((segments) => `**/${segments.join("/")}/*.ts`);

const arbPnpmCommand = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,8}$/)
  .map((scriptName) => `pnpm run ${scriptName}`);

// Surrounding prose text: word characters and spaces only, so it never
// itself contains a "/" or "*" that could be mistaken for a planted
// reference, and never abuts the planted substring without a separating
// space (which could merge two tokens into one PATH_TOKEN_RE match).
const arbSurroundingWords = fc.array(fc.stringMatching(/^[A-Za-z]{1,10}$/), { minLength: 0, maxLength: 5 });

function embed(before: string[], planted: string, after: string[]): string {
  return [...before, planted, ...after].join(" ");
}

describe("Property 15: Referenced-path extraction has no false negatives for planted references", () => {
  // Feature: agent-context-governance-refresh, Property 15: For any hook prompt/patterns/command text constructed by embedding known file-path-like or pnpm-command-like substrings into random surrounding text, extractReferencedPaths returns a list that includes every embedded substring, tagged with the correct kind.

  it("a planted file-or-dir substring embedded in prompt/command free text is always extracted with kind 'file-or-dir'", () => {
    fc.assert(
      fc.property(arbSurroundingWords, arbFileOrDirPath, arbSurroundingWords, (before, planted, after) => {
        const text = embed(before, planted, after);
        const hook = { name: "test-hook", when: {}, then: { prompt: text } };
        const results = extractReferencedPaths(hook);
        const match = results.find((r) => r.rawText === planted && r.sourceField === "prompt");
        expect(match).toBeDefined();
        expect(match?.kind).toBe("file-or-dir");
      }),
      { numRuns: 100 },
    );
  });

  it("a planted glob substring embedded in prompt/command free text is always extracted with kind 'glob'", () => {
    fc.assert(
      fc.property(arbSurroundingWords, arbGlobPattern, arbSurroundingWords, (before, planted, after) => {
        const text = embed(before, planted, after);
        const hook = { name: "test-hook", when: {}, then: { command: text } };
        const results = extractReferencedPaths(hook);
        const match = results.find((r) => r.rawText === planted && r.sourceField === "command");
        expect(match).toBeDefined();
        expect(match?.kind).toBe("glob");
      }),
      { numRuns: 100 },
    );
  });

  it("a planted pnpm-command substring embedded in prompt free text is always extracted with kind 'pnpm-script'", () => {
    fc.assert(
      fc.property(arbSurroundingWords, arbPnpmCommand, arbSurroundingWords, (before, planted, after) => {
        const text = embed(before, planted, after);
        const hook = { name: "test-hook", when: {}, then: { prompt: text } };
        const results = extractReferencedPaths(hook);
        const match = results.find((r) => r.rawText === planted && r.sourceField === "prompt");
        expect(match).toBeDefined();
        expect(match?.kind).toBe("pnpm-script");
      }),
      { numRuns: 100 },
    );
  });

  it("a planted file-or-dir substring embedded as a when.patterns array element is always extracted with kind 'file-or-dir'", () => {
    fc.assert(
      fc.property(arbFileOrDirPath, (planted) => {
        const hook = { name: "test-hook", when: { patterns: [planted] }, then: {} };
        const results = extractReferencedPaths(hook);
        const match = results.find((r) => r.rawText === planted && r.sourceField === "patterns");
        expect(match).toBeDefined();
        expect(match?.kind).toBe("file-or-dir");
      }),
      { numRuns: 100 },
    );
  });

  it("a planted glob substring embedded as a when.patterns array element is always extracted with kind 'glob'", () => {
    fc.assert(
      fc.property(arbGlobPattern, (planted) => {
        const hook = { name: "test-hook", when: { patterns: [planted] }, then: {} };
        const results = extractReferencedPaths(hook);
        const match = results.find((r) => r.rawText === planted && r.sourceField === "patterns");
        expect(match).toBeDefined();
        expect(match?.kind).toBe("glob");
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 16: File/directory existence checking matches a fake filesystem
// exactly
// _Requirements: 6.2
// ─────────────────────────────────────────────────────────────────────────────

// checkFileOrDirExists uses real node:fs (existsSync against a resolved
// repoRoot), not an injectable fake filesystem. Per the task's guidance, a
// temporary directory is used as the "fake filesystem": real files/dirs are
// created matching a randomly generated fake path set, then
// checkFileOrDirExists(tmpDir, path) is asserted to match membership in
// that set exactly. The temp directory is cleaned up after each run.

const arbSafeSegment = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,7}$/);

// A small fake filesystem: a set of relative paths, each either a file
// (leaf, with a trailing marker of its own) or a directory (created via
// mkdirSync -p, no file needed for it to exist).
const arbFakePathSet = fc
  .uniqueArray(fc.tuple(fc.array(arbSafeSegment, { minLength: 1, maxLength: 3 }), fc.boolean()), {
    minLength: 0,
    maxLength: 6,
    selector: ([segments]) => segments.join("/"),
  })
  // A path marked "file" (asFile === true) cannot also be a strict prefix
  // of another path in the same fake set — that would require creating a
  // directory entry underneath a file, which is not representable on a
  // real filesystem (ENOTDIR). Filter out any such conflicting fake sets.
  .filter((fakeSet) =>
    fakeSet.every(([segmentsA, asFileA]) => {
      if (!asFileA) return true;
      const pathA = segmentsA.join("/");
      return fakeSet.every(([segmentsB]) => {
        const pathB = segmentsB.join("/");
        return pathB === pathA || !pathB.startsWith(`${pathA}/`);
      });
    }),
  );

describe("Property 16: File/directory existence checking matches a fake filesystem exactly", () => {
  // Feature: agent-context-governance-refresh, Property 16: For any path string and any fake set of existing repository paths, checkFileOrDirExists returns true if and only if the path is a member of (or a valid prefix within) the fake path set, and false otherwise.

  it("checkFileOrDirExists(tmpDir, path) is true iff path was materialized (as a file or directory) under tmpDir", () => {
    fc.assert(
      fc.property(
        arbFakePathSet.chain((fakeSet) => {
          const freshPath = fc.array(arbSafeSegment, { minLength: 1, maxLength: 3 }).map((s) => s.join("/"));
          const queryPathArb =
            fakeSet.length > 0
              ? fc.oneof(fc.constantFrom(...fakeSet.map(([segments]) => segments.join("/"))), freshPath)
              : freshPath;
          return fc.tuple(fc.constant(fakeSet), queryPathArb);
        }),
        ([fakeSet, queryPath]) => {
          const tmpDir = mkdtempSync(join(tmpdir(), "hooks-referenced-paths-p16-"));
          try {
            const materialized = new Set<string>();
            for (const [segments, asFile] of fakeSet) {
              const relPath = segments.join("/");
              const absPath = join(tmpDir, ...segments);
              if (asFile) {
                mkdirSync(join(tmpDir, ...segments.slice(0, -1)), { recursive: true });
                writeFileSync(absPath, "content");
              } else {
                mkdirSync(absPath, { recursive: true });
              }
              materialized.add(relPath);
              // Every ancestor prefix of a materialized path also exists
              // (mkdirSync -p creates intermediate directories).
              for (let i = 1; i < segments.length; i++) {
                materialized.add(segments.slice(0, i).join("/"));
              }
            }

            const expected = materialized.has(queryPath);
            const actual = checkFileOrDirExists(tmpDir, queryPath);
            expect(actual).toBe(expected);
          } finally {
            rmSync(tmpDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never throws for arbitrary path strings against a real repoRoot, and returns a strict boolean", () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        const tmpDir = mkdtempSync(join(tmpdir(), "hooks-referenced-paths-p16-total-"));
        try {
          let result: boolean | undefined;
          expect(() => {
            result = checkFileOrDirExists(tmpDir, path);
          }).not.toThrow();
          expect(typeof result).toBe("boolean");
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 17: pnpm/npm script existence checking matches a fake
// package.json map exactly
// _Requirements: 6.3
// ─────────────────────────────────────────────────────────────────────────────

const arbScriptName = fc.stringMatching(/^[a-z][a-z0-9:-]{0,8}$/);
const arbPackageName = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/).map((n) => `@civitasone/${n}-service`);
const arbToolName = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);

describe("Property 17: pnpm/npm script existence checking matches a fake package.json map exactly", () => {
  // Feature: agent-context-governance-refresh, Property 17: For any extracted command string and any fake mapping of package name to its scripts object, checkPnpmScriptExists returns true if and only if the referenced script name exists in the scripts object of the targeted package (or, for direct exec <tool> invocations, the tool is a resolvable devDependency) — never a false positive or false negative relative to the fake map it's given.

  it("named-script mode: 'pnpm --filter <pkg> <script>' resolves true iff <script> is in <pkg>'s scripts map", () => {
    fc.assert(
      fc.property(arbPackageName, arbScriptName, fc.boolean(), (pkgName, scriptName, scriptPresent) => {
        const packageJsons: Record<string, { scripts: Record<string, string> }> = {
          [pkgName]: { scripts: scriptPresent ? { [scriptName]: "some command" } : {} },
        };
        const command = `pnpm --filter ${pkgName} ${scriptName}`;
        expect(checkPnpmScriptExists(command, packageJsons)).toBe(scriptPresent);
      }),
      { numRuns: 100 },
    );
  });

  it("named-script mode without --filter: 'pnpm run <script>' resolves true iff <script> is in the root package's scripts map", () => {
    fc.assert(
      fc.property(arbScriptName, fc.boolean(), (scriptName, scriptPresent) => {
        const packageJsons: Record<string, { scripts: Record<string, string> }> = {
          root: { scripts: scriptPresent ? { [scriptName]: "some command" } : {} },
        };
        const command = `pnpm run ${scriptName}`;
        expect(checkPnpmScriptExists(command, packageJsons)).toBe(scriptPresent);
      }),
      { numRuns: 100 },
    );
  });

  it("named-script mode: a script absent from every package in the fake map always resolves false (no false positives)", () => {
    fc.assert(
      fc.property(
        arbPackageName,
        arbScriptName,
        fc.dictionary(arbScriptName, fc.string(), { maxKeys: 3 }),
        (pkgName, missingScript, otherScripts) => {
          const scripts = { ...otherScripts };
          delete scripts[missingScript];
          const packageJsons: Record<string, { scripts: Record<string, string> }> = {
            [pkgName]: { scripts },
          };
          const command = `pnpm --filter ${pkgName} ${missingScript}`;
          expect(checkPnpmScriptExists(command, packageJsons)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("exec <tool> mode: resolves true iff <tool> is a devDependency of the root or the targeted package", () => {
    fc.assert(
      fc.property(
        arbPackageName,
        arbToolName,
        fc.boolean(),
        fc.constantFrom<"root" | "target" | "neither">("root", "target", "neither"),
        (pkgName, tool, hasFilter, whereTool) => {
          const rootDevDeps = whereTool === "root" ? { [tool]: "1.0.0" } : {};
          const targetDevDeps = whereTool === "target" ? { [tool]: "1.0.0" } : {};

          const packageJsons: Record<string, { scripts: Record<string, string>; devDependencies?: Record<string, string> }> = {
            root: { scripts: {}, devDependencies: rootDevDeps },
            [pkgName]: { scripts: {}, devDependencies: targetDevDeps },
          };

          const command = hasFilter
            ? `pnpm --filter ${pkgName} exec ${tool} run --coverage`
            : `pnpm exec ${tool} run --coverage`;

          // Root's devDependency is always checked regardless of --filter
          // (workspace-hoisted devDeps are resolvable by every package).
          // The target package's own devDependency is only in scope when
          // --filter actually resolves the target as the exec-invocation's
          // targeted package; without --filter, the invocation targets
          // "root" (since a "root" entry is always present here), so the
          // targeted package's devDeps are irrelevant.
          const expected = whereTool === "root" || (hasFilter && whereTool === "target");
          expect(checkPnpmScriptExists(command, packageJsons)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("exec <tool> mode with a templated <service> placeholder: resolves true iff the tool is a devDependency of root or ANY package in the fake map", () => {
    fc.assert(
      fc.property(
        arbToolName,
        fc.dictionary(arbPackageName, fc.boolean(), { minKeys: 1, maxKeys: 4 }),
        fc.boolean(),
        (tool, packagesWithTool, toolAtRoot) => {
          const packageJsons: Record<string, { scripts: Record<string, string>; devDependencies?: Record<string, string> }> = {
            root: { scripts: {}, devDependencies: toolAtRoot ? { [tool]: "1.0.0" } : {} },
          };
          let anyPackageHasTool = false;
          for (const [pkgName, hasTool] of Object.entries(packagesWithTool)) {
            packageJsons[pkgName] = { scripts: {}, devDependencies: hasTool ? { [tool]: "1.0.0" } : {} };
            if (hasTool) anyPackageHasTool = true;
          }

          const command = `pnpm --filter @civitasone/<service> exec ${tool} run --coverage`;
          const expected = toolAtRoot || anyPackageHasTool;
          expect(checkPnpmScriptExists(command, packageJsons)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never throws for arbitrary command strings and arbitrary fake package maps (totality)", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(fc.string(), fc.record({ scripts: fc.dictionary(fc.string(), fc.string()) })),
        (command, packageJsons) => {
          let result: boolean | undefined;
          expect(() => {
            result = checkPnpmScriptExists(command, packageJsons);
          }).not.toThrow();
          expect(typeof result).toBe("boolean");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 18: Low-confidence glob detection never disables the hook
// _Requirements: 6.5
// ─────────────────────────────────────────────────────────────────────────────

const arbFileName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,6}\.[a-z]{1,4}$/);
const arbGlobForFileList = fc.stringMatching(/^\*\*\/[A-Za-z][A-Za-z0-9_-]{0,6}\.[a-z]{1,4}$/);

describe("Property 18: Low-confidence glob detection never disables the hook", () => {
  // Feature: agent-context-governance-refresh, Property 18: For any when.patterns array and any fake repository file list, checkGlobLowConfidence returns true if and only if none of the patterns match any file in the list; and regardless of the result, the hook's enabled field is never mutated as a side effect of this check.

  it("returns true iff none of the patterns match any file in the fake repository file list", () => {
    fc.assert(
      fc.property(
        fc.array(arbGlobForFileList, { minLength: 1, maxLength: 4 }),
        fc.array(arbFileName, { minLength: 0, maxLength: 6 }),
        (patterns, repoFileList) => {
          const result = checkGlobLowConfidence(patterns, repoFileList);

          // Ground truth: does any pattern, treated as "**/<name>" matching
          // any file ending in "/<name>" or exactly "<name>", match any
          // file in the list? Reproduce via the same glob semantics
          // exercised in hooks-validate.ts (via checkGlobLowConfidence
          // itself is the function under test, so cross-check using a
          // simple independent suffix-match reproduction of "**/X"
          // semantics: pattern "**/foo.ts" matches "foo.ts" or anything
          // ending in "/foo.ts").
          const suffix = (p: string) => p.replace(/^\*\*\//, "");
          const anyMatch = repoFileList.some((file) =>
            patterns.some((p) => file === suffix(p) || file.endsWith(`/${suffix(p)}`)),
          );

          expect(result).toBe(!anyMatch);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not mutate the hook's enabled field as a side effect, regardless of the result", () => {
    fc.assert(
      fc.property(
        fc.record({
          enabled: fc.boolean(),
          name: fc.string(),
          patterns: fc.array(arbGlobForFileList, { minLength: 1, maxLength: 4 }),
        }),
        fc.array(arbFileName, { minLength: 0, maxLength: 6 }),
        (hookLike, repoFileList) => {
          const hook = { ...hookLike };
          const enabledBefore = hook.enabled;

          checkGlobLowConfidence(hook.patterns, repoFileList);

          expect(hook.enabled).toBe(enabledBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns true for an empty patterns array regardless of the file list (vacuously no pattern matches anything)", () => {
    fc.assert(
      fc.property(fc.array(arbFileName, { minLength: 0, maxLength: 6 }), (repoFileList) => {
        expect(checkGlobLowConfidence([], repoFileList)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("never throws for arbitrary patterns/file-list inputs (totality) and never mutates its inputs", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 5 }), fc.array(fc.string(), { maxLength: 5 }), (patterns, repoFileList) => {
        const patternsCopy = [...patterns];
        const fileListCopy = [...repoFileList];
        let result: boolean | undefined;
        expect(() => {
          result = checkGlobLowConfidence(patterns, repoFileList);
        }).not.toThrow();
        expect(typeof result).toBe("boolean");
        expect(patterns).toEqual(patternsCopy);
        expect(repoFileList).toEqual(fileListCopy);
      }),
      { numRuns: 100 },
    );
  });
});
