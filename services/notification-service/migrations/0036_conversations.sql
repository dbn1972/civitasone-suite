-- G5: Conversation Thread Model
-- Purpose: proper conversation + message-per-conversation tables for omnichannel threading.
-- Rollback: DROP TABLE notification.conversation_messages; DROP TABLE notification.conversations;
-- Affected services: notification-service
SET lock_timeout = '5s';

-- ─── conversations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification.conversations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  channel            varchar(16) NOT NULL
                       CHECK (channel IN ('email','sms','whatsapp','webchat','voice')),
  contact_id         uuid NOT NULL,
  provider_thread_id varchar(256),
  subject            varchar(500),
  status             varchar(16) NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','closed','archived')),
  started_at         timestamptz NOT NULL DEFAULT now(),
  last_message_at    timestamptz,
  message_count      integer NOT NULL DEFAULT 0,
  closed_at          timestamptz,
  assigned_to        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant_contact_status
  ON notification.conversations (tenant_id, contact_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant_channel_provider
  ON notification.conversations (tenant_id, channel, provider_thread_id);

-- RLS
ALTER TABLE notification.conversations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'conversations' AND schemaname = 'notification' AND policyname = 'conversations_tenant_isolation'
  ) THEN
    CREATE POLICY conversations_tenant_isolation ON notification.conversations
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- GRANT
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_app') THEN
    GRANT SELECT, INSERT, UPDATE ON notification.conversations TO notification_app;
  END IF;
END $$;

-- ─── conversation_messages ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification.conversation_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  conversation_id     uuid NOT NULL REFERENCES notification.conversations(id),
  direction           varchar(8) NOT NULL
                        CHECK (direction IN ('inbound','outbound')),
  content_type        varchar(16) NOT NULL DEFAULT 'text'
                        CHECK (content_type IN ('text','media','template','system')),
  content             text,
  provider_message_id varchar(256),
  status              varchar(16) NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','delivered','read','failed')),
  sent_at             timestamptz NOT NULL DEFAULT now(),
  delivered_at        timestamptz,
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_messages_convo_sent
  ON notification.conversation_messages (conversation_id, sent_at);

-- RLS
ALTER TABLE notification.conversation_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'conversation_messages' AND schemaname = 'notification' AND policyname = 'conversation_messages_tenant_isolation'
  ) THEN
    CREATE POLICY conversation_messages_tenant_isolation ON notification.conversation_messages
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- GRANT
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_app') THEN
    GRANT SELECT, INSERT ON notification.conversation_messages TO notification_app;
  END IF;
END $$;
