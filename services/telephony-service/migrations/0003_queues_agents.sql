-- telephony-service: call queues + agent presence registry.
-- Applied with the telephony_svc role on civitas_telephony. Additive + idempotent.

CREATE TABLE IF NOT EXISTS telephony.queues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  name               varchar(120) NOT NULL,
  description        varchar(280),
  sla_answer_seconds integer NOT NULL DEFAULT 20,
  status             varchar(16) NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_queues_tenant ON telephony.queues(tenant_id);

CREATE TABLE IF NOT EXISTS telephony.agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  display_name varchar(160) NOT NULL,
  queue_id     uuid,
  status       varchar(16) NOT NULL DEFAULT 'offline',
  extension    varchar(16),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON telephony.agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant_queue ON telephony.agents(tenant_id, queue_id) WHERE queue_id IS NOT NULL;
-- One agent record per (tenant, platform user); backs the presence upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_tenant_user ON telephony.agents(tenant_id, user_id);
