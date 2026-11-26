-- 0062: Guest-house booking approval step + room directory support (GAP-ESTAB-GUESTHOUSE-01 /
-- GAP-ESTAB-GUESTHOUSE-NEW-01 backend).
--
-- Room bookings now start as 'pending' and an officer OTHER than the requester approves
-- ('confirmed') or rejects ('rejected'). The 0031 CHECK only admitted
-- booked/checked_in/checked_out/confirmed/cancelled/completed, so 'pending' and 'rejected' are added.
-- Decision audit columns are added to estab_room_bookings. Additive + idempotent; no data changes.
--
-- Rollback (only once no booking is 'pending'/'rejected'):
--   ALTER TABLE facilities.estab_room_bookings DROP CONSTRAINT IF EXISTS estab_room_bookings_status_check;
--   ALTER TABLE facilities.estab_room_bookings ADD CONSTRAINT estab_room_bookings_status_check
--     CHECK (status IN ('booked','checked_in','checked_out','confirmed','cancelled','completed'));
--   ALTER TABLE facilities.estab_room_bookings DROP COLUMN IF EXISTS decided_by,
--     DROP COLUMN IF EXISTS decided_at, DROP COLUMN IF EXISTS decision_reason;

SET lock_timeout = '5s';

ALTER TABLE facilities.estab_room_bookings ADD COLUMN IF NOT EXISTS decided_by uuid;
ALTER TABLE facilities.estab_room_bookings ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE facilities.estab_room_bookings ADD COLUMN IF NOT EXISTS decision_reason text;

ALTER TABLE facilities.estab_room_bookings DROP CONSTRAINT IF EXISTS estab_room_bookings_status_check;
ALTER TABLE facilities.estab_room_bookings
  ADD CONSTRAINT estab_room_bookings_status_check
  CHECK (status IN ('pending', 'booked', 'confirmed', 'checked_in', 'checked_out', 'rejected', 'cancelled', 'completed'));
