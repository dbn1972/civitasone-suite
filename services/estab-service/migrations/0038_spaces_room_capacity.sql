-- 0038_spaces_room_capacity.sql
-- DB backstop for room-allotment capacity (companion to uq_estab_active_seat_allotment,
-- which caps seats at one active allotment). Rooms allow up to `capacity` concurrent
-- active (allotted/occupied) allotments, so a partial-unique index cannot express it —
-- a BEFORE INSERT/UPDATE trigger counts active allotments and rejects overflow.
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION spaces.enforce_room_allotment_capacity()
RETURNS TRIGGER AS $$
DECLARE
  room_capacity INT;
  active_count  INT;
BEGIN
  IF NEW.target_type = 'room' AND NEW.status IN ('allotted','occupied') THEN
    SELECT capacity INTO room_capacity
      FROM spaces.estab_office_rooms
      WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id;

    -- Unknown room: leave FK / other guards to handle it.
    IF room_capacity IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO active_count
      FROM spaces.estab_space_allotments
      WHERE tenant_id   = NEW.tenant_id
        AND target_type = 'room'
        AND target_id   = NEW.target_id
        AND status      IN ('allotted','occupied')
        AND id <> NEW.id;

    IF active_count >= room_capacity THEN
      RAISE EXCEPTION 'room % is at capacity (%/%)', NEW.target_id, active_count, room_capacity
        USING ERRCODE = '23514', CONSTRAINT = 'chk_room_allotment_capacity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_room_allotment_capacity ON spaces.estab_space_allotments;
CREATE TRIGGER trg_enforce_room_allotment_capacity
  BEFORE INSERT OR UPDATE ON spaces.estab_space_allotments
  FOR EACH ROW EXECUTE FUNCTION spaces.enforce_room_allotment_capacity();
