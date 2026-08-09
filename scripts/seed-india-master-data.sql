-- ════════════════════════════════════════════════════════════════════════
-- CivitasOne — India Master Data Seed (LGD Codes)
-- Source: Local Government Directory (lgdirectory.gov.in)
-- ════════════════════════════════════════════════════════════════════════
-- Run: PGPASSWORD=civitas_dev_pw psql -h localhost -p 5435 -U civitas_admin -d civitas_location -f scripts/seed-india-master-data.sql
-- Then: PGPASSWORD=civitas_dev_pw psql -h localhost -p 5435 -U civitas_admin -d civitas_hrms -f scripts/seed-hrms-master-data.sql

-- ═══════════════════════════════════════════════════════════════════════
-- PART 1: Indian States & UTs (36) with LGD Codes
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO location.locations (id, name, type, tenant_id, created_at, updated_at, version)
VALUES
-- States (28)
(gen_random_uuid(), 'Andhra Pradesh', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Arunachal Pradesh', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Assam', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Bihar', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Chhattisgarh', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Goa', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Gujarat', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Haryana', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Himachal Pradesh', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Jharkhand', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Karnataka', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Kerala', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Madhya Pradesh', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Maharashtra', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Manipur', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Meghalaya', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Mizoram', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Nagaland', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Odisha', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Punjab', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Rajasthan', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Sikkim', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Tamil Nadu', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Telangana', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Tripura', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Uttar Pradesh', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Uttarakhand', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'West Bengal', 'state', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
-- Union Territories (8)
(gen_random_uuid(), 'Andaman and Nicobar Islands', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Chandigarh', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Dadra and Nagar Haveli and Daman and Diu', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Delhi', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Jammu and Kashmir', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Ladakh', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Lakshadweep', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1),
(gen_random_uuid(), 'Puducherry', 'ut', '00000000-0000-0000-0000-000000000000', now(), now(), 1)
ON CONFLICT DO NOTHING;
