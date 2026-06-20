# Workflow Prompt — Build Endpoint

**Use when:** Adding a new Fastify route to an existing service.

---

## Fill these placeholders

```
SERVICE: {{service-name from services/}}
METHOD: {{GET | POST | PUT | PATCH | DELETE}}
PATH: {{/resource | /resource/:id | /resource/:id/sub}}
PURPOSE (one sentence): {{what this endpoint does}}
ISSUE: {{GitHub issue link}}

AUTHENTICATION: {{required | public — public must be justified in PR description}}
REQUIRED ROLES (from policy-service): {{e.g. ["finance.manager", "finance.accountant"]}}
PERMISSION KEY (for policy-service check): {{e.g. finance.journal.create}}

INPUTS (zod schema):
- {{field}}: {{type}}, {{validation rules}}
- {{field}}: {{type}}, {{validation rules}}

PATH PARAMS:
- {{:id}}: {{format — uuid v4, etc.}}

QUERY PARAMS:
- {{name}}: {{type}}, {{default}}

OUTPUT (success):
- Status: {{200 | 201 | 204}}
- Shape: ApiResponse<{{T}}> from @civitasone/types
- Fields returned: {{list}}

ERRORS (use ApiError envelope):
- 400 {{validation code}}: {{when}}
- 401 AUTH_TOKEN_INVALID: {{handled by JWT middleware}}
- 403 PERMISSION_DENIED: {{when}}
- 404 {{resource}}_NOT_FOUND: {{when}}
- 409 {{conflict code}}: {{when — e.g. duplicate, optimistic lock}}
- 422 BUSINESS_RULE_VIOLATION: {{when}}

MUTATION? {{yes/no}}
  If yes:
  - Tables written: {{service_prefix}}_{{table}} (and any others within same service)
  - Idempotency: required via `Idempotency-Key` header
  - Audit event emitted: action={{action}}, resourceType={{type}}, resourceId={{computed}}
  - Domain event emitted (if applicable): eventType from @civitasone/events

CACHING? {{yes/no}}
  If yes:
  - Cache key: {{tenant}}:{{service}}:{{resource}}:{{id}}
  - TTL: {{seconds}}
  - Invalidation: {{list cache keys to clear on mutation}}

DEPENDENCIES:
- Other services called: {{list}} — via HTTP only, never DB
- Queue topics published: {{list}} — via @civitasone/queue
- Queue topics consumed: {{list — should not be in this prompt; use 04-write-event-handler.md}}

TESTS REQUIRED (vitest):
- 2xx success path with valid input
- 400 validation failure for each required field missing / invalid
- 401 unauthenticated
- 403 forbidden (insufficient roles)
- 404 not found (where applicable)
- 409 conflict (idempotency replay, duplicate, optimistic lock)
- 422 business rule violation (where applicable)
- Audit event emission verified via mock
- Cache invalidation verified (if applicable)
```

---

## Output instructions for Claude

Produce a diff against the repo with these files only:

1. `services/{{service}}/src/routes/{{resource}}.ts` — route handler
2. `services/{{service}}/src/schemas/{{resource}}.ts` — zod schemas (request + response)
3. `services/{{service}}/src/services/{{resource}}.service.ts` — business logic
4. `services/{{service}}/src/repositories/{{resource}}.repo.ts` — Drizzle queries
5. `services/{{service}}/src/routes/{{resource}}.test.ts` — vitest covering every case above
6. Update `services/{{service}}/src/index.ts` to register the route
7. Update `@civitasone/types` if a new shared type is needed
8. Update `@civitasone/events` if a new domain event is emitted

After writing files, run:
```
pnpm --filter @civitasone/{{service}} typecheck
pnpm --filter @civitasone/{{service}} test
pnpm --filter @civitasone/{{service}} lint
```

Report any failure verbatim and fix before declaring done.

---

## Anti-patterns to avoid

- Don't put validation logic in the service layer — keep it in the zod schema at route boundary
- Don't read other services' tables — call their APIs
- Don't write business logic inside the route handler — delegate to the service layer
- Don't emit the audit event from the route layer — emit from the service layer right after persistence commit
- Don't catch errors and return a success-shaped response
- Don't expose internal IDs (auto-increment) — use UUID v7 only

---

## Quality bar (PR will be rejected if)

- Any test fails
- Coverage of changed lines < 80%
- Audit event missing on mutation
- Cross-service join present
- Raw SQL outside a migration
- `any` types in exported signatures
- Endpoint not registered with the matching permission key in policy-service migration
