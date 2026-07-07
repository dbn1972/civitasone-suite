-- RLS completion: full tenant isolation (USING + WITH CHECK) for estab-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- assets.estab_drivers
ALTER TABLE assets.estab_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets.estab_drivers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON assets.estab_drivers;
DROP POLICY IF EXISTS tenant_isolation ON assets.estab_drivers;
CREATE POLICY tenant_isolation_policy ON assets.estab_drivers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- assets.estab_vehicle_bookings
ALTER TABLE assets.estab_vehicle_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets.estab_vehicle_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON assets.estab_vehicle_bookings;
DROP POLICY IF EXISTS tenant_isolation ON assets.estab_vehicle_bookings;
CREATE POLICY tenant_isolation_policy ON assets.estab_vehicle_bookings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- assets.estab_vehicles
ALTER TABLE assets.estab_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets.estab_vehicles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON assets.estab_vehicles;
DROP POLICY IF EXISTS tenant_isolation ON assets.estab_vehicles;
CREATE POLICY tenant_isolation_policy ON assets.estab_vehicles
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- committee.estab_attendees
ALTER TABLE committee.estab_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_attendees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON committee.estab_attendees;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_attendees;
CREATE POLICY tenant_isolation_policy ON committee.estab_attendees
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- committee.estab_committees
ALTER TABLE committee.estab_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_committees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON committee.estab_committees;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_committees;
CREATE POLICY tenant_isolation_policy ON committee.estab_committees
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- committee.estab_compliance
ALTER TABLE committee.estab_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_compliance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON committee.estab_compliance;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_compliance;
CREATE POLICY tenant_isolation_policy ON committee.estab_compliance
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- committee.estab_meetings
ALTER TABLE committee.estab_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_meetings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON committee.estab_meetings;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_meetings;
CREATE POLICY tenant_isolation_policy ON committee.estab_meetings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- committee.estab_resolutions
ALTER TABLE committee.estab_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_resolutions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON committee.estab_resolutions;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_resolutions;
CREATE POLICY tenant_isolation_policy ON committee.estab_resolutions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- facilities.estab_guesthouses
ALTER TABLE facilities.estab_guesthouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_guesthouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON facilities.estab_guesthouses;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_guesthouses;
CREATE POLICY tenant_isolation_policy ON facilities.estab_guesthouses
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- facilities.estab_issues
ALTER TABLE facilities.estab_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_issues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON facilities.estab_issues;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_issues;
CREATE POLICY tenant_isolation_policy ON facilities.estab_issues
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- facilities.estab_library_books
ALTER TABLE facilities.estab_library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_library_books FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON facilities.estab_library_books;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_library_books;
CREATE POLICY tenant_isolation_policy ON facilities.estab_library_books
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- facilities.estab_room_bookings
ALTER TABLE facilities.estab_room_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_room_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON facilities.estab_room_bookings;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_room_bookings;
CREATE POLICY tenant_isolation_policy ON facilities.estab_room_bookings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- facilities.estab_rooms
ALTER TABLE facilities.estab_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_rooms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON facilities.estab_rooms;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_rooms;
CREATE POLICY tenant_isolation_policy ON facilities.estab_rooms
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_annual_review
ALTER TABLE files.estab_annual_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_annual_review FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_annual_review;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_annual_review;
CREATE POLICY tenant_isolation_policy ON files.estab_annual_review
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_approval_rule
ALTER TABLE files.estab_approval_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_approval_rule FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_approval_rule;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_approval_rule;
CREATE POLICY tenant_isolation_policy ON files.estab_approval_rule
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_archival
ALTER TABLE files.estab_archival ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_archival FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_archival;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_archival;
CREATE POLICY tenant_isolation_policy ON files.estab_archival
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_charge_handover
ALTER TABLE files.estab_charge_handover ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_charge_handover FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_charge_handover;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_charge_handover;
CREATE POLICY tenant_isolation_policy ON files.estab_charge_handover
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_correspondence
ALTER TABLE files.estab_correspondence ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_correspondence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_correspondence;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_correspondence;
CREATE POLICY tenant_isolation_policy ON files.estab_correspondence
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_dfa
ALTER TABLE files.estab_dfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_dfa FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_dfa;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_dfa;
CREATE POLICY tenant_isolation_policy ON files.estab_dfa
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_dfa_template
ALTER TABLE files.estab_dfa_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_dfa_template FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_dfa_template;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_dfa_template;
CREATE POLICY tenant_isolation_policy ON files.estab_dfa_template
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_dfa_version
ALTER TABLE files.estab_dfa_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_dfa_version FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_dfa_version;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_dfa_version;
CREATE POLICY tenant_isolation_policy ON files.estab_dfa_version
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_dispatch
ALTER TABLE files.estab_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_dispatch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_dispatch;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_dispatch;
CREATE POLICY tenant_isolation_policy ON files.estab_dispatch
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_doc_seq
ALTER TABLE files.estab_doc_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_doc_seq FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_doc_seq;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_doc_seq;
CREATE POLICY tenant_isolation_policy ON files.estab_doc_seq
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_file_attachments
ALTER TABLE files.estab_file_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_file_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_file_attachments;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_file_attachments;
CREATE POLICY tenant_isolation_policy ON files.estab_file_attachments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_file_movements
ALTER TABLE files.estab_file_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_file_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_file_movements;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_file_movements;
CREATE POLICY tenant_isolation_policy ON files.estab_file_movements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_file_operator
ALTER TABLE files.estab_file_operator ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_file_operator FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_file_operator;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_file_operator;
CREATE POLICY tenant_isolation_policy ON files.estab_file_operator
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_file_puc
ALTER TABLE files.estab_file_puc ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_file_puc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_file_puc;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_file_puc;
CREATE POLICY tenant_isolation_policy ON files.estab_file_puc
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_file_record
ALTER TABLE files.estab_file_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_file_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_file_record;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_file_record;
CREATE POLICY tenant_isolation_policy ON files.estab_file_record
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_files
ALTER TABLE files.estab_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_files;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_files;
CREATE POLICY tenant_isolation_policy ON files.estab_files
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_inward
ALTER TABLE files.estab_inward ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_inward FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_inward;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_inward;
CREATE POLICY tenant_isolation_policy ON files.estab_inward
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_inward_movements
ALTER TABLE files.estab_inward_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_inward_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_inward_movements;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_inward_movements;
CREATE POLICY tenant_isolation_policy ON files.estab_inward_movements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_migration_register
ALTER TABLE files.estab_migration_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_migration_register FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_migration_register;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_migration_register;
CREATE POLICY tenant_isolation_policy ON files.estab_migration_register
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_notings
ALTER TABLE files.estab_notings ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_notings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_notings;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_notings;
CREATE POLICY tenant_isolation_policy ON files.estab_notings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_record_requisition
ALTER TABLE files.estab_record_requisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_record_requisition FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_record_requisition;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_record_requisition;
CREATE POLICY tenant_isolation_policy ON files.estab_record_requisition
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_records_officer
ALTER TABLE files.estab_records_officer ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_records_officer FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_records_officer;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_records_officer;
CREATE POLICY tenant_isolation_policy ON files.estab_records_officer
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_reference
ALTER TABLE files.estab_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_reference FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_reference;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_reference;
CREATE POLICY tenant_isolation_policy ON files.estab_reference
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_sign_config
ALTER TABLE files.estab_sign_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_sign_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_sign_config;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_sign_config;
CREATE POLICY tenant_isolation_policy ON files.estab_sign_config
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_signature
ALTER TABLE files.estab_signature ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_signature FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_signature;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_signature;
CREATE POLICY tenant_isolation_policy ON files.estab_signature
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.estab_weedout
ALTER TABLE files.estab_weedout ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_weedout FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_weedout;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_weedout;
CREATE POLICY tenant_isolation_policy ON files.estab_weedout
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- legal.estab_case_dates
ALTER TABLE legal.estab_case_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.estab_case_dates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON legal.estab_case_dates;
DROP POLICY IF EXISTS tenant_isolation ON legal.estab_case_dates;
CREATE POLICY tenant_isolation_policy ON legal.estab_case_dates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- legal.estab_court_cases
ALTER TABLE legal.estab_court_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.estab_court_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON legal.estab_court_cases;
DROP POLICY IF EXISTS tenant_isolation ON legal.estab_court_cases;
CREATE POLICY tenant_isolation_policy ON legal.estab_court_cases
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- legal.estab_rti_requests
ALTER TABLE legal.estab_rti_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.estab_rti_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON legal.estab_rti_requests;
DROP POLICY IF EXISTS tenant_isolation ON legal.estab_rti_requests;
CREATE POLICY tenant_isolation_policy ON legal.estab_rti_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END $$;
