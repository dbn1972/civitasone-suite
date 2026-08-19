-- DB-H4: Convert finance_anomalies.amount_paise from text to bigint,
--         rename to amount_minor (canonical naming for minor-unit amounts).
--         Table confirmed empty at migration time (no data loss risk).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='finance_anomalies'
             AND column_name='amount_paise' AND data_type='text') THEN
    ALTER TABLE public.finance_anomalies
      ALTER COLUMN amount_paise TYPE bigint
      USING CASE WHEN amount_paise IS NULL OR amount_paise = '' THEN NULL ELSE amount_paise::bigint END;
    ALTER TABLE public.finance_anomalies RENAME COLUMN amount_paise TO amount_minor;
  END IF;
END $$;
