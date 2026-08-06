# @civitasone/checklist — changelog

The repo's dependency rules require a changelog entry and a version bump for any change to
a `@civitasone/*` package.

## 0.1.0

Initial release. Pure checklist domain logic — no database, no Fastify, no I/O, no clock.

### Added

- **Types** for template structure (`ChecklistSection`, `ChecklistQuestion`,
  `ConditionalRule`, `SectionPrerequisite`, `ChecklistStructure`) and instance responses
  (`ResponseEntry`, `ChecklistResponses`), plus the exported vocabularies `QUESTION_TYPES`
  and `CONDITION_OPERATORS` that consumers build their zod enums from.
- **Conditional visibility** — `evaluateOperator`, `evaluateConditionalRule`,
  `isQuestionVisible`, `resolveVisibility`, `visibleQuestions`. A question with rules is
  visible only when EVERY rule permits it.
- **Section prerequisites** — `isPrerequisiteSatisfied`, `resolveSectionAvailability`,
  `availableSectionIds`. Prerequisites CHAIN, resolved by fixpoint; a dangling reference or
  a cycle resolves to "locked" rather than throwing, because an instance holds a frozen
  structure that may predate today's validation.
- **Scoring** — `computeSectionScore`, `computeSectionScores`, `computeScores`. Weighted
  over visible required questions; overall weighted over available sections. All-zero
  weights are treated as unweighted rather than as a division by zero.
- **Completion and progress** — `evaluateCompletion` (with `findUnansweredRequired`,
  `isComplete`, `computeProgressPercent` as thin wrappers). "Outstanding" means required
  AND visible AND in an available section AND unanswered; progress uses the same
  denominator, so 100% progress and `complete` can never disagree.
- **Structure handling** — `freezeStructure` (the deep copy that makes an instance immune
  to later template versions), `mergeResponses` (partial saves), `buildResponses`,
  `questionIds`, `unknownQuestionIds`.
- **Authoring validation** — `validateStructure` and its individual checks, all throwing
  `ChecklistDomainError` with a stable `code`.

### Notes

- `services/inspection-service/src/modules/checklist` contains an equivalent engine. It is
  deliberately NOT migrated onto this package in this release: it is working, tested code
  in production use, and moving it is separate work with its own regression risk. This
  package exists so a third copy is never written — `services/crm-service/src/modules/
  checklists` (G7) is its first consumer.
- Every optional property is declared `?: T | undefined` because the repo compiles with
  `exactOptionalPropertyTypes`; without it, a zod-parsed value is not assignable and every
  consumer would need a cast at the boundary.
- Zero runtime dependencies. Dev dependencies are pinned exactly, per the repo's dependency
  rules.
