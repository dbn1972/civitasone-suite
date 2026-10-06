-- Purpose: F4 money follow-ups.
--   F4-01 Quotation tax totals: crm.quotations gains tax_minor + grand_total_minor
--     (bigint MINOR units / paise). total_minor keeps its NET (pre-tax) meaning;
--     grand_total_minor = total_minor + tax_minor. crm.orders gains grand_total_minor
--     so an order carries the tax-inclusive figure.
--   F4-02 HSN/SAC + GST split: crm.products gains hsn_sac (4-8 digits, validated in
--     the app at the zod boundary); crm.quotations gains place_of_supply +
--     supplier_state (Indian state codes) so each line's tax can be split CGST/SGST
--     (intra-state) or IGST (inter-state) at read time.
--   All money is bigint MINOR units. No float ever touches a money value.
-- Rollback:
--   ALTER TABLE crm.quotations DROP COLUMN IF EXISTS tax_minor, DROP COLUMN IF EXISTS grand_total_minor,
--     DROP COLUMN IF EXISTS place_of_supply, DROP COLUMN IF EXISTS supplier_state;
--   ALTER TABLE crm.orders DROP COLUMN IF EXISTS grand_total_minor;
--   ALTER TABLE crm.products DROP COLUMN IF EXISTS hsn_sac;
-- Affected services: crm-service (quotations, products modules)

SET lock_timeout = '5s';

-- F4-01: net stays on total_minor; tax + grand total are additive, default 0 so
-- existing rows and older write paths remain valid (grand_total == net when tax is 0).
ALTER TABLE crm.quotations
  ADD COLUMN IF NOT EXISTS tax_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE crm.quotations
  ADD COLUMN IF NOT EXISTS place_of_supply varchar(2),
  ADD COLUMN IF NOT EXISTS supplier_state varchar(2);

DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotations_tax_minor_nonneg'
  ) THEN
    ALTER TABLE crm.quotations ADD CONSTRAINT quotations_tax_minor_nonneg CHECK (tax_minor >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotations_grand_total_minor_nonneg'
  ) THEN
    ALTER TABLE crm.quotations ADD CONSTRAINT quotations_grand_total_minor_nonneg CHECK (grand_total_minor >= 0);
  END IF;
END $c$;

-- F4-01: order carries the tax-inclusive grand total alongside its (net) total_minor.
ALTER TABLE crm.orders
  ADD COLUMN IF NOT EXISTS grand_total_minor bigint NOT NULL DEFAULT 0;

DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_grand_total_minor_nonneg'
  ) THEN
    ALTER TABLE crm.orders ADD CONSTRAINT orders_grand_total_minor_nonneg CHECK (grand_total_minor >= 0);
  END IF;
END $c$;

-- F4-02: optional HSN (goods) / SAC (services) classification code on a product.
-- 4-8 digits is enforced in the zod boundary; a loose length check guards the column.
ALTER TABLE crm.products
  ADD COLUMN IF NOT EXISTS hsn_sac varchar(8);

DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_hsn_sac_digits'
  ) THEN
    ALTER TABLE crm.products ADD CONSTRAINT products_hsn_sac_digits
      CHECK (hsn_sac IS NULL OR hsn_sac ~ '^[0-9]{4,8}$');
  END IF;
END $c$;

-- MIGRATION NOTE (currency allow-list): the API now accepts only INR/USD/EUR/GBP/AED
-- on products, price books and quotations (ALLOWED_CURRENCIES). The dev database
-- holds INR only, so nothing is orphaned there. Before deploying to any other
-- environment, run as a superuser (RLS applies to crm_svc):
--   SELECT 'products' t, currency, count(*) FROM crm.products
--    WHERE currency NOT IN ('INR','USD','EUR','GBP','AED') GROUP BY 2
--   UNION ALL SELECT 'price_books', currency, count(*) FROM crm.price_books
--    WHERE currency NOT IN ('INR','USD','EUR','GBP','AED') GROUP BY 2
--   UNION ALL SELECT 'quotations', currency, count(*) FROM crm.quotations
--    WHERE currency NOT IN ('INR','USD','EUR','GBP','AED') GROUP BY 2;
-- Rows with another code become un-PATCHable (422) until the list is widened.

-- The backfills below run as the table owner (crm_svc) with no app.tenant_id
-- GUC. quotations and orders are FORCE ROW LEVEL SECURITY (0030, 0066), so a
-- bare UPDATE matches 0 rows and silently backfills nothing. Lift FORCE for
-- the duration of the three UPDATEs only (line items too: the first UPDATE reads
-- them in a subquery and would see 0 rows), then restore it (same pattern as
-- 0032/0092). ALTER ... NO FORCE / FORCE is itself idempotent.
ALTER TABLE crm.quotations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.orders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.quotation_line_items NO FORCE ROW LEVEL SECURITY;

-- Backfill (idempotent: touches only rows still at the column default 0).
-- Existing quotations: tax recomputed from their stored line items with the
-- SAME rounding as quotation-domain lineTaxMinor, (net*bps + 5000) / 10000 per
-- line, integer division. numeric + div() avoids bigint overflow on large
-- lines. A quotation with no stored line items keeps tax 0 and grand = net.
UPDATE crm.quotations q
SET tax_minor         = t.tax_minor,
    grand_total_minor = q.total_minor + t.tax_minor
FROM (
  SELECT li.tenant_id, li.quotation_id,
         SUM(div(li.unit_price_minor::numeric * li.quantity * li.tax_rate_bps + 5000, 10000))::bigint AS tax_minor
  FROM crm.quotation_line_items li
  GROUP BY li.tenant_id, li.quotation_id
) t
WHERE t.quotation_id = q.id
  AND t.tenant_id = q.tenant_id
  AND q.grand_total_minor = 0
  AND q.total_minor > 0;

UPDATE crm.quotations
SET grand_total_minor = total_minor
WHERE grand_total_minor = 0 AND total_minor > 0;

-- Existing orders carry their quotation's grand total, falling back to their
-- own (net) total when the quotation is gone.
UPDATE crm.orders o
SET grand_total_minor = COALESCE(
  (SELECT q.grand_total_minor FROM crm.quotations q
    WHERE q.id = o.quotation_id AND q.tenant_id = o.tenant_id AND q.grand_total_minor > 0),
  o.total_minor)
WHERE o.grand_total_minor = 0 AND o.total_minor > 0;

ALTER TABLE crm.quotations FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.quotation_line_items FORCE ROW LEVEL SECURITY;
