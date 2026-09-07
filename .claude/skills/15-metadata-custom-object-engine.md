# Skill — Metadata Custom-Object & Validation-Rule Engine

**When to load:** Building anything in `metadata-service` (entity/field/layout definitions, custom records, or the tenant-defined validation-rule expression engine).

---

> `metadata-service` is a low-code custom-object engine (entity definitions, field definitions, layouts, and tenant-authored validation rules evaluated against arbitrary JSONB record data) — a different shape of domain from every other service: its "business logic" is itself configuration, defined per-tenant at runtime rather than in code. This skill covers the one invariant that matters most here: the validation-rule expression grammar must stay safe by construction.

## Core invariant (never violate)

**The validation-rule expression evaluator (`rules/domain.ts`) must never gain the ability to execute arbitrary code.** It is a hand-written tokenizer + recursive-descent parser over a deliberately restricted grammar — field references, `== != > < >= <=`, `AND OR NOT`, numeric/string/boolean/null literals, and a fixed function allow-list (`LEN`, `ISBLANK`, `ISNUMBER`, `TODAY`). There is **no `eval()`, no `new Function()`, no dynamic property access beyond a plain object key lookup (`data[fieldName]`)** anywhere in this path, and no change to this module should introduce one — a tenant-authored `validation_rule.expression` string is untrusted input, evaluated against every write to `custom_records`.

## Extending the grammar safely

- **New operators or functions must be added to the explicit `OPERATORS`/`FUNCTIONS` allow-lists** (`tokenize`'s `Set`s) and given a dedicated `case` in `compare`/`evaluateFunc`. Never fall back to a generic "eval the rest of the string" branch for an unrecognized token — an unrecognized identifier that isn't a known field/operator/function should resolve to a field reference (current behavior) or a parse error, never be passed to any JS evaluation primitive.
- **Field resolution (`resolveField`) only ever reads from the caller-supplied `data` record** — it must never resolve a field name against `process.env`, a global, or anything outside the record's own JSONB `data` blob. This is what keeps a tenant's validation rule from being able to read anything beyond the record it's validating.
- **Numeric comparisons (`compare`) coerce via `Number()` and check `isNaN` before comparing** — never assume both operands are already numbers; a rule author can write `age > "18"` and it must behave sensibly (numeric comparison) rather than doing a string comparison or throwing.

## Field & rule validation ordering

- `validateRecord` runs **field-level validation first** (required-ness + type per `FieldDef`), then **rule-level validation** (each active `ValidationRule`'s expression). Both phases collect every error into one array rather than short-circuiting on the first failure — a caller should see all violations in one response, not one-at-a-time round trips.
- Only `rule.isActive` rules are evaluated — a deactivated rule (soft-disabled by a tenant admin) must never block a write. Don't "clean up" by deleting inactive rules from the evaluation path assuming they're dead code; they are intentionally retained but skipped.
- `evaluateExpression`'s return value is **rule-passes semantics** (`true` = record is valid), the inverse of a typical validator's "found an error" convention — when wiring a new call site, don't accidentally negate this twice or once too few times.

## Entity/field/layout definitions

- `entityDefinitions`, `fieldDefinitions`, and `layoutDefinitions` are themselves tenant-scoped, versioned (`version int`) rows, following the suite's standard entity-column convention — they are metadata *about* the tenant's custom objects, not the custom object data itself (that lives in `customRecords.data` as JSONB, one row per record, referencing `entityDefId`).
- `fieldDefinitions.validationRule` (JSONB) and the separate `validationRules` table serve different purposes: don't conflate a single field's inline validation config with the entity-level `ValidationRule` rows evaluated by `rules/domain.ts` — check which one a given code path is actually supposed to read before wiring it up.

## Forbidden patterns

- Adding any code path that passes a tenant-authored expression string to `eval`, `new Function`, `vm.runInContext`, or any other dynamic-code-execution primitive.
- Resolving a field reference in an expression against anything other than the record's own `data` object (env vars, globals, other tenants' records).
- Silently swallowing a validation-rule evaluation error instead of surfacing it as a rule failure — an expression that throws during evaluation (e.g. malformed tokenization) should fail closed (treated as a validation failure), not fail open (treated as passing).
