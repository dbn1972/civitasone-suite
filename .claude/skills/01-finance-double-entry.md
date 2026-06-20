# Skill — Finance Double-Entry Accounting

**When to load:** Building anything in `finance-service` or anything that posts to GL.

---

## Core invariants (never violate)

1. **Every transaction has at least one debit and one credit.**
2. **Sum of debits = sum of credits.** Always. No exceptions, including reversals.
3. **Posting is append-only.** A posted journal entry cannot be edited or deleted — only reversed (which is itself a new entry).
4. **A reversal entry mirrors the original with opposite signs**, same date or later, and references the original entry's `id` in `reversal_of`.
5. **Period close locks the period.** No posting with `posting_date` in a closed period.
6. **Currency stays inside the entry.** Multi-currency journals (Phase 2) require explicit FX lines with documented rate source.
7. **Account types follow the equation:** Assets + Expenses = Liabilities + Equity + Income. Trial balance proves this; CI computes it nightly per tenant.

## Account types and natural balances

| Type | Natural balance | Debit increases | Credit increases |
|---|---|---|---|
| Asset | Debit | ✅ | ❌ |
| Expense | Debit | ✅ | ❌ |
| Liability | Credit | ❌ | ✅ |
| Equity | Credit | ❌ | ✅ |
| Income | Credit | ❌ | ✅ |

## Required tables (finance-service prefix)

- `finance_accounts` — chart of accounts (hierarchical, parent_id self-fk)
- `finance_journal_entries` — header
- `finance_journal_lines` — child, sum constraint enforced at app and DB
- `finance_gl_entries` — denormalized ledger for queries (one row per posted line)
- `finance_fiscal_years` — periods with status (open / closed / locked)
- `finance_budgets` — annual budgets per account / cost center
- `finance_currencies` — supported currencies + rounding rules

## Posting algorithm (atomic per transaction)

```
BEGIN TX
  INSERT journal_entries (status='posted', posted_at=now())
  INSERT journal_lines (one per line)
  ASSERT sum(debit) = sum(credit) — if not, ROLLBACK + 422
  INSERT gl_entries (denormalized — one per line, with account_balance after = previous + delta)
  UPDATE finance_accounts.balance_cache (per affected account)
  UPDATE finance_budgets.consumed (if budget controlled)
  EMIT audit_event (action=journal.posted)
  EMIT domain_event finance.gl_entry.posted (one per line, batched)
COMMIT
```

If any step fails → rollback, no partial state, return 422 with the failing invariant.

## Forbidden patterns

- Editing `finance_journal_entries` after status=posted (use reversal)
- Negative amounts in debit or credit (use the other column)
- Posting to a group account (only leaf accounts hold balances)
- Cross-currency in same entry without explicit FX lines
- Bypassing budget check (every commit must call check_budget)

## Edition specifics

- **Govt Department:** account codes follow IGAS / IPSAS, mandatory cost center, mandatory scheme code on every line
- **PSU:** Ind AS chart of accounts, segment reporting required, IFC compliance flags
- **Small Office:** simplified COA (10 root accounts), no cost center mandatory
