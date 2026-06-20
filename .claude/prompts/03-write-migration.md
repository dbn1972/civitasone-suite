# Workflow Prompt — Write Migration

**Use when:** Adding or changing a table owned by a service.

---

## Fill these placeholders

```
SERVICE: {{service-name}}
TABLE NAME: {{service_prefix}}_{{name}}        (MUST start with service prefix)
PURPOSE (one sentence): {{what this stores}}
ISSUE: {{GitHub issue link}}

COLUMNS:
- id              uuid          PRIMARY KEY DEFAULT gen_random_uuid()
- tenant_id       uuid          NOT NULL — REQUIRED on every row
- {{name}}        {{type}}      {{nullable? defaults? unique? fk?}}
- ...
- created_at      timestamptz   NOT NULL DEFAULT now()
- updated_at      timestamptz   NOT NULL DEFAULT now()
- created_by      uuid          NOT NULL
- updated_by      uuid          NOT NULL
- version         integer       NOT NULL DEFAULT 1

INDEXES:
- (tenant_id) — ALWAYS, for tenant scoping
- ({{column}}) — for {{query pattern}}
- UNIQUE (tenant_id, {{column}}) — if applicable

FOREIGN KEYS:
- (column) REFERENCES {{same-service-prefix}}_{{table}}(id) ON DELETE {{RESTRICT | SET NULL | CASCADE}}
- NOTE: foreign keys ONLY to tables in the same service. NEVER cross-service.

ENUMS (if any):
- Defined as Postgres enum type {{service}}_{{name}}_enum with values: {{list}}

ROW-LEVEL SECURITY (Vol 5):
- Enable RLS on this table
- Policy: tenant_id = current_setting('app.tenant_id')::uuid

RETENTION:
- {{forever | N years | hot for N months, cold thereafter}}
- Archive strategy: {{N/A | move to {{service}}_{{name}}_archive table after N months}}
```

---

## Output instructions for Claude

Produce these files:

1. `services/{{service}}/src/schema/{{table-without-prefix}}.ts` — Drizzle schema definition
2. `services/{{service}}/drizzle/{{NNNN}}_{{description}}.sql` — generated migration SQL
3. `services/{{service}}/drizzle/{{NNNN}}_{{description}}.meta.json` — Drizzle metadata
4. Update `services/{{service}}/src/schema/index.ts` to export the new schema

After writing files, run:
```
pnpm --filter @civitasone/{{service}} db:generate
pnpm --filter @civitasone/{{service}} db:migrate:dry
```

Verify:
- Migration is idempotent (uses IF NOT EXISTS where appropriate)
- Rollback strategy documented in migration header
- Tenant_id column present and indexed
- RLS policy created

---

## Anti-patterns

- Foreign key to a table in another service → forbidden
- Missing tenant_id → forbidden
- Auto-increment integer PK → forbidden (use UUID)
- Storing money as float/decimal → forbidden (use bigint minor units)
- Storing time without timezone → forbidden (use timestamptz)
- Mixing migration purposes (schema + data) → split into two migrations
- Editing a previously merged migration → forbidden (create a new one)
