# Agent Context Governance

## What this is

A one-time (repeatable) **audit-and-refresh tool** for CivitasOne's three AI agent
context surfaces:

- Kiro steering documents (`.kiro/steering/`)
- Claude Code skills (`civitasone-suite/.claude/skills/`)
- Kiro agent hooks (`.kiro/hooks/`)

It is **not a runtime service**. There is no server, no long-running process, and
nothing here is invoked by the product at request time. You run it deliberately,
review its output, and re-run it later when steering/skills/hooks drift from the
current state of the repo again.

This follows the existing `scripts/ci/*.mjs` tooling convention already used
elsewhere in `civitasone-suite/scripts/` (`arch-guard.mjs`, `secret-scanner.mjs`,
etc.) — same "small script reads the repo, reports/fixes, exits" shape — but this
module is written in TypeScript and run via `tsx` (already a transitive
devDependency across the monorepo; no new dependency is introduced).

## What it does

1. **Audits** the 4 always-loaded steering documents (`tech.md`, `structure.md`,
   `quick-reference.md`, `product.md`), classifying every section as an
   enforceable rule, stale point-in-time content, a duplicate, or reference
   detail.
2. **Trims** conservatively: only `Stale_Content` sections are relocated (never
   deleted, never rewritten) into a new conditional steering document.
3. **Reconciles** the documented service list and port map in `structure.md` /
   `quick-reference.md` against the real `services/` directory — additive only,
   never removing a documented entry.
4. **Audits and updates** Claude skill files: replacing content that duplicates
   an always-loaded steering rule with a reference to that rule, and creating or
   extending skill files for domains not yet covered.
5. **Validates** every `.kiro.hook` file's JSON structure, schema, and the
   files/directories/commands it references — flagging anything that can't be
   safely auto-corrected as `needs-manual-review` rather than guessing.
6. **Reports** everything it found and changed into a single
   `governance-report.md`.

See the feature's
[requirements](/.kiro/specs/agent-context-governance-refresh/requirements.md) and
[design](/.kiro/specs/agent-context-governance-refresh/design.md) documents for
the full specification this module implements.

## How to invoke it

```bash
# From civitasone-suite/
pnpm governance:audit   # dry-run: audits and reports, writes no changes
pnpm governance:apply   # applies the safe, mechanical corrections and writes the report
```

(`governance:audit` / `governance:apply` are added to `civitasone-suite/package.json`
in a later task — see task 16 of this feature's implementation plan.)

Both commands run `tsx scripts/governance/run.ts` with a `--dry-run` or `--apply`
flag respectively. Nothing in this module needs a build step — `tsx` executes the
TypeScript source directly.

## Module layout

```
scripts/governance/
├── README.md                       — this file
├── types.ts                        — shared vocabulary (SteeringInclusion, SteeringDocMeta, Correction, HookFinalStatus)
├── tsconfig.json                   — extends ../../tsconfig.base.json (strict, NodeNext)
├── steering-audit.ts               — parse + classify steering sections
├── steering-refresh.ts             — move Stale_Content into a conditional doc
├── reconcile-services.ts           — service list / port map reconciliation
├── skills-audit.ts                 — skill inventory + steering-duplication detection
├── hooks-validate.ts               — hook JSON parsing + schema validation
├── hooks-referenced-paths.ts       — extract + check referenced files/commands
├── governance-report.ts            — render the final markdown report
└── run.ts                          — end-to-end orchestration (--dry-run / --apply)
```

Each `*.ts` file above (other than `types.ts`, `run.ts`, and this README) has a
sibling `*.test.ts` and, where the design calls for a property, a
`*.property.test.ts` using `fast-check` (already a devDependency).

## Non-goals

- This is not a general-purpose linter or a CI gate. It doesn't run on every PR.
- It does not touch anything outside `.kiro/steering/`, `.claude/skills/`,
  `.kiro/hooks/`, and its own report output.
- It never invents data (e.g. a port number, a metric) — anything it can't
  determine mechanically is left for a human to decide and is recorded as such.
