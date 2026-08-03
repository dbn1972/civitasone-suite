-- 0040: FORCE RLS on fleet + quarters tenant tables.
-- 0035/0036 enabled RLS + policies but omitted FORCE ROW LEVEL SECURITY, so
-- table-owner roles could bypass tenant isolation. Additive + idempotent.
-- Rollback: ALTER TABLE ... NO FORCE ROW LEVEL SECURITY; (keeps ENABLE + policies)

SET lock_timeout = '5s';

ALTER TABLE quarters.estab_quarters FORCE ROW LEVEL SECURITY;
ALTER TABLE quarters.estab_quarter_allotments FORCE ROW LEVEL SECURITY;
ALTER TABLE quarters.estab_licence_fee_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE quarters.estab_overstay_penalties FORCE ROW LEVEL SECURITY;

ALTER TABLE fleet.fuel_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.trip_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.vehicle_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.driver_roster FORCE ROW LEVEL SECURITY;
