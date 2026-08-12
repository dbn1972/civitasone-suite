BEGIN;

CREATE TABLE IF NOT EXISTS learning.training_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  title          text NOT NULL,
  plan_year      integer NOT NULL,
  department_id  uuid,
  role_code      varchar(64),
  status         varchar(16) NOT NULL DEFAULT 'draft',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS learning.training_plan_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  plan_id      uuid NOT NULL REFERENCES learning.training_plans(id) ON DELETE CASCADE,
  course_id    uuid,
  training_id  uuid,
  target_date  text,
  mandatory    integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_plans_tenant   ON learning.training_plans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_plans_year     ON learning.training_plans(tenant_id, plan_year);
CREATE INDEX IF NOT EXISTS idx_training_plan_items_plan ON learning.training_plan_items(tenant_id, plan_id);

-- RLS
ALTER TABLE learning.training_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.training_plan_items  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_plans' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON learning.training_plans
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_plan_items' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON learning.training_plan_items
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

COMMIT;
