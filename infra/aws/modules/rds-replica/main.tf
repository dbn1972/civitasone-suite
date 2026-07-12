# SC-H2 / G9: RDS read-replica module — provisions a read-only PostgreSQL
# replica streaming from the fleet's primary RDS instance, so read traffic no
# longer depends entirely on the primary. Mirrors the sqs module's shape
# (variables -> resource(s) -> outputs, single main.tf, no submodules).
#
# The replica endpoint is exported for population into DATABASE_REPLICA_URL
# (see docs/architecture/CONNECTION-BUDGET.md), consumed opt-in by
# packages/db's dbForRead() — pool-tier reads only, primary is untouched.

variable "environment" {
  description = "Deployment environment (e.g. production)."
  type        = string
}

variable "db_identifier" {
  description = "Base identifier used to name the replica (e.g. \"civitasone\")."
  type        = string
  default     = "civitasone"
}

variable "primary_db_identifier" {
  description = "DB instance identifier (or ARN) of the existing primary RDS instance to replicate from."
  type        = string
}

variable "instance_class" {
  description = "Instance class for the replica. Defaults to a modest read-tier size; scale independently of the primary."
  type        = string
  default     = "db.t3.medium"
}

variable "availability_zone" {
  description = "AZ to place the replica in (leave empty to let AWS choose, typically a different AZ than the primary)."
  type        = string
  default     = ""
}

variable "storage_encrypted" {
  description = "Whether the replica's storage is encrypted. Must be true if the primary is encrypted."
  type        = bool
  default     = true
}

variable "kms_key_id" {
  description = "KMS key ARN for replica storage encryption (only used when replicating cross-region or re-encrypting; leave empty to inherit the primary's key for same-region replicas)."
  type        = string
  default     = ""
}

variable "vpc_security_group_ids" {
  description = "Security group IDs to attach to the replica. Defaults to the primary's own groups when left empty."
  type        = list(string)
  default     = []
}

variable "backup_retention_period" {
  description = "Backup retention in days for the replica. RDS read replicas default to 0 (no independent backups) unless promoted."
  type        = number
  default     = 0
}

variable "multi_az" {
  description = "Whether the replica itself is Multi-AZ. Usually false — the primary already provides HA."
  type        = bool
  default     = false
}

variable "apply_immediately" {
  description = "Apply modifications immediately instead of during the next maintenance window."
  type        = bool
  default     = false
}

variable "auto_minor_version_upgrade" {
  description = "Whether to auto-apply minor engine version upgrades to the replica."
  type        = bool
  default     = true
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights on the replica for read-load observability."
  type        = bool
  default     = true
}

resource "aws_db_instance" "replica" {
  identifier          = "${var.environment}-${var.db_identifier}-replica"
  replicate_source_db = var.primary_db_identifier
  instance_class      = var.instance_class

  # Req 7.1/7.3: never internet-reachable — read traffic only ever originates
  # from inside the VPC (services, via the opt-in dbForRead() Read_Router).
  publicly_accessible = false

  availability_zone      = var.availability_zone != "" ? var.availability_zone : null
  storage_encrypted      = var.storage_encrypted
  kms_key_id             = var.kms_key_id != "" ? var.kms_key_id : null
  vpc_security_group_ids = length(var.vpc_security_group_ids) > 0 ? var.vpc_security_group_ids : null

  backup_retention_period = var.backup_retention_period
  multi_az                = var.multi_az
  apply_immediately       = var.apply_immediately

  auto_minor_version_upgrade   = var.auto_minor_version_upgrade
  performance_insights_enabled = var.performance_insights_enabled

  skip_final_snapshot = true

  tags = {
    Environment = var.environment
    Role        = "read-replica"
    Source      = var.primary_db_identifier
  }
}

output "replica_endpoint" {
  description = "Host:port endpoint for the replica — populate DATABASE_REPLICA_URL with this."
  value       = aws_db_instance.replica.address
}

output "replica_arn" {
  value = aws_db_instance.replica.arn
}

output "replica_id" {
  value = aws_db_instance.replica.id
}
