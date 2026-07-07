-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: estab-service

SET lock_timeout = '5s';

-- ============================================================================
-- files.estab_notings.note_type
-- Valid states: yellow, green, remark, order
-- (domain.ts NOTE_TYPES; validators.ts addNotingBody.noteType enum; consumer.ts
-- sets "yellow" on create, "green" on approval)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_notings
    ADD CONSTRAINT estab_notings_note_type_check
    CHECK (note_type IN ('yellow', 'green', 'remark', 'order'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_file_attachments.file_type
-- SKIPPED: this column stores a free-form MIME type (e.g. "application/pdf",
-- "image/png") supplied by the uploading client (validators.ts addAttachmentBody
-- .fileType: z.string().default("application/pdf")). No fixed enumeration of
-- MIME types is imposed anywhere in the codebase — a CHECK constraint would
-- reject legitimate file types. Not constrained.
-- ============================================================================

-- ============================================================================
-- assets.estab_vehicles.fuel_type
-- Valid states: petrol, diesel, cng, ev
-- (validators.ts createVehicleBody.fuelType enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE assets.estab_vehicles
    ADD CONSTRAINT estab_vehicles_fuel_type_check
    CHECK (fuel_type IN ('petrol', 'diesel', 'cng', 'ev'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- facilities.estab_rooms.type
-- Valid states: standard, suite, meeting
-- (migration 0001_init.sql column comment: "standard|suite|meeting"; no
-- room-create command/route exists in this module — rooms are provisioned via
-- seed/migration only, so the init-migration comment is the source of truth)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE facilities.estab_rooms
    ADD CONSTRAINT estab_rooms_type_check
    CHECK (type IN ('standard', 'suite', 'meeting'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_approval_rule.source_type
-- Valid states: finance_sanction, finance_payment, finance_reappropriation,
-- procurement_award, procurement_po, hr_promotion, hr_transfer,
-- hr_disciplinary, hr_leave_special, hr_recruitment, grant_scheme,
-- grant_disbursement, asset_disposal, legal_opinion, contract_award
-- (@civitasone/eoffice-sdk contracts.ts SOURCE_REF_TYPES; validators.ts
-- createApprovalRuleBody.sourceType enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_approval_rule
    ADD CONSTRAINT estab_approval_rule_source_type_check
    CHECK (source_type IN (
      'finance_sanction', 'finance_payment', 'finance_reappropriation',
      'procurement_award', 'procurement_po',
      'hr_promotion', 'hr_transfer', 'hr_disciplinary', 'hr_leave_special', 'hr_recruitment',
      'grant_scheme', 'grant_disbursement',
      'asset_disposal', 'legal_opinion', 'contract_award'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_dfa.communication_type
-- Valid states: letter, order, memo, notification, circular, do_letter
-- (validators.ts COMMUNICATION_TYPES enum, shared by createDfaBody/updateDfaBody)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_dfa
    ADD CONSTRAINT estab_dfa_communication_type_check
    CHECK (communication_type IN ('letter', 'order', 'memo', 'notification', 'circular', 'do_letter'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_dfa_template.communication_type
-- Valid states: letter, order, memo, notification, circular, do_letter
-- (same COMMUNICATION_TYPES enum as estab_dfa; templates use the same taxonomy)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_dfa_template
    ADD CONSTRAINT estab_dfa_template_communication_type_check
    CHECK (communication_type IN ('letter', 'order', 'memo', 'notification', 'circular', 'do_letter'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_charge_handover.status
-- Valid states: pending, completed
-- (consumer.ts inserts "pending" then updates to "completed"; validators.ts
-- listHandoverQuery.status enum confirms the same two states)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_charge_handover
    ADD CONSTRAINT estab_charge_handover_status_check
    CHECK (status IN ('pending', 'completed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_migration_register.status
-- Valid states: registered, digitised, linked
-- (validators.ts listMigrationQuery.status enum; consumer.ts sets "registered"
-- or "digitised" on register, "linked" on link)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_migration_register
    ADD CONSTRAINT estab_migration_register_status_check
    CHECK (status IN ('registered', 'digitised', 'linked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE files.estab_notings VALIDATE CONSTRAINT estab_notings_note_type_check;
ALTER TABLE assets.estab_vehicles VALIDATE CONSTRAINT estab_vehicles_fuel_type_check;
ALTER TABLE facilities.estab_rooms VALIDATE CONSTRAINT estab_rooms_type_check;
ALTER TABLE files.estab_approval_rule VALIDATE CONSTRAINT estab_approval_rule_source_type_check;
ALTER TABLE files.estab_dfa VALIDATE CONSTRAINT estab_dfa_communication_type_check;
ALTER TABLE files.estab_dfa_template VALIDATE CONSTRAINT estab_dfa_template_communication_type_check;
ALTER TABLE files.estab_charge_handover VALIDATE CONSTRAINT estab_charge_handover_status_check;
ALTER TABLE files.estab_migration_register VALIDATE CONSTRAINT estab_migration_register_status_check;
