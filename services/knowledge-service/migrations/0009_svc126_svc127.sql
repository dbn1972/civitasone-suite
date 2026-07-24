-- SVC-126 governed policy/SOP/circular lifecycle + SVC-127 FAQ / virtual assistant / guided support.
-- Additive, idempotent. Applied with knowledge_svc on civitas_knowledge.
SET lock_timeout = '5s';

-- ── SVC-126: governed policy documents ─────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge.policy_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  doc_type        varchar(16) NOT NULL DEFAULT 'sop',
  reference_no    varchar(64),
  title           varchar(200) NOT NULL,
  body            text NOT NULL DEFAULT '',
  status          varchar(16) NOT NULL DEFAULT 'draft',
  author_id       uuid NOT NULL,
  reviewer_id     uuid,
  approver_id     uuid,
  effective_date  date,
  review_due_date date,
  supersedes_id   uuid,
  version         integer NOT NULL DEFAULT 1,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  CONSTRAINT policy_documents_doc_type_chk CHECK (doc_type IN ('sop','policy','circular')),
  CONSTRAINT policy_documents_status_chk CHECK (status IN ('draft','under_review','approved','published','superseded','withdrawn'))
);
CREATE INDEX IF NOT EXISTS idx_policy_documents_tenant ON knowledge.policy_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_policy_documents_status ON knowledge.policy_documents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_policy_documents_review_due ON knowledge.policy_documents(tenant_id, review_due_date) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_policy_documents_supersedes ON knowledge.policy_documents(supersedes_id);

CREATE TABLE IF NOT EXISTS knowledge.policy_acknowledgements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  policy_id       uuid NOT NULL,
  employee_id     uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  note            varchar(500),
  CONSTRAINT policy_ack_unique UNIQUE (policy_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_policy_ack_tenant ON knowledge.policy_acknowledgements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_policy_ack_policy ON knowledge.policy_acknowledgements(policy_id);

-- ── SVC-127: FAQ store ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge.faqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  question    varchar(500) NOT NULL,
  answer      text NOT NULL,
  category    varchar(64),
  tags        text[] NOT NULL DEFAULT '{}',
  status      varchar(16) NOT NULL DEFAULT 'published',
  view_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  CONSTRAINT faqs_status_chk CHECK (status IN ('draft','published','archived'))
);
CREATE INDEX IF NOT EXISTS idx_faqs_tenant ON knowledge.faqs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_faqs_category ON knowledge.faqs(tenant_id, category);

-- ── SVC-127: guided support flows ──────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge.guided_flows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  title       varchar(200) NOT NULL,
  description varchar(1000),
  category    varchar(64),
  steps       jsonb NOT NULL DEFAULT '[]',
  status      varchar(16) NOT NULL DEFAULT 'published',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  CONSTRAINT guided_flows_status_chk CHECK (status IN ('draft','published','archived'))
);
CREATE INDEX IF NOT EXISTS idx_guided_flows_tenant ON knowledge.guided_flows(tenant_id);

-- ── SVC-127: assistant interactions (deflection metrics) ───────────
CREATE TABLE IF NOT EXISTS knowledge.assistant_interactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  question    varchar(1000) NOT NULL,
  answer      text,
  answered    boolean NOT NULL DEFAULT false,
  escalated   boolean NOT NULL DEFAULT false,
  citations   jsonb NOT NULL DEFAULT '[]',
  ticket_ref  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_interactions_tenant ON knowledge.assistant_interactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assistant_interactions_created ON knowledge.assistant_interactions(tenant_id, created_at);
