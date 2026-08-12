-- idempotent seed: two default categories that internal consumers hard-code
INSERT INTO register.asset_categories
  (id, tenant_id, name, code, dep_method, dep_rate, useful_life_years,
   created_by, updated_by, created_at, updated_at)
VALUES
  ('77777777-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'IT Equipment', 'IT', 'SLM', 33.33, 3,
   '00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000000',
   now(), now()),
  ('77777777-0001-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'Vehicle', 'VEH', 'WDV', 15.00, 7,
   '00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000000',
   now(), now())
ON CONFLICT (id) DO NOTHING;
