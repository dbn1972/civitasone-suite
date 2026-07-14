# RDS read-replica module (G9 / SC-H2)

Provisions a single `aws_db_instance` read replica (`replicate_source_db`) of
an existing RDS primary, so read traffic can be offloaded from the primary
via the opt-in `dbForRead()` Read_Router in `packages/db`.

- `publicly_accessible = false` — never internet-reachable (Req 7.1, 7.3)
- No independent backups by default (`backup_retention_period = 0`) — the
  replica is a read-offload target, not a DR target; the primary's own
  backups (see `docs/architecture/CONNECTION-BUDGET.md` and the Backup_Job)
  remain the source of truth
- `skip_final_snapshot = true` — replicas are disposable/re-creatable from
  the primary at any time
- Exports `replica_endpoint` for population into `DATABASE_REPLICA_URL`

This module does not provision the primary itself — pass the primary's
existing DB instance identifier (or ARN) via `primary_db_identifier`. If no
primary RDS module is yet defined in this environment (see the commented-out
`module "rds"` placeholder in `infra/aws/envs/production/main.tf`), set
`primary_db_identifier` to the primary's identifier once it exists.

## Usage (enable in production)
```hcl
module "rds_replica" {
  source                 = "../../modules/rds-replica"
  environment            = "production"
  primary_db_identifier  = var.primary_db_identifier # e.g. "production-civitasone"
  instance_class         = "db.t3.medium"
}
```

## Runtime env (consumed by packages/db)

- `DATABASE_REPLICA_URL` — set from `module.rds_replica.replica_endpoint`
  (host:port) plus the same credentials/db name convention as the primary
  `DATABASE_URL`. When unset, `dbForRead()` always falls back to the primary
  connection (Req 7.4) — no behavior change for environments without a
  replica.

## On-prem equivalent

See `docs/architecture/CONNECTION-BUDGET.md` for the streaming-replication
equivalent (a second `postgresql` sub-chart release / `readReplicas.replicaCount: 1`)
and the `DATABASE_REPLICA_URL` population convention for on-prem deployments.
