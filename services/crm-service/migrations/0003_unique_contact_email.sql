-- crm-service: deduplicate contacts and enforce unique email per tenant (P1-CRM-004)

-- Remove duplicates keeping the most recent row per (tenant_id, email)
DELETE FROM crm.contacts
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY tenant_id, email ORDER BY created_at DESC) AS rn
    FROM crm.contacts
    WHERE email IS NOT NULL
  ) t
  WHERE rn > 1
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE crm.contacts
  ADD CONSTRAINT uq_contacts_tenant_email UNIQUE (tenant_id, email);
