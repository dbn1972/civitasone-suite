-- DOM-029: the sandbox ENVIRONMENT row flips to status:"ready" on a refresh
-- completion with no signal of whether that refresh actually moved data or
-- was stubbed -- unlike the JOB row (refresh_jobs.data_movement), which is
-- already honest about this. Mirrors that same stubbed|executed vocabulary.
ALTER TABLE sandbox.sandbox_environments
  ADD COLUMN IF NOT EXISTS last_refresh_data_movement varchar(16);
