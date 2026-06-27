-- Razorpay-specific columns on gateway_txns
ALTER TABLE payments.billing_gateway_txns ADD COLUMN IF NOT EXISTS razorpay_order_id text;
ALTER TABLE payments.billing_gateway_txns ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
ALTER TABLE payments.billing_gateway_txns ADD COLUMN IF NOT EXISTS razorpay_signature text;
ALTER TABLE payments.billing_gateway_txns ADD COLUMN IF NOT EXISTS webhook_verified boolean DEFAULT false;
ALTER TABLE payments.billing_gateway_txns ADD COLUMN IF NOT EXISTS failure_reason text;

-- Dunning tracking
CREATE TABLE IF NOT EXISTS payments.billing_dunning_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retrying','exhausted','recovered')),
  failure_reason text,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_dunning_tenant ON payments.billing_dunning_attempts(tenant_id, subscription_id);
