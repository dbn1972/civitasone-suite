-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: estab-service

SET lock_timeout = '5s';

-- ============================================================================
-- files.estab_files.status
-- Valid states: draft, active, closed, transferred, archived
-- (inline CHECK in 0001 uses draft/active/closed/archived)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_files
    ADD CONSTRAINT estab_files_status_check
    CHECK (status IN ('draft', 'active', 'closed', 'transferred', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_notings.note_status
-- Valid states: draft, submitted, approved, returned, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_notings
    ADD CONSTRAINT estab_notings_note_status_check
    CHECK (note_status IN ('draft', 'submitted', 'approved', 'returned', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_dispatch.status
-- Valid states: pending (schema default), sent (consumer.ts on dispatch create)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_dispatch
    ADD CONSTRAINT estab_dispatch_status_check
    CHECK (status IN ('pending', 'sent'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_dispatch.delivery_status
-- Valid states: sent, delivered, returned, failed (validators.ts deliveryUpdateBody enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_dispatch
    ADD CONSTRAINT estab_dispatch_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'returned', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_inward.status
-- Valid states: received, acknowledged, file_opened, attached, detached
-- (consumer.ts sets "file_opened" when a file is opened from/linked to a DAK)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_inward
    ADD CONSTRAINT estab_inward_status_check
    CHECK (status IN ('received', 'acknowledged', 'file_opened', 'attached', 'detached'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- facilities.estab_guesthouses.status
-- Valid states: active, inactive, under_maintenance
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE facilities.estab_guesthouses
    ADD CONSTRAINT estab_guesthouses_status_check
    CHECK (status IN ('active', 'inactive', 'under_maintenance'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- facilities.estab_rooms.status
-- Valid states: available, occupied, under_maintenance, blocked
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE facilities.estab_rooms
    ADD CONSTRAINT estab_rooms_status_check
    CHECK (status IN ('available', 'occupied', 'under_maintenance', 'blocked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- facilities.estab_room_bookings.status
-- Valid states: booked, checked_in, checked_out, confirmed, cancelled, completed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE facilities.estab_room_bookings
    ADD CONSTRAINT estab_room_bookings_status_check
    CHECK (status IN ('booked', 'checked_in', 'checked_out', 'confirmed', 'cancelled', 'completed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- facilities.estab_issues.status (library issuances)
-- Valid states: issued, returned, overdue, lost
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE facilities.estab_issues
    ADD CONSTRAINT estab_issues_status_check
    CHECK (status IN ('issued', 'returned', 'overdue', 'lost'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- assets.estab_vehicles.status
-- Valid states: available, allocated, in_use, under_maintenance, condemned, retired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE assets.estab_vehicles
    ADD CONSTRAINT estab_vehicles_status_check
    CHECK (status IN ('available', 'allocated', 'in_use', 'under_maintenance', 'condemned', 'retired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- assets.estab_drivers.status
-- Valid states: active, inactive, suspended
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE assets.estab_drivers
    ADD CONSTRAINT estab_drivers_status_check
    CHECK (status IN ('active', 'inactive', 'suspended'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- assets.estab_vehicle_bookings.status
-- Valid states: pending, approved, in_use, returned, cancelled
-- (inline CHECK in 0001)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE assets.estab_vehicle_bookings
    ADD CONSTRAINT estab_vehicle_bookings_status_check
    CHECK (status IN ('pending', 'approved', 'in_use', 'returned', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- committee.estab_committees.status
-- Valid states: active, dissolved
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE committee.estab_committees
    ADD CONSTRAINT estab_committees_status_check
    CHECK (status IN ('active', 'dissolved'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- committee.estab_meetings.status
-- Valid states: scheduled, held, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE committee.estab_meetings
    ADD CONSTRAINT estab_meetings_status_check
    CHECK (status IN ('scheduled', 'held', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- committee.estab_resolutions.status (action items)
-- Valid states: pending, in_progress, completed, overdue
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE committee.estab_resolutions
    ADD CONSTRAINT estab_resolutions_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- committee.estab_compliance.status
-- Valid states: pending, complied, overdue, not_applicable
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE committee.estab_compliance
    ADD CONSTRAINT estab_compliance_status_check
    CHECK (status IN ('pending', 'complied', 'overdue', 'not_applicable'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- legal.estab_court_cases.status
-- Valid states: pending, disposed, appealed, stayed, hearing, reserved, decided, closed
-- (inline CHECK in 0001 uses pending/disposed/appealed/stayed)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE legal.estab_court_cases
    ADD CONSTRAINT estab_court_cases_status_check
    CHECK (status IN ('pending', 'disposed', 'appealed', 'stayed', 'hearing', 'reserved', 'decided', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- legal.estab_rti_requests.status
-- Valid states: pending, responded, appealed, overdue, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE legal.estab_rti_requests
    ADD CONSTRAINT estab_rti_requests_status_check
    CHECK (status IN ('pending', 'responded', 'appealed', 'overdue', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_weedout.status (disposal proposals)
-- Valid states: proposed, approved, rejected, destroyed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_weedout
    ADD CONSTRAINT estab_weedout_status_check
    CHECK (status IN ('proposed', 'approved', 'rejected', 'destroyed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_archival.status (archival transfers)
-- Valid states: archived, nai_due, nai_transferred (records/consumer.ts:
-- archive sets "nai_due" when 25y-eligible else "archived"; NAI transfer
-- callback sets "nai_transferred")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_archival
    ADD CONSTRAINT estab_archival_status_check
    CHECK (status IN ('archived', 'nai_due', 'nai_transferred'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- files.estab_dfa.status
-- Valid states from dfa/consumer.ts transition table: draft, pending_approval,
-- signed, returned, approved, dispatched
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE files.estab_dfa
    ADD CONSTRAINT estab_dfa_status_check
    CHECK (status IN ('draft', 'pending_approval', 'signed', 'returned', 'approved', 'dispatched'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE files.estab_files VALIDATE CONSTRAINT estab_files_status_check;
ALTER TABLE files.estab_notings VALIDATE CONSTRAINT estab_notings_note_status_check;
ALTER TABLE files.estab_dispatch VALIDATE CONSTRAINT estab_dispatch_status_check;
ALTER TABLE files.estab_dispatch VALIDATE CONSTRAINT estab_dispatch_delivery_status_check;
ALTER TABLE files.estab_inward VALIDATE CONSTRAINT estab_inward_status_check;
ALTER TABLE facilities.estab_guesthouses VALIDATE CONSTRAINT estab_guesthouses_status_check;
ALTER TABLE facilities.estab_rooms VALIDATE CONSTRAINT estab_rooms_status_check;
ALTER TABLE facilities.estab_room_bookings VALIDATE CONSTRAINT estab_room_bookings_status_check;
ALTER TABLE facilities.estab_issues VALIDATE CONSTRAINT estab_issues_status_check;
ALTER TABLE assets.estab_vehicles VALIDATE CONSTRAINT estab_vehicles_status_check;
ALTER TABLE assets.estab_drivers VALIDATE CONSTRAINT estab_drivers_status_check;
ALTER TABLE assets.estab_vehicle_bookings VALIDATE CONSTRAINT estab_vehicle_bookings_status_check;
ALTER TABLE committee.estab_committees VALIDATE CONSTRAINT estab_committees_status_check;
ALTER TABLE committee.estab_meetings VALIDATE CONSTRAINT estab_meetings_status_check;
ALTER TABLE committee.estab_resolutions VALIDATE CONSTRAINT estab_resolutions_status_check;
ALTER TABLE committee.estab_compliance VALIDATE CONSTRAINT estab_compliance_status_check;
ALTER TABLE legal.estab_court_cases VALIDATE CONSTRAINT estab_court_cases_status_check;
ALTER TABLE legal.estab_rti_requests VALIDATE CONSTRAINT estab_rti_requests_status_check;
ALTER TABLE files.estab_weedout VALIDATE CONSTRAINT estab_weedout_status_check;
ALTER TABLE files.estab_archival VALIDATE CONSTRAINT estab_archival_status_check;
ALTER TABLE files.estab_dfa VALIDATE CONSTRAINT estab_dfa_status_check;
