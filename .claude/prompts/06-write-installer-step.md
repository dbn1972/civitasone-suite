# Workflow Prompt — Write Installer Step

**Use when:** Adding or refining a stage in the install wizard (Vol 11).

---

## Fill these placeholders

```
STEP NAME: {{e.g. "Validate database adapter"}}
STAGE NUMBER (Vol 11 §5): {{1..10}}
ISSUE: {{GitHub issue link}}

PURPOSE (one sentence): {{what this step validates / configures}}

INPUTS (what the installer collects):
- {{field}}: {{type, validation}}

VALIDATION CHECKS RUN:
1. {{e.g. connect to host:port}}
2. {{e.g. authenticate with provided credentials}}
3. {{e.g. verify version >= X}}
4. {{e.g. measure round-trip latency}}
5. {{e.g. verify required extensions installed (pg_trgm, uuid-ossp, etc.)}}

FAILURE REMEDIATION (Vol 11 §11 — must be plain language):
- If {{check 1}} fails: "{{what went wrong}}. Try: {{numbered remediation}}"
- If {{check 2}} fails: "..."
(Every failure mode must have a remediation string. No "internal error" allowed.)

READINESS SCORE CONTRIBUTION (Vol 11 §9):
- Category: {{Security | Reliability | Observability | Backup/DR | Performance | Docs | OpHygiene}}
- Points awarded on pass: {{e.g. 5/100}}
- Partial credit allowed? {{yes/no}}
- If yes: scoring rubric per check

UI BEHAVIOUR:
- Stage in left rail shows: pending → active → complete/error
- Validation runs on click of "Run checks" within the step
- Live log shown during checks (Vol 11 wizard pattern)
- On failure: ErrorState with numbered remediation, retry button
- On success: green checkmark, "Continue" enabled

EVENTS EMITTED:
- install.step.completed (action=stage_{{N}}_complete, outcome=success/failure, metadata.checks=[...])

TESTS (vitest + integration):
- Happy path: all checks pass → step completes, score recorded
- Failure path (per check): check fails → remediation surfaced, retry available
- Timeout: check exceeds 30s → fail with timeout-specific remediation
- Idempotent retry: re-running the step does not double-count score
- Skip path (where allowed): mark step as skipped, score 0 for that step, blocker if step is required
```

---

## Output instructions for Claude

Produce these files:

1. `services/install-service/src/steps/stage-{{N}}-{{name}}.ts` — step orchestration
2. `services/install-service/src/checks/{{check-name}}.ts` — one file per check
3. `services/install-service/src/steps/stage-{{N}}-{{name}}.test.ts` — vitest
4. `apps/web/src/app/install/_components/Stage{{N}}{{Name}}.tsx` — UI for this step
5. Update `services/install-service/src/scoring.ts` to register the score contribution

After writing files, run:
```
pnpm --filter @civitasone/install-service typecheck test
pnpm --filter @civitasone/web typecheck
```

---

## Anti-patterns

- Generic "internal error" messages → every failure must have a clear remediation
- Letting the installer advance past a failing required check → blocker, must fail loud
- Storing credentials in plain text during install → use installer ephemeral keyring; persist via Vault adapter only after final commit
- Marking score complete before checks actually pass → blocks honest readiness reporting
- Hardcoding endpoint URLs / ports — every value collected via input
