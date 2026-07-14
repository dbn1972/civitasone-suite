# ECS Service Auto Scaling module (G9 / Req 9.4) — SCAFFOLD

**Status: design scaffold only. No Terraform resources exist in this
directory yet.** AWS production in this repo is currently deployed via
`infra/docker-compose.prod.yml`, not ECS/EKS — the `module "ecs"` composition
slot is still commented out in `infra/aws/envs/production/main.tf`:

```hcl
# Module composition — expand per sprint
# module "alb"          { source = "../../modules/alb" }
# module "ecs"          { source = "../../modules/ecs" }
# module "rds"          { source = "../../modules/rds" }
# module "elasticache"  { source = "../../modules/elasticache" }
# module "s3"           { source = "../../modules/s3" }
```

This document describes the target-tracking Auto Scaling policy this module
will provision for Tier-0/Tier-1 services **once that `module "ecs"` slot is
filled in**, so the AWS-side equivalent of the on-prem Helm chart's default
autoscaling (task 12.1 / Req 9.1–9.3) is designed up front and wired in
without redesign later. Writing real `.tf` here now would reference an
`aws_ecs_service` that does not exist in this codebase — this scaffold exists
so that gap isn't silently unaddressed (Req 9.4).

## Intended resource shape

Once an ECS service module exists (`infra/aws/modules/ecs/`, exporting an
`aws_ecs_service` per CivitasOne microservice), this module will provision,
**per Tier-0/Tier-1 service**, the standard two-resource ECS Service Auto
Scaling pair:

```hcl
resource "aws_appautoscaling_target" "this" {
  for_each           = var.services   # map of Tier-0/Tier-1 service name -> config
  max_capacity       = each.value.max_task_count
  min_capacity       = each.value.min_task_count
  resource_id        = "service/${var.cluster_name}/${each.key}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = var.services
  name               = "${each.key}-cpu-target-tracking"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[each.key].resource_id
  scalable_dimension  = aws_appautoscaling_target.this[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.this[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = each.value.target_cpu_percent
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
```

This mirrors the on-prem `HorizontalPodAutoscaler`'s CPU-utilization
target-tracking shape (`templates/hpa.yaml`) one-for-one:
`aws_appautoscaling_target.{min,max}_capacity` ↔ HPA `minReplicas`/
`maxReplicas`, and the `ECSServiceAverageCPUUtilization` target-tracking
policy ↔ the HPA's `Resource` metric on `cpu` / `averageUtilization`.

## Per-service parameters — platform parity with the on-prem Helm chart

Task 12.1 adds a per-service `autoscaling: { enabled, minReplicas,
maxReplicas, targetCPUUtilizationPercentage }` override block to
`infra/onprem/helm/civitasone/values.yaml` for each Tier-0/Tier-1 service
identified in `docs/operations/SLO-SLI-RUNBOOKS.md` §3 (gateway, identity,
queue = Tier 0; finance, estab, workflow, hrms, payroll, audit = Tier 1).
**This module's `var.services` map is intended to be populated from those
exact same per-service values** — `min_task_count` = `minReplicas`,
`max_task_count` = `maxReplicas`, `target_cpu_percent` =
`targetCPUUtilizationPercentage` — so a given service scales to the same
effective capacity range and CPU threshold whether it's deployed on-prem or
on AWS ECS (Req 9.4's "equivalent autoscaling configuration"). There is no
separate SLO derivation step here: this module is a pass-through of the
Helm chart's per-service autoscaling block, keeping `values.yaml` the single
source of truth for the actual numbers so the two topologies never drift.

Proposed initial values (to be confirmed against task 12.1's landed
`values.yaml` overrides before this module is implemented) — Tier-0
services get a lower target CPU threshold to react faster given their
tighter latency SLOs (§3), Tier-1 a slightly higher one:

| Service | Tier | Current fixed replicas (`values.yaml`) | `min_task_count` | `max_task_count` | `target_cpu_percent` |
|---|---|---|---|---|---|
| gateway | 0 | 2 | 2 | 8 | 65 |
| identity | 0 | 2 | 2 | 8 | 65 |
| queue | 0 | 2 | 2 | 8 | 65 |
| finance | 1 | 2 | 2 | 6 | 70 |
| estab | 1 | 1 | 2 | 6 | 70 |
| workflow | 1 | 2 | 2 | 6 | 70 |
| hrms | 1 | 2 | 2 | 6 | 70 |
| payroll | 1 | 1 | 2 | 6 | 70 |
| audit | 1 | 2 | 2 | 6 | 70 |

Every other service is intentionally **not** included in `var.services` —
it keeps its fixed ECS `desired_count` (no Application Auto Scaling target
attached), matching the on-prem chart's unchanged `autoscaling.enabled:
false` default for non-Tier-0/1 services (Req 9.3).

## Usage (once the ECS module exists)

```hcl
module "ecs_autoscaling" {
  source       = "../../modules/ecs-autoscaling"
  cluster_name = module.ecs.cluster_name
  services     = {
    gateway  = { min_task_count = 2, max_task_count = 8, target_cpu_percent = 65 }
    identity = { min_task_count = 2, max_task_count = 8, target_cpu_percent = 65 }
    queue    = { min_task_count = 2, max_task_count = 8, target_cpu_percent = 65 }
    finance  = { min_task_count = 2, max_task_count = 6, target_cpu_percent = 70 }
    estab    = { min_task_count = 2, max_task_count = 6, target_cpu_percent = 70 }
    workflow = { min_task_count = 2, max_task_count = 6, target_cpu_percent = 70 }
    hrms     = { min_task_count = 2, max_task_count = 6, target_cpu_percent = 70 }
    payroll  = { min_task_count = 2, max_task_count = 6, target_cpu_percent = 70 }
    audit    = { min_task_count = 2, max_task_count = 6, target_cpu_percent = 70 }
  }

  depends_on = [module.ecs]
}
```

Then uncomment `module "ecs"` (and this `module "ecs_autoscaling"` block)
in `infra/aws/envs/production/main.tf`.

## Non-goals of this scaffold

- Does **not** provision the ECS cluster, task definitions, or services
  themselves — that's `infra/aws/modules/ecs/` (not yet implemented).
- Does **not** change the current `infra/docker-compose.prod.yml`-based AWS
  deployment. Compose has no native equivalent to Application Auto Scaling;
  this module only becomes wireable once the ECS module lands.
- Does **not** duplicate the on-prem HPA's `minReplicas`/`maxReplicas`/
  `targetCPUUtilizationPercentage` values independently — see "Per-service
  parameters" above for why `values.yaml` stays the single source of truth.
