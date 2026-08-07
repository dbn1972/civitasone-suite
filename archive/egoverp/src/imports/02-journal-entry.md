# Finance — Journal Entry

**SPRINT:** 4
**ROUTE:** `/finance/journals/new` (create) | `/finance/journals/{id}` (view)
**SERVICE OWNER:** finance-service
**ENTITY:** finance_journal_entries + finance_journal_lines

---

## Figma Make prompt

```
Generate the Journal Entry screen — both create and view modes — for CivitasOne Suite.

PURPOSE: Record a double-entry accounting transaction. Sum of debits must equal
sum of credits before posting is allowed. Source: Vol 12 + skill finance-double-entry.

LAYOUT: FormPage shell with sticky save bar

HEADER:
- Title: "New Journal Entry" or "Journal Entry #{number}"
- Breadcrumb: Finance / Journals / {New | Number}
- Status pill: Draft | Posted | Cancelled (only on view)

FORM FIELDS (top section):
- Posting date (DatePicker, required, defaults to today)
- Reference number (auto-generated, read-only after save)
- Reference type (Select: manual, invoice, payment, payroll, adjustment)
- Cost center (Combobox, optional)
- Project (Combobox, optional)
- Narration (Textarea, required, min 5 chars)

LINES TABLE (DataTable with editable rows):
Columns: Account (Combobox of finance_accounts), Description, Debit, Credit, Tax Code, Line Total
Row controls: drag-handle reorder, delete row
Footer row (sticky): Totals — Debit total, Credit total, Difference (must be 0 to post)

VALIDATION (live, before submit):
- At least 2 lines required
- Each line: account required, exactly one of debit/credit must be > 0
- Debit total must equal credit total (Difference = 0 — shown intent.success when balanced, intent.danger when not)
- Posting date within open fiscal period

SAVE BAR (sticky at bottom):
- Difference indicator (large, color-coded)
- Save as draft (secondary)
- Post journal (primary, disabled until balanced and valid)
- Cancel (tertiary — returns to list with confirm if dirty)

VIEW MODE:
- All fields read-only
- Status pill at top
- Audit Trail tab shows full posting history
- Actions: Reverse (creates inverse entry, requires comment), Print, Export PDF

STATES:
- Default (new — empty form)
- Default (edit draft — populated form)
- Default (view posted — read-only)
- Validation error: inline FormField errors + Banner summary at top
- Posting in progress: loading overlay on save bar
- Posted success: redirect to view mode with success Toast
- Period closed error: Banner intent.danger "Posting date is in a closed period"

PERMISSIONS:
- Create / save draft: Accountant
- Post: Finance Manager (or Accountant if entity threshold low — policy-service rule)
- Reverse: Finance Manager + audit comment required

ACCESSIBILITY:
- Editable table rows announce row position
- Difference indicator has aria-live="polite" — announces when reaching zero
- Save bar buttons have descriptive aria-labels including current state

EVENTS EMITTED on post (per @civitasone/events):
- finance.gl_entry.posted (one per line)

OUT OF SCOPE:
- Multi-currency journal (Phase 2)
- Recurring journals (Phase 2)
- Schedule posting for future date (Phase 2)
```
