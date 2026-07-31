# loyalty-service migrations

Sequential SQL migrations for the Loyalty service (points, tiers, accrual, redemption, liability).

## Naming convention

`NNNN_descriptive_name.sql` — 4-digit zero-padded sequence.

## Rules

- Every migration MUST be additive and idempotent (`IF NOT EXISTS`, `IF EXISTS`).
- Every migration starts with a comment block: purpose, rollback steps, affected services.
- `SET lock_timeout = '5s'` before any `ALTER TABLE`.
- Use `CREATE INDEX CONCURRENTLY` for non-blocking index creation.
- All timestamp columns use `timestamptz`.
