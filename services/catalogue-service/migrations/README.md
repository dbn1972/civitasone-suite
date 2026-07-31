# Catalogue Service Migrations

Sequential SQL migrations for the product/service catalogue.

## Conventions

- Files named `NNNN_descriptive_name.sql` (4-digit zero-padded sequence)
- Always additive and idempotent (`IF NOT EXISTS`, `IF EXISTS`)
- Every migration starts with a comment block: purpose, rollback steps, affected services
- `SET lock_timeout = '5s'` before any `ALTER TABLE`
- Index creation always uses `CREATE INDEX CONCURRENTLY`
- No destructive operations without explicit tech lead approval
