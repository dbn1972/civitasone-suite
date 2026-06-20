-- crm-service: deals + activities tables

CREATE TABLE IF NOT EXISTS crm.deals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
  stage        varchar(24)  NOT NULL DEFAULT 'Lead',
  value_minor  bigint       NOT NULL DEFAULT 0,
  currency     char(3)      NOT NULL DEFAULT 'INR',
  status       varchar(24)  NOT NULL DEFAULT 'active',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_deals_tenant ON crm.deals(tenant_id);

CREATE TABLE IF NOT EXISTS crm.activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  actor_name   varchar(200) NOT NULL,
  text         text NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_tenant ON crm.activities(tenant_id, created_at DESC);
