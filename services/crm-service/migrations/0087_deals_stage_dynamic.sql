-- Purpose: OP-002 follow-through — crm.deals.stage can no longer be validated as one of
--   a fixed 5-value set now that pipelines (0015/0018, scoped further in 0086) let admins
--   define 3-10 arbitrary, per-pipeline stage names up to 100 chars each. Two DB-level
--   remnants of the old fixed vocabulary (added by 0014, back when validators.ts's
--   dealStage was `z.enum(["Lead","Proposal","Negotiation","Won","Lost"])`) would still
--   block or truncate real custom-pipeline stage names even after that zod enum itself is
--   relaxed to a dynamic, per-pipeline lookup (deals/routes.ts, stage-gate.ts::findStage):
--     1. deals_stage_check CHECK (stage IN ('Lead','Proposal','Negotiation','Won','Lost'))
--        — a static CHECK cannot express "must be one of THIS row's own pipeline's
--        configured stage names" (that requires reading crm.pipelines, which a CHECK
--        constraint cannot do), so real stage validity now belongs entirely to the
--        application layer (findStage against the deal's actual pipeline) — dropped.
--     2. stage varchar(24) — too narrow for a pipeline stage name, which is allowed up to
--        100 chars (pipelines/validators.ts's pipelineStageSchema). Widened to match.
-- Rollback: ALTER TABLE crm.deals ALTER COLUMN stage TYPE varchar(24);
--           ALTER TABLE crm.deals ADD CONSTRAINT deals_stage_check
--             CHECK (stage IN ('Lead','Proposal','Negotiation','Won','Lost')) NOT VALID;
--           NOTE: both are only safe to reverse before any deal is created/moved into a
--           custom-pipeline stage outside that 5-value set or longer than 24 chars — once
--           such rows exist, the CHECK re-add and/or the narrowing TYPE change will fail
--           (or truncate data) until those rows are migrated back to a legacy stage name.
-- Affected services: crm-service (deals module)
-- Sequencing: additive/loosening only — every existing row already satisfies both the
--   old CHECK and the old (narrower) length, so nothing needs a backfill.

SET lock_timeout = '5s';

ALTER TABLE crm.deals DROP CONSTRAINT IF EXISTS deals_stage_check;

ALTER TABLE crm.deals ALTER COLUMN stage TYPE varchar(100);
