-- Align live DB constraint name with the Drizzle schema declaration.
-- The original migration (0016) let Postgres auto-name it; Drizzle schema
-- declares it as "rating_range". Renaming avoids a duplicate on next push.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contractor_ratings_rating_check'
      AND conrelid = 'works.contractor_ratings'::regclass
  ) THEN
    ALTER TABLE works.contractor_ratings
      RENAME CONSTRAINT contractor_ratings_rating_check TO rating_range;
  END IF;
END $$;
