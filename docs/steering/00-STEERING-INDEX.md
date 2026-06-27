# CivitasOne — Steering Index

The map of governing documents. Read top-down; the higher a doc sits, the more binding it is.

> **Note:** the workflow prompts and skills below live in this `docs/steering/` tree because the build session could not write to `.claude/`. Their **runtime home is `.claude/`** — copy or symlink `docs/steering/prompts/* → .claude/prompts/` and `docs/steering/skills/* → .claude/skills/` so Claude Code and the CI actions pick them up.

## 1. Law (always loaded)

| Doc | What it governs |
|---|---|
| [`/CLAUDE.md`](../../CLAUDE.md) | The non-negotiable operating rules (stack, architecture L1/L2, CQRS write/read, forbidden patterns). Wins on any conflict. |

## 2. Binding references

| Doc | What it governs | From volumes |
|---|---|---|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Execution + cloud + microservice + service architecture; DB-per-service (L1), module-per-schema (L2), write-via-queue / read-via-cache (CQRS), event bus, sagas, outbox. | Vol 3 |
| [STANDARDS.md](../STANDARDS.md) | API, input/form validation, error states, testing, quality/scalability, observability, coding. | Vol 4, 9, 12, 13, 14, 15 |
| [SECURITY.md](../SECURITY.md) | Security control matrix, DPDP/CERT-In compliance, SAST program + gate, secure-coding defaults. | Vol 5, 16, SAST Master |
| [MASTER_BUILD_BRIEF.md](../../archive/docs/MASTER_BUILD_BRIEF.md) | What to build, scope, users, journeys, edition matrix. | Vol 10 |
| [EXECUTION_PLAN.md](../../archive/docs/EXECUTION_PLAN.md) | Sprints, tracks, exit gates, team shape. | Vol 1/2 |
| [PERFORMANCE_DESIGN.md](../PERFORMANCE_DESIGN.md) | Latency/throughput targets, cache + queue design. | Vol 13 |
| [`/MODULES_AND_SCHEMA.md`](../../archive/erpnext-develop/MODULES_AND_SCHEMA.md) | Module catalog, integration map, per-service schema, SoT registry, de-duplication. | (derived) |

## 3. Workflow prompts — one per task type

Pick the prompt that matches the task; fill the inputs; reference the relevant skill(s).

| Prompt | Use for |
|---|---|
| `prompts/01-build-endpoint.md` | new API endpoint (command/query) |
| `prompts/02-build-screen.md` | new web/mobile screen |
| `prompts/03-write-migration.md` | Drizzle migration (own schema only) |
| `prompts/04-write-event-handler.md` | queue consumer / event handler |
| `prompts/05-write-rbac-rule.md` | RBAC/ABAC policy |
| `prompts/06-write-installer-step.md` | installer / readiness step |
| `prompts/07-code-review.md` | PR review (runs in CI) |
| `prompts/08-release-gate.md` | sprint/release gate report |
| **`prompts/09-sast-security-review.md`** | **SAST multi-repo security review (release gate)** — *new* |
| **`prompts/10-form-validation-audit.md`** | **form validation quality audit** — *new* |
| **`prompts/11-error-state-audit.md`** | **error/empty-state audit** — *new* |
| **`prompts/12-integration-test.md`** | **deep cross-service integration test** — *new* |

## 4. Skills — long-form domain knowledge (load alongside prompts)

`skills/01-finance-double-entry` · `02-procurement-workflows` · `03-rbac-policy-language` · `04-audit-event-spec` · `05-multi-tenant-isolation` · `06-installer-readiness-score` · `07-queue-message-design` · `08-accessibility-wcag-22` · `09-localisation-i18n` · **`10-form-and-input-validation`** *(new)* · **`11-secure-coding-sast`** *(new)*.

## 5. How a task flows

1. Read `/CLAUDE.md`. 2. Open the matching `prompts/*`. 3. Load the matching `skills/*`. 4. Build the smallest correct change with tests in the same PR. 5. `07-code-review` runs on the PR; `09-sast-security-review` runs at the gate. 6. `08-release-gate` produces the sprint report. 7. New task type with no prompt? Add one in the same PR.

## 6. Gate summary (must all pass to ship)

Typecheck + lint + tests green · ≥80% coverage on changed code · zero L1/L2 joins · audit on every mutation · writes via queue, reads via cache · WCAG 2.2 AA + all 8 UI states · forms pass the Vol 9 matrix · SAST clean of new Critical/High · p95 read <200ms / write-ack <500ms · k6 1,000 TPS · DR drill current.
