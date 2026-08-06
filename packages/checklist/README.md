# @civitasone/checklist

Pure checklist domain logic: versioned template structure, conditional visibility,
section prerequisites, weighted scoring, completion and progress.

No database, no Fastify, no I/O, no clock. Every export is a deterministic function
over plain data, so a service can own its own tables and still share one engine.

## Why this package exists

`services/inspection-service/src/modules/checklist` already contains an equivalent
engine — versioned templates, weighted sections with prerequisites, conditionally
visible questions, scored instances. Module isolation (each module owns its PG schema,
no cross-service imports of module internals) means crm-service cannot reach it, and
CRM needs the same capability for three product journeys: exporter readiness
documentation, insurance proposal documentation, and B2B customer onboarding.

Rather than write a second copy inside CRM and guarantee a third one later, the pure
part lives here. **inspection-service is deliberately NOT migrated onto this package in
the change that introduced it** — that is working, tested code in production use, and
moving it is a separate piece of work with its own regression risk. This package exists
so that when someone next needs a checklist, there is an obvious answer.

## Model

A template is an ordered list of **sections**; each section holds ordered
**questions**.

- **Section** — `id`, `title`, `sortOrder`, `weight`, optional
  `prerequisite: { sectionId, minScore }`, `questions[]`.
- **Question** — `id` (unique across the whole template), `text`, `type`, `sortOrder`,
  `weight`, `required`, optional `helpText`, optional `conditionalLogic[]`.
- **ConditionalRule** — `{ dependsOn, operator, value, action }` where `operator` is
  `eq | neq | gt | lt | in | not_in` and `action` is `show | hide`.
- **Responses** — `Record<questionId, { value, answeredAt }>`, partial by design.

An **instance** is a deep copy of a published template's sections plus its own
responses. Copying is what makes an instance immune to later template versions.

## API

### Answers — `answers.ts`

| Function | Purpose |
|---|---|
| `isAnswered(entry)` | The single definition of "answered". Blank strings and empty arrays are NOT answers; `false` and `0` are. |
| `hasAnswer(responses, questionId)` | Same test, by id. |
| `answerValue(responses, questionId)` | The value, or `undefined` when unanswered. |

### Conditional visibility — `visibility.ts`

| Function | Purpose |
|---|---|
| `evaluateOperator(op, actual, expected)` | One comparison. `eq`/`neq` strict, `gt`/`lt` numeric, `in`/`not_in` need an array. |
| `evaluateConditionalRule(rule, responses)` | Whether one rule permits the question. |
| `isQuestionVisible(question, responses)` | Whether EVERY rule permits it (AND). No rules → visible. |
| `resolveVisibility(sections, responses)` | `questionId → boolean` for the whole structure. |
| `visibleQuestions(section, responses)` | The visible questions of one section. |

Rules read the raw recorded value, so a rule can legitimately test for an empty answer.

### Prerequisites — `prerequisites.ts`

| Function | Purpose |
|---|---|
| `isPrerequisiteSatisfied(prereq, sectionScores)` | Threshold test against a section score. |
| `resolveSectionAvailability(sections, sectionScores)` | `sectionId → boolean`, resolving CHAINS by fixpoint. |
| `availableSectionIds(sections, sectionScores)` | Available sections in author order. |

Prerequisites chain: if A gates B and B gates C, C stays locked while A is unmet.
A dangling reference or a cycle resolves to "locked" rather than throwing, because an
instance holds a frozen structure that may predate today's validation.

### Scoring — `scoring.ts`

| Function | Purpose |
|---|---|
| `computeSectionScore(section, responses)` | 0–100. Weighted proportion of VISIBLE REQUIRED questions answered. No required questions → 100. |
| `computeSectionScores(sections, responses)` | Per-section map. |
| `computeScores(sections, responses)` | `{ sectionScores, overallScore, availability }`. Overall = section scores averaged by section weight over AVAILABLE sections. |

All-zero weights are treated as unweighted (each item counts once) rather than as a
division by zero.

### Completion + progress — `completion.ts`

| Function | Purpose |
|---|---|
| `evaluateCompletion(sections, responses)` | `CompletionState`: `complete`, `progressPercent`, `requiredTotal`, `requiredAnswered`, `unansweredRequired`, `outstanding`, `sectionScores`, `score`, `availableSectionIds`, `lockedSectionIds`. |
| `findUnansweredRequired(sections, responses)` | Just the outstanding ids. |
| `isComplete(sections, responses)` | Just the boolean. |
| `computeProgressPercent(sections, responses)` | Just the percentage. |

"Outstanding" means required **and** visible **and** in an available section **and**
unanswered. Progress uses the same denominator, so 100% progress and `complete` can
never disagree.

### Structure handling — `structure.ts`

| Function | Purpose |
|---|---|
| `freezeStructure(sections)` | Deep copy, sorted by `sortOrder`. Use at instance creation. |
| `mergeResponses(existing, incoming)` | Partial save: later answers win, untouched ones survive. |
| `buildResponses(answers, answeredAt)` | Build entries for a batch with one timestamp. |
| `questionIds(sections)` / `unknownQuestionIds(sections, ids)` | Guard a submission against the frozen structure. |

### Authoring validation — `validate.ts`

`validateStructure(sections)` runs, in order: unique section ids, unique question ids,
weights and thresholds, conditional references, prerequisites. Each check is also
exported individually. All throw `ChecklistDomainError` with a stable `code`:

`DUPLICATE_SECTION_IDS`, `DUPLICATE_QUESTION_IDS`, `INVALID_SECTION_WEIGHT`,
`INVALID_QUESTION_WEIGHT`, `INVALID_PREREQUISITE_SCORE`, `UNKNOWN_CONDITION_DEPENDENCY`,
`SELF_REFERENTIAL_CONDITION`, `INVALID_CONDITION_VALUE`, `SELF_REFERENTIAL_PREREQUISITE`,
`UNKNOWN_PREREQUISITE`, `PREREQUISITE_CYCLE`.

`ChecklistDomainError` is deliberately not an HTTP error — the caller maps `code` onto
a status.

## Usage

```ts
import {
  evaluateCompletion,
  freezeStructure,
  mergeResponses,
  validateStructure,
} from "@civitasone/checklist";

validateStructure(draft.sections);              // authoring time

const structure = freezeStructure(published.sections);   // instance creation

const responses = mergeResponses(instance.responses, submitted);  // partial save
const state = evaluateCompletion(structure, responses);
// state.complete, state.progressPercent, state.unansweredRequired, state.score
```

## Consumers

- `services/crm-service/src/modules/checklists` — exporter readiness, insurance
  proposal and B2B onboarding checklists.

## Tests

```bash
pnpm --filter @civitasone/checklist exec vitest run
pnpm --filter @civitasone/checklist exec vitest run --coverage
```

## Licensing

Private workspace package (`private: true`), covered by the repository's root
`LICENSE` (AGPL-3.0). Not published to npm.
