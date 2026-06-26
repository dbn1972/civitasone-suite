-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all estab-service tables that carry tenant_id.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- files.estab_files
ALTER TABLE files.estab_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_files;
CREATE POLICY tenant_isolation ON files.estab_files
  USING (tenant_id = current_tenant_id());

-- files.estab_notings
ALTER TABLE files.estab_notings ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_notings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_notings;
CREATE POLICY tenant_isolation ON files.estab_notings
  USING (tenant_id = current_tenant_id());

-- files.estab_dispatch
ALTER TABLE files.estab_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_dispatch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_dispatch;
CREATE POLICY tenant_isolation ON files.estab_dispatch
  USING (tenant_id = current_tenant_id());

-- files.estab_inward
ALTER TABLE files.estab_inward ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_inward FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_inward;
CREATE POLICY tenant_isolation ON files.estab_inward
  USING (tenant_id = current_tenant_id());

-- files.estab_file_movements
ALTER TABLE files.estab_file_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_file_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_file_movements;
CREATE POLICY tenant_isolation ON files.estab_file_movements
  USING (tenant_id = current_tenant_id());

-- files.estab_file_attachments
ALTER TABLE files.estab_file_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_file_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_file_attachments;
CREATE POLICY tenant_isolation ON files.estab_file_attachments
  USING (tenant_id = current_tenant_id());

-- committee.estab_committees
ALTER TABLE committee.estab_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_committees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_committees;
CREATE POLICY tenant_isolation ON committee.estab_committees
  USING (tenant_id = current_tenant_id());

-- committee.estab_meetings
ALTER TABLE committee.estab_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_meetings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_meetings;
CREATE POLICY tenant_isolation ON committee.estab_meetings
  USING (tenant_id = current_tenant_id());

-- committee.estab_resolutions
ALTER TABLE committee.estab_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_resolutions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_resolutions;
CREATE POLICY tenant_isolation ON committee.estab_resolutions
  USING (tenant_id = current_tenant_id());

-- committee.estab_attendees
ALTER TABLE committee.estab_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_attendees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_attendees;
CREATE POLICY tenant_isolation ON committee.estab_attendees
  USING (tenant_id = current_tenant_id());

-- committee.estab_compliance
ALTER TABLE committee.estab_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee.estab_compliance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON committee.estab_compliance;
CREATE POLICY tenant_isolation ON committee.estab_compliance
  USING (tenant_id = current_tenant_id());

-- assets.estab_vehicles
ALTER TABLE assets.estab_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets.estab_vehicles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assets.estab_vehicles;
CREATE POLICY tenant_isolation ON assets.estab_vehicles
  USING (tenant_id = current_tenant_id());

-- assets.estab_drivers
ALTER TABLE assets.estab_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets.estab_drivers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assets.estab_drivers;
CREATE POLICY tenant_isolation ON assets.estab_drivers
  USING (tenant_id = current_tenant_id());

-- assets.estab_vehicle_bookings
ALTER TABLE assets.estab_vehicle_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets.estab_vehicle_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assets.estab_vehicle_bookings;
CREATE POLICY tenant_isolation ON assets.estab_vehicle_bookings
  USING (tenant_id = current_tenant_id());

-- facilities.estab_guesthouses
ALTER TABLE facilities.estab_guesthouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_guesthouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_guesthouses;
CREATE POLICY tenant_isolation ON facilities.estab_guesthouses
  USING (tenant_id = current_tenant_id());

-- facilities.estab_rooms
ALTER TABLE facilities.estab_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_rooms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_rooms;
CREATE POLICY tenant_isolation ON facilities.estab_rooms
  USING (tenant_id = current_tenant_id());

-- facilities.estab_room_bookings
ALTER TABLE facilities.estab_room_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_room_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_room_bookings;
CREATE POLICY tenant_isolation ON facilities.estab_room_bookings
  USING (tenant_id = current_tenant_id());

-- facilities.estab_library_books
ALTER TABLE facilities.estab_library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_library_books FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_library_books;
CREATE POLICY tenant_isolation ON facilities.estab_library_books
  USING (tenant_id = current_tenant_id());

-- facilities.estab_issues
ALTER TABLE facilities.estab_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.estab_issues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON facilities.estab_issues;
CREATE POLICY tenant_isolation ON facilities.estab_issues
  USING (tenant_id = current_tenant_id());

-- legal.estab_court_cases
ALTER TABLE legal.estab_court_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.estab_court_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON legal.estab_court_cases;
CREATE POLICY tenant_isolation ON legal.estab_court_cases
  USING (tenant_id = current_tenant_id());

-- legal.estab_case_dates
ALTER TABLE legal.estab_case_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.estab_case_dates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON legal.estab_case_dates;
CREATE POLICY tenant_isolation ON legal.estab_case_dates
  USING (tenant_id = current_tenant_id());

-- legal.estab_rti_requests
ALTER TABLE legal.estab_rti_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.estab_rti_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON legal.estab_rti_requests;
CREATE POLICY tenant_isolation ON legal.estab_rti_requests
  USING (tenant_id = current_tenant_id());

-- _outbox.messages
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id());
