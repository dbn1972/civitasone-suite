-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: estab-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- assets.estab_vehicle_bookings.driver_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_vehicle_bookings_driver_id
  ON assets.estab_vehicle_bookings (driver_id);

-- files.estab_correspondence.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_correspondence_file_id
  ON files.estab_correspondence (file_id);

-- files.estab_file_puc.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_puc_file_id
  ON files.estab_file_puc (file_id);

-- files.estab_file_puc.correspondence_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_puc_correspondence_id
  ON files.estab_file_puc (correspondence_id);

-- files.estab_dfa.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_dfa_file_id
  ON files.estab_dfa (file_id);

-- files.estab_dfa.recipient_employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_dfa_recipient_employee_id
  ON files.estab_dfa (recipient_employee_id);

-- files.estab_dfa.dispatch_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_dfa_dispatch_id
  ON files.estab_dfa (dispatch_id);

-- files.estab_dfa_version.dfa_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_dfa_version_dfa_id
  ON files.estab_dfa_version (dfa_id);

-- files.estab_signature.subject_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_signature_subject_id
  ON files.estab_signature (subject_id);

-- files.estab_signature.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_signature_file_id
  ON files.estab_signature (file_id);

-- files.estab_signature.signer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_signature_signer_id
  ON files.estab_signature (signer_id);

-- facilities.estab_rooms.guesthouse_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_rooms_guesthouse_id
  ON facilities.estab_rooms (guesthouse_id);

-- facilities.estab_issues.book_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_issues_book_id
  ON facilities.estab_issues (book_id);

-- files.estab_files.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_files_department_id
  ON files.estab_files (department_id);

-- files.estab_files.inward_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_files_inward_id
  ON files.estab_files (inward_id);

-- files.estab_notings.officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_notings_officer_id
  ON files.estab_notings (officer_id);

-- files.estab_dispatch.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_dispatch_file_id
  ON files.estab_dispatch (file_id);

-- files.estab_inward.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_inward_file_id
  ON files.estab_inward (file_id);

-- files.estab_file_movements.from_officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_movements_from_officer_id
  ON files.estab_file_movements (from_officer_id);

-- files.estab_file_movements.to_officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_movements_to_officer_id
  ON files.estab_file_movements (to_officer_id);

-- files.estab_inward_movements.inward_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_inward_movements_inward_id
  ON files.estab_inward_movements (inward_id);

-- files.estab_charge_handover.from_officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_charge_handover_from_officer_id
  ON files.estab_charge_handover (from_officer_id);

-- files.estab_charge_handover.to_officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_charge_handover_to_officer_id
  ON files.estab_charge_handover (to_officer_id);

-- legal.estab_case_dates.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_case_dates_case_id
  ON legal.estab_case_dates (case_id);

-- files.estab_migration_register.efile_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_migration_register_efile_id
  ON files.estab_migration_register (efile_id);

-- files.estab_file_operator.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_operator_employee_id
  ON files.estab_file_operator (employee_id);

-- files.estab_file_operator.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_operator_department_id
  ON files.estab_file_operator (department_id);

-- files.estab_file_record.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_record_file_id
  ON files.estab_file_record (file_id);

-- files.estab_records_officer.operator_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_records_officer_operator_id
  ON files.estab_records_officer (operator_id);

-- files.estab_records_officer.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_records_officer_department_id
  ON files.estab_records_officer (department_id);

-- files.estab_annual_review.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_annual_review_file_id
  ON files.estab_annual_review (file_id);

-- files.estab_reference.file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_reference_file_id
  ON files.estab_reference (file_id);

-- files.estab_reference.note_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_reference_note_id
  ON files.estab_reference (note_id);

-- files.estab_reference.target_file_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_reference_target_file_id
  ON files.estab_reference (target_file_id);
