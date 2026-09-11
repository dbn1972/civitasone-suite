-- Migration 0072: TX-006 — DB-level debit = credit enforcement on journal lines.
--
-- gl.finance_journal_lines (denormalized from finance_journals.lines JSONB,
-- migration 0030) is the only place a journal's lines exist as individual
-- rows. Until now the ONLY guard that a journal balances (sum(debit) ==
-- sum(credit)) was the application-level assertJournalBalances() in
-- src/modules/gl/domain.ts, called from the GL consumer's postJournal()
-- before it inserts anything. A direct SQL insert (migration script, psql
-- session, future code path that forgets to call assertJournalBalances)
-- could post an unbalanced journal with no enforcement at the DB layer.
--
-- Fix: a DEFERRABLE INITIALLY DEFERRED constraint trigger on
-- gl.finance_journal_lines. It must be a *constraint* trigger deferred to
-- transaction commit, not a plain BEFORE/AFTER ROW trigger — the app posts
-- a journal's lines as N separate INSERT statements inside one transaction
-- (see postJournal's per-line loop in gl/consumer.ts), so checking the sum
-- after each individual row would reject every legitimate multi-line
-- journal on its first line. Deferring to commit means the check only runs
-- once all of a journal's lines are present.
--
-- Additive, idempotent, forward-only. Function runs as invoker; finance_svc
-- already holds SELECT on gl.finance_journal_lines (granted in 0030), which
-- is all the aggregate query needs.
--
-- gl.check_journal_balance(journal_id) is the single-journal validator,
-- factored out so it can be invoked once per affected journal_id. This
-- matters for UPDATE: a row can move from one journal to another by
-- changing journal_id (e.g. re-assigning a line to a different voucher).
-- COALESCE(NEW.journal_id, OLD.journal_id) always resolves to NEW on an
-- UPDATE (NEW is never null there), so a naive single-journal check only
-- ever re-validates the DESTINATION journal and never the SOURCE journal
-- the row left — a transaction can move lines out of a balanced journal,
-- leaving it permanently unbalanced with no error raised. The trigger
-- function below validates BOTH journal_id values whenever they differ.

CREATE OR REPLACE FUNCTION gl.check_journal_balance(p_journal_id uuid) RETURNS void AS $$
DECLARE
  v_dr bigint;
  v_cr bigint;
BEGIN
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0)
    INTO v_dr, v_cr
    FROM gl.finance_journal_lines
   WHERE journal_id = p_journal_id;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION
      'JOURNAL_UNBALANCED: journal % lines do not balance (debit=%, credit=%)',
      p_journal_id, v_dr, v_cr
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gl.check_journal_lines_balanced() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.journal_id IS DISTINCT FROM NEW.journal_id THEN
    -- Row moved between journals: both the journal it left (OLD) and the
    -- journal it joined (NEW) must independently balance.
    PERFORM gl.check_journal_balance(OLD.journal_id);
    PERFORM gl.check_journal_balance(NEW.journal_id);
  ELSE
    PERFORM gl.check_journal_balance(COALESCE(NEW.journal_id, OLD.journal_id));
  END IF;

  RETURN NULL; -- ignored: AFTER trigger
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON gl.finance_journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON gl.finance_journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION gl.check_journal_lines_balanced();
