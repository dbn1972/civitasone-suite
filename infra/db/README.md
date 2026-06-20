# DB-per-service bootstrap

Implements the **L1 isolation rule** (ARCHITECTURE.md): one PostgreSQL 16 cluster, **one database + one login per service**, zero cross-database grants. Postgres cannot query across databases, so a service physically cannot read another service's data. Inside each service DB, **one schema per bounded-context module** (L2).

## Generate

```bash
# passwords come from Vault/Secrets Manager, exported as {ROLE_UPPER}_PASSWORD
export TENANT_SVC_PASSWORD=... IDENTITY_SVC_PASSWORD=... FINANCE_SVC_PASSWORD=...
node infra/db/bootstrap/gen_bootstrap.mjs > infra/db/bootstrap/bootstrap.generated.sql
```

## Apply (as a cluster superuser, once per environment)

```bash
psql "$ADMIN_DATABASE_URL" -f infra/db/bootstrap/bootstrap.generated.sql
```

Each service then connects with **only** its own role, e.g.
`DATABASE_URL=postgres://tenant_svc:***@cluster:5432/civitas_tenant`.

## Adding a service / module

Edit `services.json` (add the service or push a module name) and regenerate. Never grant a service access to another service's database. To harden L2 to engine-level, uncomment the per-module role block in the generated SQL and give each module repo its own connection role.

## Lifting a service to its own cluster (later)

Because nothing was ever shared, you `pg_dump` the one database, restore it on a new cluster, and change that service's `DATABASE_URL`. No application code changes.
