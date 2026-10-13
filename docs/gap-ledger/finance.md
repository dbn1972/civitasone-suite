# Detailed gap file — module `finance`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 297, BACKEND-VERIFY 12, CANNOT-VERIFY 2, REFUTED 1



---
## /finance  —  `finance/home.html`

- **Source:** `apps/web/src/app/(app)/finance/page.tsx`
- **Design reference:** `redesign/finance/home.html`

### GAP-FINANCE-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was I18N)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Two PFMS tiles with overlapping copy: "PFMS Integration" -> /finance/treasury/pfms (page.tsx:29) and "PFMS Operations" -> /finance/pfms (page.tsx:59); users cannot tell which to open.
- **Verified evidence:** Two tiles: 'PFMS Integration' (Treasury & Banking) -> /finance/treasury/pfms, described as scroll tracking and beneficiary verification (finance/page.tsx:29), and 'PFMS Operations' (Statutory) -> /finance/pfms, batches, salary bills, payment advice, bank file, e-sign (page.tsx:59). Both routes exist (treasury/pfms/page.tsx, pfms/page.tsx), with different content, but titles and both descriptions expand PFMS, so choice is unclear. Obs says the issue is i18n; it is really naming/IA, and the tile strings are not translated at all.
- **Files to change:** `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Rename tiles by task: 'PFMS Payment Scrolls' (treasury/pfms) and 'PFMS Batches & Bank Files' (pfms).
  2. Put both in the same section (Treasury & Banking) adjacent to each other.
  3. Shorten descriptions so the difference is explicit; move tile strings to next-intl keys (finance.tiles.*) in all five messages files.
- **Acceptance:**
  - Manual: the two tiles are adjacent with distinct titles.
  - Test: hub renders same hrefs (no route change).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-HOME-02, GAP-FINANCE-HOME-04

### GAP-FINANCE-HOME-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Section placement is off: "Debt Management" sits under Audit & Compliance (page.tsx:50) and "Reconciliation" under Statutory (page.tsx:58); ledgers/treasury users will not look there.
- **Verified evidence:** Placements are as stated: Debt Management under 'Audit & Compliance' (finance/page.tsx:50) and Reconciliation under 'Statutory' (58; also PFMS Operations at 59). Fact holds; that they are wrong is a judgement, though a debt register/EMI schedule fits Treasury & Banking or Accounting better and bank reconciliation fits Treasury & Banking.
- **Files to change:** `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Move Debt Management to 'Treasury & Banking'.
  2. Move Reconciliation to 'Treasury & Banking' (or 'Accounting').
  3. Move PFMS Operations to Treasury & Banking (see HOME-01).
  4. Confirm with finance stakeholders before merging.
- **Acceptance:**
  - Manual: tiles appear under the new sections; hrefs unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-HOME-01

### GAP-FINANCE-HOME-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** config/page.tsx and journal-entry/page.tsx have no tile in the hub (page.tsx:6-60), so they are reachable only by URL; expenses, loans, medical, travel are redirect pages.
- **Verified evidence:** Hub tiles (page.tsx:6-60) contain no tile for /finance/config or /finance/journal-entry, so journal-entry has no inbound link found in apps/web/src (its form is reused by accounting/vouchers/new, which the hub does link as 'New Voucher', line 43). /finance/config is not URL-only: expenditure/bills/page.tsx:31 links to it. expenses, loans, medical, travel are redirect pages (confirmed for all four). Also note journal-entry duplicates New Voucher.
- **Files to change:** `apps/web/src/app/(app)/finance/page.tsx`, `apps/web/src/app/(app)/finance/journal-entry/page.tsx`
- **Fix steps:**
  1. Add a 'Finance Configuration' tile (section 'Vendor & Masters') -> /finance/config.
  2. Decide whether /finance/journal-entry stays; recommended: redirect it to /finance/accounting/vouchers/new and drop the duplicate page, or add a tile if kept.
  3. Optionally add a Bank Accounts tile if config is split.
- **Acceptance:**
  - Manual: config reachable from hub.
  - journal-entry either redirects or is linked.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-EXPENSES-02

### GAP-FINANCE-HOME-04  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Subtitle is a hard-coded English literal while the title uses next-intl t("title") (page.tsx:66).
- **Verified evidence:** PageHeader at finance/page.tsx:66 uses t('title') and a hard-coded English subtitle 'Ledgers, budgets, expenditure, treasury, revenue, and statutory reporting.' Confirmed, but broader: all 37 tile titles/descriptions/sections (6-60) are also English literals. en.json 'finance' namespace (line 2024) has no subtitle key (only financeDashboard.subtitle). The FABRICATED theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/messages/kn.json`, `apps/web/src/messages/ta.json`, `apps/web/src/messages/te.json`
- **Fix steps:**
  1. Add finance.subtitle to all five messages files.
  2. Use t('subtitle') in PageHeader.
  3. Optionally move tile strings to finance.tiles.* and build financeSections inside the component with t().
- **Acceptance:**
  - Switching locale to hi changes the subtitle.
  - i18n key-parity check passes across locales.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Missing translations must not show raw keys; provide English fallbacks.
- **Depends on:** GAP-FINANCE-HOME-01

### GAP-FINANCE-HOME-05  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** loading.tsx renders four stat-card skeletons though the hub has no stat cards (loading.tsx:22-40), so the skeleton shifts on load.
- **Verified evidence:** finance/loading.tsx renders a 4-column stat-card grid (lines 23-44, not 22-40) and table skeleton, while the hub renders <LinkTiles> tiles. But that file is the segment-level fallback for every /finance/* route without its own loading.tsx (15 subfolders have one; e.g. vendors, payments do, but many do not), so the stat-card shape is right for many children; the mismatch is specific to /finance itself.
- **Files to change:** `apps/web/src/app/(app)/finance/loading.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Keep finance/loading.tsx as the generic fallback.
  2. Add a hub-specific skeleton: wrap page.tsx in its own segment or use <Suspense fallback={<TilesSkeleton/>}>; make the fallback a header plus 4-column grid of tile-shaped blocks.
  3. Or make the generic fallback neutral (header + block) rather than stat cards.
- **Acceptance:**
  - Manual: /finance shows tile-shaped skeleton; a child route without loading.tsx still shows the generic one.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/accounting/financial-statements  —  `finance/accounting-financial-statements.html`

- **Source:** `apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx`
- **Design reference:** `redesign/finance/accounting-financial-statements.html`

### GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Failed fetch reads as zeros: stat cards show formatMoney(0) and the table says "No data for this statement type" (page.tsx:13-16,32-35; StatementsTable.tsx:72); only a small badge in the card admits the load failed.
- **Verified evidence:** apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx:11-16: `source` from getFinancialStatements is only passed to StatementsTable; on error `statements` is [] so the four reduce totals are 0 and StatCards render formatMoney(0)='₹0.00' (:32-35). StatementsTable.tsx:118-119 renders 'No data for this statement type', with only DataSourceBadge (:106) saying the load failed. The table uses useSeededResource (lib/sync/resource) so it can show cached rows while the server-computed stat cards still show 0.
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx`, `apps/web/src/app/(app)/finance/accounting/financial-statements/StatementsTable.tsx`
- **Fix steps:**
  1. Move the StatGrid into a client component (or into StatementsTable) so totals come from the same useSeededResource rows as the table.
  2. When provenance is 'error-no-data', render <RefreshErrorState error={toHumanError('load',{area:'financial statements'})} backHref='/finance'/> (pattern in finance/config/page.tsx:40) instead of the cards and table.
  3. Pass null/undefined totals to formatMoney (returns '—') when not loaded rather than 0.
  4. Keep cached data path: show cached banner via DataSourceBadge.
- **Acceptance:**
  - Component test: source='error' with no cache renders RefreshErrorState, no ₹0.00 text.
  - Component test: cached data shows figures and the stale badge.
  - Manual: kill API; page shows retry state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Financial reporting: a zero balance on failure can be misread as a real nil position.
- **Depends on:** GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-04, GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-01

### GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02  ·  HIGH  ·  confirmed  ·  theme ACCOUNTING-LOGIC (was OTHER)

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Totals add opening balances of assets, liabilities, income and expenditure together (page.tsx:13-16; StatementsTable.tsx:47-50): the R&P grand total mixes account classes, so "Closing Balance" has no accounting meaning. I&E and Balance Sheet are just row filters of one head list, no derived surplus/deficit or balancing check.
- **Verified evidence:** apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx:13-16 sums openingBalance/receipts/payments/closingBalance over ALL rows, and StatementsTable.tsx:66-70 R&P filter is null (all heads) while I&E and Balance Sheet are simple `type` filters (income|expenditure, asset|liability); totals at :94-97 add every class together. No surplus/deficit, no assets = liabilities check. What the /v1/finance/statements endpoint really returns (heads vs computed statements) cannot be verified (finance-service absent, @civitasone/types not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/financial-statements/StatementsTable.tsx`, `apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with finance owner the statement contract; ideally the API returns computed R&P (cash/bank opening, receipts, payments, closing), I&E (surplus/deficit) and Balance Sheet (with balancing difference).
  2. Until then, do not sum across classes: for R&P show totals only for cash/bank heads or none; for I&E show Total Income, Total Expenditure and Surplus/(Deficit); for Balance Sheet show Total Assets, Total Liabilities and a Balanced/Unbalanced indicator.
  3. Extend FinancialStatementSummary type and loader accordingly; add unit tests on the derivations using BigInt paise.
- **Acceptance:**
  - Unit: income 1000, expenditure 700 gives surplus 300; assets != liabilities shows unbalanced flag.
  - Manual: R&P closing equals opening + receipts - payments for the cash heads.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Statutory reporting: figures currently shown could be quoted as audited statements; wrong totals are a compliance risk.
- **Depends on:** GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03, GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-04

### GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Money is a JS number (openingBalance/receipts/... reduced with + at page.tsx:13-16), not paise bigint/decimal string as GL and sanctions use (general-ledger/page.tsx:14); large tenants can lose precision.
- **Verified evidence:** apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx:13-16 and StatementsTable.tsx:94-97 add values with `+` and cast `as number`; formatMoney(number) treats them as paise and rounds (lib/formatters.ts:100). Contrast general-ledger/page.tsx:14 (BigInt on string paise). Overstated: integer paise sums are exact up to 2^53 (about ₹9e13), so precision loss for a normal tenant is unlikely; the real risks are contract inconsistency with rule 11 (bigint/decimal-string) and that if the API ever sends strings, `+` would concatenate. The declared type lives in @civitasone/types (absent), so the wire type is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx`, `apps/web/src/app/(app)/finance/accounting/financial-statements/StatementsTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `packages/types (FinancialStatementSummary + zod schema)`
- **Fix steps:**
  1. Change FinancialStatementSummary and FinancialStatementSummaryListSchema so balance fields are minor-unit decimal strings (backend to match).
  2. Sum with BigInt (as in general-ledger/page.tsx:14) via a shared sumMinor(rows, key) helper in lib/formatters.ts or lib/money.ts.
  3. Remove the `as number` casts in StatementsTable.tsx.
- **Acceptance:**
  - Unit: sumMinor(['9007199254740993','1']) = 9007199254740994n.
  - Contract test: schema rejects non-numeric strings.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money: wire-type change needs coordinated backend release.
- **Depends on:** GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02

### GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Segment control changes the table but not the four header stat cards, so header and table disagree after switching to I&E.
- **Verified evidence:** apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx:13-36 computes four StatCards server-side over all rows; segmented control state is local to StatementsTable.tsx:83 and only affects the footer totals (:94-97) and rows. On I&E the cards keep the R&P-style totals of all classes. Page cannot see client state.
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx`, `apps/web/src/app/(app)/finance/accounting/financial-statements/StatementsTable.tsx`
- **Fix steps:**
  1. Lift the StatGrid into StatementsTable (or a new StatementsView client component) below the Segmented control so cards derive from `filtered`.
  2. Change card labels per statement type (I&E: Total Income, Total Expenditure, Surplus/Deficit; Balance Sheet: Assets, Liabilities, Difference) - see -02.
  3. Remove the duplicated totals footer or keep it consistent with the cards.
- **Acceptance:**
  - Component test: switching to I&E changes card values to the filtered totals.
  - Cards and footer always agree.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-01, GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02

### GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-05  ·  LOW  ·  partly  ·  theme EXPORT (was PII)

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** "Export PDF" is window.print() of the screen (PrintExportButton.tsx header comment), not a statement document; FyFilter re-navigates but only statements honours ?fy (FyFilter.tsx header comment).
- **Verified evidence:** PrintExportButton.tsx header comment confirms 'Export PDF' calls window.print() (finance has no server statement PDF endpoint per that comment), so the output is the browser page (nav chrome, print CSS) not a formal statement. FyFilter.tsx header says loaders do not yet accept fy; this is stale: getFinancialStatements(fy) (loaders.ts:1936) and monitoring loaders (:2099,:2111,:2126) take fy, while general-ledger takes none. FyFilter is used on statements, budget/monitoring, dashboard and opening-balances; it also calls router.push then router.refresh (redundant). Theme PII is wrong. Server PDF capability cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/_components/PrintExportButton.tsx`, `apps/web/src/app/(app)/finance/_components/FyFilter.tsx`, `apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx`
- **Fix steps:**
  1. Add a print stylesheet (hide sidebar/topbar, page header with tenant name, FY, generated-on) and label the button 'Print / Save as PDF' until a server PDF exists.
  2. Ask finance for a statement PDF endpoint and switch to PrintDocumentLink (already used in GLTable) when available.
  3. Correct the stale FyFilter comment; remove router.refresh() after push.
  4. Verify each page using FyFilter passes fy to its loader (dashboard, opening-balances) or hide the control there.
- **Acceptance:**
  - Manual: print preview shows only statement content with FY and date.
  - Test: selecting FY changes URL and loader receives it on every page that shows the filter.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; but a print of the current screen is easy to mistake for an official statement.


---
## /finance/accounting/general-ledger  —  `finance/accounting-general-ledger.html`

- **Source:** `apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx`
- **Design reference:** `redesign/finance/accounting-general-ledger.html`

### GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** On a failed fetch the stats are 0 and the delta reads "Balanced" (BigInt 0 === 0 at general-ledger/page.tsx:17,36) while the table says "No entries for this filter" (GLTable.tsx:91); a failed ledger reports itself as balanced.
- **Verified evidence:** apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx:8-17: on fetch error entries=[]; BigInt sums are 0n so isBalanced (0n===0n) is true and the Total Credit card shows delta 'Balanced' with up=true (:36); GLTable.tsx:138-139 shows 'No entries for this filter'. Only DataSourceBadge (GLTable.tsx:117) mentions the failure. The table uses useSeededResource (lib/sync/resource) so it can show cached rows while the server-computed stat cards still show 0.
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx`, `apps/web/src/app/(app)/finance/accounting/general-ledger/GLTable.tsx`
- **Fix steps:**
  1. Compute stats in a client component from the same useSeededResource rows (or pass source into the stats) so they can know the load state.
  2. On 'error-no-data' render <RefreshErrorState error={toHumanError('load',{area:'general ledger'})}/> instead of cards and table.
  3. Show '—' and no Balanced/Unbalanced delta unless data loaded and rows>0.
  4. Do not treat an empty ledger as balanced without stating 'No entries'.
- **Acceptance:**
  - Component test: error with no cache shows retry state and no 'Balanced' text.
  - Component test: loaded data with debit != credit shows 'Unbalanced'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Financial integrity signal: a false 'Balanced' badge on failure.
- **Depends on:** GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-04, GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-01

### GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** "Vouchers" is entries.length (page.tsx:33) but rows are journal lines (id "journalId:line" split at GLTable.tsx:132), so multi-line vouchers over-count; "Accounts Active" is distinct accountCode over all fiscal years.
- **Verified evidence:** apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx:33 `value={entries.length}` labelled Vouchers; GLTable.tsx:180 shows ids are 'journalId:line', so entries are journal lines and multi-line vouchers are counted per line. uniqueAccounts (:16) counts distinct accountCode over the whole unfiltered ledger of all fiscal years (card title :43).
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx`
- **Fix steps:**
  1. Count vouchers as distinct voucherNo (or id.split(':')[0]) via new Set.
  2. Rename card to 'Entry lines' if the line count is also wanted; label Accounts Active with FY scope once an FY filter exists (GL-03).
  3. Add a unit test with a 3-line voucher.
- **Acceptance:**
  - Unit: 2 vouchers x 3 lines yields Vouchers 2, lines 6.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03

### GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** Title says "all fiscal years" and the loader takes no fy or page (loaders.ts:1927-1935): the whole ledger is fetched and paged client-side at 25 (GLTable.tsx:21), unbounded for real tenants; no FY filter unlike statements/monitoring.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:1927-1935 getFinanceGLEntries() calls /api/v1/finance/journals with no fy/page/limit params (revalidate 60); the full array is passed as props and seeded into client storage, then DataTable pageSize={PAGE_SIZE} (GLTable.tsx:69,191) pages in the browser at 25; search and tab filter also run client-side (:88-102). Card title says 'all fiscal years' (page.tsx:43). Whether /v1/finance/journals supports fy/limit/offset is cannot-verify (finance service absent).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx`, `apps/web/src/app/(app)/finance/accounting/general-ledger/GLTable.tsx`, `apps/web/src/app/(app)/finance/_components/FyFilter.tsx`
- **Fix steps:**
  1. Confirm/extend the journals API with fy, type, q, limit, offset and totals (total debit, total credit, count) in the response.
  2. Change getFinanceGLEntries(params) to pass them; read fy/page/type/q from searchParams in page.tsx and add <FyFilter/> to the header.
  3. Make GLTable drive pagination/filters through URL params (router.push) and render server totals.
  4. Rename card to 'General ledger · FY 2026-27'.
- **Acceptance:**
  - Test: with 10k rows only one page is fetched (network shows limit=25).
  - Manual: changing FY or tab refetches and totals update.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Performance/rule 6: unbounded payload; changes to totals semantics affect reconciliations.
- **Depends on:** GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-04, GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-02

### GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Balanced check runs on the full list in page.tsx:17 but totals in GLTable footer run on the filtered list (GLTable.tsx:59-60) - two different totals on one screen.
- **Verified evidence:** apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx:14-17 totals and the Balanced delta use the full list; GLTable.tsx:107-108 and footer :199 total the filtered list (tab + search), so a Payment-only tab correctly shows debit != credit next to a 'Balanced' card. Logic is coherent but unlabelled, which reads as two conflicting totals.
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/general-ledger/GLTable.tsx`, `apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx`
- **Fix steps:**
  1. Rename the footer to 'Filtered total (n entries)' and the cards to 'Ledger total' (or move the cards into GLTable and recompute from the same rows).
  2. Show the balance check only on ledger-wide totals, never on filtered ones.
  3. After GL-03, take ledger totals from the server response.
- **Acceptance:**
  - Component test: footer text contains 'Filtered' when tab/search active and differs from cards.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-01, GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03


---
## /finance/accounting/vouchers/new  —  `finance/accounting-vouchers-new.html`

- **Source:** `apps/web/src/app/(app)/finance/accounting/vouchers/new/page.tsx`
- **Design reference:** `redesign/finance/accounting-vouchers-new.html`

### GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Failed chart-of-accounts fetch leaves the form usable: header badge only (page.tsx:21), account fields fall back to free-text inputs seeded with "1000"/"2000" (JournalEntryForm.tsx:45-46,311-314), so a clerk can post to non-existent codes.
- **Verified evidence:** vouchers/new/page.tsx:12 destructures {data:accounts,source} from getChartOfAccounts() (loaders.ts:1303, fallback []); page.tsx:21 only shows <DataSourceBadge> when source==='error' and still renders <JournalEntryForm accounts={[]}> (page.tsx:25). JournalEntryForm.tsx:45-46 default to accounts[0]?.code ?? "1000" / "2000"; lines are seeded with them (51-54) and, since accounts.length===0, lines 308-317 render a free-text <input placeholder='Account code'>. validate() (98-117) only checks non-empty, so a clerk can post to codes that may not exist; posting is gated by a maker-checker ConfirmDialog but no code validation. mapAccounts (loaders.ts:646) returns null for an empty list, so a tenant with zero accounts also lands here. The same form is used by /finance/journal-entry/page.tsx:19.
- **Files to change:** `apps/web/src/app/(app)/finance/accounting/vouchers/new/page.tsx`, `apps/web/src/app/(app)/finance/journal-entry/page.tsx`, `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`
- **Fix steps:**
  1. In vouchers/new/page.tsx and journal-entry/page.tsx: if source==='error' (or accounts.length===0) return <PageHeader/> + <RefreshErrorState error={toHumanError('load',{area:'chart of accounts'})} backHref='/finance/accounting/general-ledger'/> and do NOT render JournalEntryForm; pass status/errorMessage through LoadErrorState when status===403 as other finance pages do.
  2. In JournalEntryForm.tsx delete the "1000"/"2000" literals (lines 45-46) and the free-text <input> branch (308-317); default codes come only from accounts, else "".
  3. Add a guard at the top of the component: if accounts.length===0 render an EmptyState 'No accounts configured - create accounts in Chart of Accounts first' instead of the form.
  4. In validate() add: every line.accountCode must be in new Set(accounts.map(a=>a.code)); message 'Select an account from the list.'.
- **Acceptance:**
  - Component test: render JournalEntryForm with accounts=[] -> no <input aria-label^='Account code'> and no 1000/2000 values; empty-state shown.
  - Page test / manual: stub /api/v1/finance/accounts to 500 -> RefreshErrorState with Retry visible, no form; Retry (router.refresh) re-renders the form when the API recovers.
  - validate() rejects an accountCode not in accounts.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; blocks entry when the accounts list is unavailable (intended). Ledger posting path unchanged.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-02  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Success feedback is lost: after 200/201/202 the form sets a message then calls window.location.assign(redirectTo) at once (JournalEntryForm.tsx:160-178); a 202 "accepted for processing" is never read and the GL may not yet show the voucher.
- **Verified evidence:** JournalEntryForm.tsx:163-179: on 200/201/202 it does setStatus('accepted'), setMessage(res.status===202 ? 'Journal entry accepted for processing (202).' : 'posted successfully.') and, when redirectTo is set (vouchers/new passes it, page.tsx:25), immediately calls window.location.assign(redirectTo) and returns, so the message is never seen. Overstated: the 202 status IS read (line 169) to choose the message, but the response body (e.g. journal id/voucher ref) is never read, and the copy is lost by the instant hard navigation (full reload, not router.push). Whether the GL list shows the voucher after a 202 depends on async consumer processing - cannot verify (finance-service absent). /finance/journal-entry has no redirectTo so it shows the message and resets the form.
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`, `apps/web/src/app/(app)/finance/accounting/vouchers/new/page.tsx`
- **Fix steps:**
  1. Replace window.location.assign(redirectTo) with useRouter().push(`${redirectTo}?posted=${encodeURIComponent(voucherNo)}&state=${res.status===202?'queued':'posted'}`) after a short delay, or better keep the form page and show a success panel with a 'View in General Ledger' Link and 'Post another' button.
  2. On the GL page (general-ledger/page.tsx) read searchParams.posted and show a Toast/banner ('Voucher JV-... accepted for processing - it may take a moment to appear') with a Refresh action using RefreshErrorState-style router.refresh().
  3. Read the JSON body once (await res.json().catch(()=>null)) and use only fields that exist in the response; do not invent a journal id.
  4. Use SuccessAnimation (app/_components/SuccessAnimation.tsx) or ds Toast for the confirmation.
- **Acceptance:**
  - Component test with fetch mocked to 202: success text 'accepted for processing' is visible and no navigation occurs until the user clicks 'View in General Ledger'.
  - Mock 201: text 'posted successfully' + link to GL.
  - Manual: post a journal, land on GL with a visible banner naming the voucher no.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep idempotency-key rotation (line 175) intact so a double submit cannot post twice.
- **Depends on:** GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05

### GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Amounts converted with Math.round(parseFloat(v)*100) (JournalEntryForm.tsx:31-34) - float arithmetic on money before String() to debitMinor; ₹1,00,000.10 style inputs can drift and totals are summed as JS numbers (lines 92-93). Use string/bigint parsing.
- **Verified evidence:** JournalEntryForm.tsx:31-34 rupeesToPaise = Math.round(parseFloat(val)*100) (float), sent as String() at 152-153; totals are sums of those integer paise (92-93), so the totals themselves are exact integer adds and typical inputs like 100000.10 round correctly. Real defects: the input is type=number step=0.01 with noValidate on the form, so 3+ decimals (1.005 -> 100, 1.255 -> 125 via float error) are silently rounded rather than rejected; exponent/negative-ish strings ('1e3') parse; values >2^53 paise lose precision; formatMoney is fed a JS number. A shared exact parser already exists: lib/money.ts rupeesToMinorString() (string-based, rejects >2dp, returns null for 0) - not used here.
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. Add to lib/money.ts a variant that allows empty/zero (e.g. parseMinorOrZero(input): bigint | null where '' -> 0n, invalid -> null) built on the same regex as rupeesToMinorString.
  2. In JournalEntryForm replace rupeesToPaise with it; keep line amounts as bigint; totals via reduce with 0n; diff as bigint; formatMoney already accepts bigint.
  3. In validate() add a per-line error 'Enter a valid amount with at most 2 decimals' when parse returns null for non-empty input.
  4. Send debitMinor/creditMinor as minor.toString() (unchanged wire format); switch inputs to type='text' inputMode='decimal' so browser number quirks (e-notation) are avoided.
- **Acceptance:**
  - Unit test: '1.005' -> error not rounded; '100000.10' -> 10000010n; '' -> 0n; '1e3' -> error.
  - Component test: debit 0.10 + 0.20 vs credit 0.30 shows Balanced.
  - POST body has string digits for both fields.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: changes what previously-accepted inputs do (3dp now rejected); backend zMoneyMinor already requires digit strings so wire format is unchanged.

### GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Posting date defaults to new Date().toISOString().slice(0,10) (JournalEntryForm.tsx:50) which is UTC: between 00:00 and 05:30 IST the default is yesterday.
- **Verified evidence:** JournalEntryForm.tsx:50 useState(() => new Date().toISOString().slice(0,10)) and again on reset at line 183. toISOString is UTC, so for a browser in IST between 00:00 and 05:30 the default posting date is the previous day. (Backend may or may not reject a back-dated posting; cannot verify.) Note formatIndianDate (lib/formatters.ts:2) uses the browser's local tz and renders dd/mm/yyyy, so it is not the right helper for an <input type=date> value, which must be yyyy-mm-dd.
- **Files to change:** `apps/web/src/lib/fiscalYear.ts`, `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`
- **Fix steps:**
  1. Add todayIstIsoDate() to lib/fiscalYear.ts (which already has an Asia/Kolkata helper at line 16): new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()) -> yyyy-mm-dd.
  2. Use it at JournalEntryForm.tsx:50 and :183.
  3. Optionally show the chosen date beneath the field via formatIndianDate for confirmation.
- **Acceptance:**
  - Unit test with vi.setSystemTime('2026-04-01T20:00:00Z') (01:30 IST on 2 Apr) -> '2026-04-02'.
  - Manual: set OS clock to 02:00 IST, open form, date equals IST today.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; also the default FY boundary (1 Apr) case is affected, so the test at the FY edge matters.

### GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Voucher number is free text with no series/duplicate hint (JournalEntryForm.tsx:100,205-215); the GL later relies on it as the voucher key.
- **Verified evidence:** JournalEntryForm.tsx:100 validates voucherNo only as non-empty; input at 208-216 is free text with placeholder 'e.g. JV-2026-001' and no series suggestion, format check, max length or duplicate check. True for the UI. Whether the GL keys on voucherNo and rejects duplicates is cannot-verify (finance-service/gl validators absent from snapshot); the client already sends x-idempotency-key (line 159) which protects retries but not a user reusing a number. Also zod is not used at the form boundary (hand-rolled validate()), contrary to CLAUDE.md rule 9 spirit for client forms; backend zod is the real boundary.
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`, `apps/web/src/app/(app)/finance/journal-entry/page.tsx`
- **Fix steps:**
  1. Define a zod schema (voucherNo: /^[A-Z]{2,4}-\d{4}-\d{3,}$/ or the tenant's series rule once decided, max length) and use safeParse inside validate().
  2. Decision needed: auto-generate the next voucher no server-side (preferred) vs client-suggested; if suggested, prefill from the latest voucher via an existing GL list loader (do not invent a new endpoint - confirm with backend).
  3. Map the backend duplicate error (formError.fieldError('voucherNo') at line 218 already renders field errors) so a 409/400 duplicate shows under the field; keep dialog open.
  4. Keep submit disabled while status==='submitting' (already true at 417).
- **Acceptance:**
  - Unit: 'x' and '' rejected with a message; 'JV-2026-001' accepted.
  - Component test: backend returns field error voucherNo 'already exists' -> shown under the input, no redirect.
  - Decision recorded on numbering series.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong regex could block legitimate voucher formats; agree the series with Finance before enforcing.


---
## /finance/advances  —  `finance/advances.html`

- **Source:** `apps/web/src/app/(app)/finance/advances/page.tsx`
- **Design reference:** `redesign/finance/advances.html`

### GAP-FINANCE-ADVANCES-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** finance/layout.tsx:29-36 wraps every /finance/* child in a FINANCE_ROLES gate, so an employee or manager (no finance role) who follows an old /finance/advances bookmark sees PermissionDenied instead of being redirected to /hr/advances, which serves them.
- **Verified evidence:** finance/advances/page.tsx:9-11 is a server redirect('/hr/advances'). finance/layout.tsx:29-36 renders <PermissionDenied module='finance'> for any session whose roles are non-empty and none is in FINANCE_ROLES (workRoles.ts:32-43: finance_officer, finance_admin, super_admin, audit_officer, budget_officer, procurement_officer, accounts_officer, payroll_admin, tenant_admin, admin). The layout wraps the page so the redirect never runs for an employee/manager. hr/advances/page.tsx exists. Empty roles fail open. Impact is only stale bookmarks: Sidebar hides the entry and the hub links to /finance/expenditure/advances (finance/page.tsx).
- **Files to change:** `apps/web/next.config.js`, `apps/web/src/app/(app)/finance/layout.tsx`
- **Fix steps:**
  1. Preferred: add permanent redirects in next.config.js redirects(): {source:'/finance/advances',destination:'/hr/advances',permanent:true} and same for /finance/benefits (runs before the layout).
  2. Alternative: in finance/layout.tsx skip the role gate for a LEGACY_REDIRECT_PATHS list (needs pathname via headers()).
  3. Delete finance/advances/page.tsx and finance/benefits/page.tsx once the config redirects ship.
- **Acceptance:**
  - Manual: log in as an employee-only role, open /finance/advances -> lands on /hr/advances (no PermissionDenied).
  - Finance officer still lands on /hr/advances; /finance/expenditure/advances is unaffected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; do not weaken the role gate for real /finance/* routes.
- **Depends on:** GAP-FINANCE-BENEFITS-01

### GAP-FINANCE-ADVANCES-02  ·  LOW  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Orphaned component: advances/AdvanceSlideOver.tsx (POSTs /api/proxy/v1/finance/advances, line 82) is not imported anywhere under finance/ after the page became a redirect.
- **Verified evidence:** grep across apps/web/src finds AdvanceSlideOver only in its own file (advances/AdvanceSlideOver.tsx:10,34); no importer, so it is dead. It POSTs /api/proxy/v1/finance/advances (line 82) and uses Math.round(Number(amount)*100) for amountMinor (~line 88) - float money math. A live create flow exists at finance/expenditure/advances/new/page.tsx:41 posting to the same endpoint.
- **Files to change:** `apps/web/src/app/(app)/finance/advances/AdvanceSlideOver.tsx`
- **Fix steps:**
  1. Confirm expenditure/advances/new covers every field of AdvanceSlideOver (employeeId, advanceType, amountMinor, purpose, recoveryMonths).
  2. Delete advances/AdvanceSlideOver.tsx.
  3. Run the repo's dead-code/typecheck (pnpm -F web typecheck) to confirm nothing else imports it.
- **Acceptance:**
  - pnpm typecheck and build pass after deletion.
  - grep -r AdvanceSlideOver apps/web returns nothing.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None (no callers).

### GAP-FINANCE-ADVANCES-03  ·  LOW  ·  partly  ·  theme DEADROUTE

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** loaders.ts:1910 still exposes getFinanceAdvances against /api/v1/finance/advances, the endpoint the redirect comment says 404s; finance-service absent so unverifiable.
- **Verified evidence:** loaders.ts:1909-1916 getFinanceAdvances GET /api/v1/finance/advances is NOT dead: it is imported and called by finance/expenditure/advances/page.tsx:3,10, which the finance hub links to (finance/page.tsx 'Advances'). Only the page.tsx comment (advances/page.tsx:4-7) claims that endpoint 404s for the old page shape; that contradicts a live page using it. Whether the list endpoint exists is cannot-verify (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/advances/page.tsx`
- **Fix steps:**
  1. Check with the finance-service owner that GET /v1/finance/advances exists; if yes, correct the stale comment in advances/page.tsx (it says the GET 404s).
  2. If it does 404, then finance/expenditure/advances is the broken page - raise a separate finding and switch that page to the hrms advances loader.
  3. Do not delete getFinanceAdvances while expenditure/advances/page.tsx imports it.
- **Acceptance:**
  - Hit /finance/expenditure/advances against a running gateway: rows render (endpoint exists) or the failure is surfaced via RefreshErrorState.
  - Comment matches reality.
- **Needs:** backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; deleting the loader would break expenditure/advances.


---
## /finance/audit-paras  —  `finance/audit-paras.html`

- **Source:** `apps/web/src/app/(app)/finance/audit-paras/page.tsx`
- **Design reference:** `redesign/finance/audit-paras.html`

### GAP-FINANCE-AUDIT-PARAS-01  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** StatusPill maps "open" to the green "good" variant and leaves escalated/dropped/responded/settled on the neutral info default (StatusPill.tsx:5-12 STATUS_MAP), so on an audit register an unresolved CAG objection looks like "approved" while the stat card calls it 🔴 Open (page.tsx:25).
- **Verified evidence:** ds/StatusPill.tsx STATUS_MAP has open:'good' (green); responded, settled, escalated, dropped are not listed so they get the neutral 'info' fallback. The list renders status via DataTable cellType 'status' (DataTable.tsx:127 -> StatusPill) in AuditParasTable.tsx:62, and page.tsx:25 labels the stat card '🔴 Open', contradicting the green pill. (Line refs in the finding, STATUS_MAP lines 5-12, are approximate; the map starts at line 5.) escalated/dropped are real statuses per page.tsx:7-10 comment.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/finance/audit-paras/AuditParasTable.tsx`, `apps/web/src/app/(app)/finance/audit-paras/[id]/page.tsx`
- **Fix steps:**
  1. Add optional `variant?: PillVariant` prop to StatusPill (overrides STATUS_MAP).
  2. Create finance/audit-paras/auditParaTone.ts: open->'bad', escalated->'bad', responded->'warn', settled->'good', dropped->'mut'.
  3. In AuditParasTable use column render: (r)=><StatusPill status={r.status} variant={auditParaTone(r.status)}/> instead of cellType 'status'.
  4. Do not change global open:'good' (used by other modules) unless product agrees.
- **Acceptance:**
  - Unit test auditParaTone for all 5 statuses.
  - Render list with an open para -> pill class 'pill bad' and label 'Open'.
  - Escalated shows red, not blue.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; visual only, but audit register users rely on colour cues.

### GAP-FINANCE-AUDIT-PARAS-02  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Failed fetch reads as a clean audit record: zeros in all four stat cards and "No CAG audit observations found." (page.tsx:34; AuditParasTable.tsx:36-37) with only a small badge to say otherwise.
- **Verified evidence:** page.tsx:6,12-14,24-27: on source==='error' paras=[] so all four StatCards show numeric 0 (StatCard accepts number|string|null; page never passes '—'). Table: AuditParasTable.tsx:46-54 uses useSeededResource (may show cached rows; otherwise provenance 'error-no-data') and renders <DataSourceBadge> which prints 'Couldn't load - showing nothing' (DataSourceBadge.tsx:71) above the DataTable, whose empty state says 'No audit paras / No CAG audit observations found' (AuditParasTable.tsx:73-75). So an error signal exists (a Badge), but stat cards are unqualified zeros and the empty message contradicts the badge. Also cached rows can appear under fresh-looking 0 cards because cards use server data, not the seeded hook.
- **Files to change:** `apps/web/src/app/(app)/finance/audit-paras/page.tsx`, `apps/web/src/app/(app)/finance/audit-paras/AuditParasTable.tsx`
- **Fix steps:**
  1. In page.tsx, when source==='error' render <RefreshErrorState error={toHumanError('load',{area:'audit paras'})} backHref='/finance'/> in place of StatGrid+Card (LoadErrorState if status===403).
  2. Alternatively pass value={source==='error' ? '—' : n} to each StatCard and compute counts inside AuditParasTable from `rows` so cards and table share provenance.
  3. Set DataTable emptyMessage conditionally (provenance==='error-no-data' -> do not render DataTable at all).
- **Acceptance:**
  - Mock loader error -> no zeros, Retry button present.
  - Ok-but-empty -> zeros and 'No CAG audit observations found.' still shown.
  - Cached-provenance: cards and rows agree.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Same pattern as ALLOCATION-02 and DEMAND-GRANTS-01: fix as one shared FinanceListPage helper.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-AUDIT-PARAS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Escalated and dropped paras are counted in Total but in no card (page.tsx:12-14); Total ≠ Open+Responded+Settled, the discrepancy the code comment (page.tsx:6-11) says it fixed for "settled" but not for these two.
- **Verified evidence:** page.tsx:12-14 count only open, responded, settled; StatCards at 24-27 show Total=paras.length plus those three. Escalated and dropped paras (valid statuses per comment :7-10) are counted in Total but in no card, so Total != Open+Responded+Settled. The comment claims the misleading bucketing was fixed but the two remaining statuses are hidden.
- **Files to change:** `apps/web/src/app/(app)/finance/audit-paras/page.tsx`
- **Fix steps:**
  1. Add const escalated = count('escalated'); const dropped = count('dropped'); replace with a single helper countBy(status).
  2. Add an 'Escalated' StatCard (bad tone icon) and fold dropped into a 'Dropped/Other' card, or change layout to 6 cards.
  3. Assert in dev/test that sum of buckets === paras.length (any unknown status goes to 'Other').
- **Acceptance:**
  - Unit/page test with 1 of each of 5 statuses: cards show 5 total, 1 each.
  - Unknown status 'foo' lands in Other so Total always reconciles.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-AUDIT-PARAS-01

### GAP-FINANCE-AUDIT-PARAS-04  ·  MEDIUM  ·  partly  ·  theme DATEFMT (was MONEY)

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** "Raised" prints createdAt as the raw ISO timestamp and "Amount" formatMoney of moneyValueMinor with no Cr/L shorthand for ₹5.3 Cr rows (AuditParasTable.tsx:22-23).
- **Verified evidence:** AuditParasTable.tsx:60-61: 'Raised' column key createdAt has no render/cellType so DataTable.cellValue (DataTable.tsx:138) prints String(row.createdAt) - raw ISO timestamp (confirmed). 'Amount' uses cellType 'amount' -> formatMoney(bigint|number|string) which is exact and grouped (lib/formatters.ts:90-131), e.g. ₹5,30,00,000.00; it is paise-correct, so 'MONEY' problems are not present, only no Cr/L shorthand. Shorthand helpers exist only as three local duplicates (MonitoringTable.tsx:10, monitoring/page.tsx:9, FundReleasesTable.tsx:10) that use Number(BigInt)/100 floats. Full precision on an audit register is arguably correct; the shorthand is a presentation choice.
- **Files to change:** `apps/web/src/app/(app)/finance/audit-paras/AuditParasTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Give the Raised column render: (r)=>formatIndianDate(r.createdAt) (formatters.ts:2); fix formatIndianDate to pass timeZone:'Asia/Kolkata' for stability.
  2. Decision: keep full-precision formatMoney for the register; optionally add formatMoneyCompact(minor: bigint|number|string) to lib/formatters.ts doing bigint math (>=1e9 paise -> Cr, >=1e7 -> L) and replace the three local rupees() copies.
  3. If compact is adopted, show full amount in a title/tooltip attribute.
- **Acceptance:**
  - Raised shows 'dd/mm/yyyy', not '2026-09-01T05:30:00.000Z'.
  - Unit tests for formatMoneyCompact: 530000000n paise -> '₹5.30 Cr'; 1234500n -> '₹12,345.00' or '₹0.12 L' per decision.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money display only; do not lose exact paise in exports (DataTable export uses formatMoney at :268).

### GAP-FINANCE-AUDIT-PARAS-05  ·  LOW  ·  partly  ·  theme MISSING-FEATURE (was DEADROUTE)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Row link is a plain anchor on the whole row through rowLinkKey/rowLinkPrefix; there is no per-row action (respond, escalate) so the register is read-only from the list.
- **Verified evidence:** AuditParasTable.tsx:65-66 sets rowLinkKey='id', rowLinkPrefix='/finance/audit-paras/'. DataTable.tsx:57 documents it as linking the FIRST column (resolveHref at :210-213), not the whole row as the finding says. The list has no action column or buttons, and the detail page is read-only (see DETAIL-04), so 'read-only' is true. Missing respond/escalate is a feature gap, tag DEADROUTE is wrong; nothing links to a non-existent route.
- **Files to change:** `apps/web/src/app/(app)/finance/audit-paras/AuditParasTable.tsx`
- **Fix steps:**
  1. Do nothing here until GAP-FINANCE-AUDIT-PARAS-DETAIL-04 decides whether mutation endpoints exist.
  2. If they do, add a per-row 'Respond' link to the detail page (deep link #reply) via a column render rather than inline mutation.
- **Acceptance:**
  - Decision documented; if built, the row action navigates to the detail reply form.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-AUDIT-PARAS-DETAIL-04


---
## /finance/audit-paras/[id]  —  `finance/audit-paras-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/audit-paras/[id]/page.tsx`
- **Design reference:** `redesign/finance/audit-paras-detail.html`

### GAP-FINANCE-AUDIT-PARAS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** A failed fetch renders "Audit para not found — This audit para may have been removed or the ID is invalid." (page.tsx:52-58): getFinanceAuditParaById returns null on error (loaders.ts:2186-2191) and the DataSourceBadge at page.tsx:76 can never show because that branch is only reached with a para.
- **Verified evidence:** audit-paras/[id]/page.tsx:50-59: `if (!para)` renders EmptyState 'Audit para not found - may have been removed or the ID is invalid' for every null. getFinanceAuditParaById (loaders.ts:2186-2193) passes empty=null to fetchJson, which returns {data:null, source:'error', status?} on network/5xx/403/schema failure (apiClient.ts:119-172), so a transient failure looks like a deleted CAG para. The DataSourceBadge at :76 sits after the guard, so it is unreachable for source==='error' (para is null) - dead code. LoaderResult already carries `status`; hr/apar/[id]/page.tsx:97-104 shows the correct pattern (404 -> not found, else RefreshErrorState).
- **Files to change:** `apps/web/src/app/(app)/finance/audit-paras/[id]/page.tsx`
- **Fix steps:**
  1. Destructure `result` (with status, errorMessage) from getFinanceAuditParaById.
  2. If result.source==='error' && result.status!==404: return PageHeader + <RefreshErrorState error={toHumanError('load',{area:'audit para'})} backHref='/finance/audit-paras'/> (or LoadErrorState for 403).
  3. Keep the 'not found' EmptyState only for status===404 (or source ok with null).
  4. Remove the now-dead badge at line 76.
- **Acceptance:**
  - Mock loader {source:'error',status:503} -> RefreshErrorState with Retry, not 'not found'.
  - Mock status 404 -> not-found EmptyState.
  - Mock 403 -> access-restricted message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; compliance users no longer misread an outage as a deleted para.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-AUDIT-PARAS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Response shape is guessed: three-to-four alternative field names per value (page.tsx:6-47) instead of one typed contract; a backend rename silently turns Observation/Reply/Timeline into "No … on file". The status/amount names conflict with FinanceAuditParaSummary used by the list.
- **Verified evidence:** [id]/page.tsx:6-47: field(para,'paraNo','paraNumber'), 'dept'/'department', longText(...'observation','narrative','description','subject'), reply/'departmentReply'/'response', 'actionTaken'/'action', timeline from 'timeline'|'events'|'history' with per-row alias lists; amountMinorOf(...'moneyValueMinor','amountMinor','amount'). The param is typed as FinanceAuditParaSummary (loaders.ts:2186) but treated as Record<string,unknown>, so the type checker cannot catch a rename. The list uses moneyValueMinor/status/dept/source (AuditParasTable.tsx) - only the amount alias list overlaps and 'amount' could be rupees vs paise (ambiguous unit). The real type in @civitasone/types and the backend audit/routes.ts response are not in the snapshot -> exact canonical names cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/audit-paras/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Get the canonical GET /v1/finance/audit-paras/:id shape from services/finance-service audit module (or @civitasone/types) and define FinanceAuditParaDetail (extends FinanceAuditParaSummary) with observation, reply, actionTaken, timeline[].
  2. Make FinanceAuditParaDetailSchema a strict zod schema and use it as responseSchema in getFinanceAuditParaById; return typed data.
  3. Rewrite the page to read typed fields directly; delete field()/longText()/timelineOf()/amountMinorOf() alias lists.
  4. Drop 'amount' alias so the unit is only moneyValueMinor (paise).
- **Acceptance:**
  - Unit test: schema parse fails loudly on a payload with renamed field (loader returns source error, not silent 'No observation on file').
  - Type-check fails if page reads a non-existent field.
  - Detail values match the list row for the same para.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Strict schema may surface latent backend mismatches on real data; roll out with the loader telemetry (finance.audit-para.detail) watched.
- **Depends on:** GAP-FINANCE-AUDIT-PARAS-DETAIL-01

### GAP-FINANCE-AUDIT-PARAS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Status stat card prints the raw string (field(para,"status"), page.tsx:63,82) e.g. "open" lowercase, while the pill in Action Taken humanizes it; and StatusPill paints "open" green (StatusPill.tsx STATUS_MAP) on an unresolved objection.
- **Verified evidence:** [id]/page.tsx:63 status=field(para,'status'); :82 <StatCard label='Status' value={status}> prints the raw string (e.g. 'open'), while :102 <StatusPill status={status}/> humanizes via humanizeStatus (ds/StatusPill.tsx last line). StatusPill.tsx STATUS_MAP has open:'good' (green); escalated/responded/settled/dropped are unmapped and fall to 'info'. Same root cause as GAP-FINANCE-AUDIT-PARAS-01.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/finance/audit-paras/[id]/page.tsx`
- **Fix steps:**
  1. Apply the shared tone fix from GAP-FINANCE-AUDIT-PARAS-01 (optional `variant` prop or audit-para tone map).
  2. In page.tsx:82 render humanizeStatus(status) (from @/lib/formatters) or <StatusPill status={status} variant={auditParaTone(status)}/> instead of the raw string; hide the pill when status is '—'.
- **Acceptance:**
  - Detail of an 'open' para shows 'Open' in warn/bad tone in both places.
  - Snapshot test for StatusPill audit tones.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; scope tone change to audit paras so 'open' elsewhere stays green.
- **Depends on:** GAP-FINANCE-AUDIT-PARAS-01

### GAP-FINANCE-AUDIT-PARAS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme MISSING-FEATURE (was DEADROUTE)

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** Read-only page for a workflow object: no way to record the department reply, escalate or settle from the UI, so "Department Reply" can only ever show what another system wrote.
- **Verified evidence:** [id]/page.tsx is a pure read view: no client component, form, or fetch in the file and no sibling actions file (dir has only page.tsx/error/loading). So 'Department Reply', 'Action Taken' and status can only display what the backend holds. Whether the backend exposes reply/escalate/settle mutations is cannot-verify (finance-service audit/routes.ts absent); the schema comment mentions statuses open|responded|settled|escalated|dropped, implying a workflow exists somewhere. Also this is a missing feature, not a broken link, so DEADROUTE tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/audit-paras/[id]/AuditParaActions.tsx`, `apps/web/src/app/(app)/finance/audit-paras/[id]/page.tsx`
- **Fix steps:**
  1. Decision/backend: confirm the mutation endpoints (respond, escalate, settle) and roles allowed; if none exist, document as out of scope.
  2. Create AuditParaActions.tsx (client): 'Record reply' textarea + 'Escalate' and 'Settle' buttons using ConfirmDialog with requireReason and x-idempotency-key like JournalEntryForm; POST via /api/proxy.
  3. Render it in page.tsx gated by role (getSessionRoles) and by current status; router.refresh() on success.
- **Acceptance:**
  - Only allowed roles see actions; a reply POST moves status to 'responded' and shows in the card after refresh.
  - Backend 403 shows the specific message.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Audit compliance workflow: mutations need audit events and maker-checker on the backend; do not ship UI ahead of endpoints.
- **Depends on:** GAP-FINANCE-AUDIT-PARAS-DETAIL-02


---
## /finance/benefits  —  `finance/benefits.html`

- **Source:** `apps/web/src/app/(app)/finance/benefits/page.tsx`
- **Design reference:** `redesign/finance/benefits.html`

### GAP-FINANCE-BENEFITS-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** finance/layout.tsx:29-36 gates all /finance/* children on FINANCE_ROLES before the page runs, so non-finance users with an old /finance/benefits bookmark get PermissionDenied instead of the redirect to /hr/benefits.
- **Verified evidence:** finance/benefits/page.tsx:11 redirect('/hr/benefits'); finance/layout.tsx:29-36 renders PermissionDenied for roles outside FINANCE_ROLES before the child page runs (same mechanism as ADVANCES-01). hr/benefits/page.tsx exists.
- **Files to change:** `apps/web/next.config.js`, `apps/web/src/app/(app)/finance/layout.tsx`
- **Fix steps:**
  1. Add redirects() entry {source:'/finance/benefits',destination:'/hr/benefits',permanent:true} next to the advances one (see ADVANCES-01).
  2. Delete finance/benefits/page.tsx.
- **Acceptance:**
  - Employee-only role opens /finance/benefits -> /hr/benefits.
  - No PermissionDenied flash.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-ADVANCES-01

### GAP-FINANCE-BENEFITS-02  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Redirect drops any query string / deep link state (page.tsx:11 redirects to a constant path).
- **Verified evidence:** finance/benefits/page.tsx:9-11 takes no searchParams and calls redirect('/hr/benefits') - any query string (?employee=..., filters) is dropped. Impact is minimal since the old page was superseded and no in-app link targets /finance/benefits (grep of apps/web/src finds none besides the redirect itself).
- **Files to change:** `apps/web/next.config.js`
- **Fix steps:**
  1. Use next.config.js redirects (ADVANCES-01/BENEFITS-01): Next preserves the query string on config redirects automatically.
  2. If the page file is kept, accept searchParams and append new URLSearchParams(searchParams) to the redirect target.
- **Acceptance:**
  - GET /finance/benefits?x=1 -> 308 to /hr/benefits?x=1.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Very low; consider closing as won't-fix if the redirect file is deleted.
- **Depends on:** GAP-FINANCE-BENEFITS-01


---
## /finance/budget/allocation  —  `finance/budget-allocation.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/allocation/page.tsx`
- **Design reference:** `redesign/finance/budget-allocation.html`

### GAP-FINANCE-BUDGET-ALLOCATION-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** "Budget Head" column prints the raw headId (uuid) from the row (AllocationTable.tsx:19): an officer cannot tell which major/minor head a row is; no code or name is fetched.
- **Verified evidence:** AllocationTable.tsx:54 column { key:'headId', label:'Budget Head' } with no render, so the raw UUID is printed; page.tsx:24 also counts distinct headId. No head-name field on FinanceBudgetAllocationSummary is used anywhere in the page. Names exist server-side as accounts: formulation/new/page.tsx:20,117 loads /api/proxy/v1/finance/accounts (AccountRow {id, code, name}) and posts headId = account id, so headId is an accounts id. But loaders.ts mapAccounts (628-647) drops `id`, so getChartOfAccounts cannot currently resolve it. Type FinanceBudgetAllocationSummary itself is in @civitasone/types (not in snapshot) -> cannot verify whether it already carries headName/headCode.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/finance/budget/allocation/page.tsx`, `apps/web/src/app/(app)/finance/budget/allocation/AllocationTable.tsx`, `apps/web/src/app/(app)/finance/budget/monitoring/MonitoringTable.tsx`
- **Fix steps:**
  1. Check whether the budget-allocations API already returns head code/name; if so, map and display them (preferred, backend join stays in the service).
  2. Otherwise extend mapAccounts to keep `id` (AccountSummary.id?) and in allocation/page.tsx fetch getChartOfAccounts() in parallel (Promise.all), build a Map<id,{code,name}> and pass headLabels to AllocationTable.
  3. In AllocationTable render column: (r)=> `${code} - ${name}` falling back to a shortened id with title=full uuid when unknown.
  4. Same for MonitoringTable.tsx:75 ('Head ID').
- **Acceptance:**
  - Row shows '3054 - Roads and Bridges' not a uuid; unknown head shows '-' with tooltip.
  - Unit test on the label mapper.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong join would mislabel a budget head, so map by id only.

### GAP-FINANCE-BUDGET-ALLOCATION-02  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Failed fetch shows four real zeros and "No budget allocation records found." (page.tsx:31,11-25; AllocationTable.tsx:34-35).
- **Verified evidence:** page.tsx:6-11,20-25 on source==='error' allocations=[] -> StatCards Allocations 0, Committed 0, Pending 0 (allocations.length-committed), Budget Heads 0; AllocationTable.tsx:43-51 renders DataSourceBadge (provenance) which shows 'Couldn't load - showing nothing' when there is no cache, then DataTable empty state 'No budget allocation records found.' (AllocationTable.tsx:68-70). So a warning badge exists, but zero cards and 'no records' message contradict it; amounts are not shown as 0, only counts.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/allocation/page.tsx`, `apps/web/src/app/(app)/finance/budget/allocation/AllocationTable.tsx`
- **Fix steps:**
  1. In page.tsx if source==='error' return PageHeader + <RefreshErrorState error={toHumanError('load',{area:'budget allocations'})} backHref='/finance'/> (LoadErrorState when status 403).
  2. Or pass '—' to the four StatCards and hide the DataTable when provenance==='error-no-data'.
  3. Share this with AUDIT-PARAS-02 and DEMAND-GRANTS-01 via a small finance list-page wrapper.
- **Acceptance:**
  - Mock error -> Retry UI, no zeros.
  - Success-empty -> zeros with 'No budget allocation records found.'
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-BUDGET-ALLOCATION-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** Orphaned flow: budget/allocation/ReappropriateWithApproval.tsx (eOffice re-appropriation, header comment lines 3-13) is not imported by page.tsx or AllocationTable.tsx, so re-appropriation cannot be started from the UI.
- **Verified evidence:** budget/allocation/ReappropriateWithApproval.tsx (header lines 3-13: POST /v1/finance/reappropriations/{uuid}/submit-approval then /v1/estab/files/from-module) is imported nowhere: grep of apps/web/src returns only its own file. page.tsx and AllocationTable.tsx do not render it, so re-appropriation cannot be started from the UI. Component uses a client-generated UUID and a UUID_RE, taking budgetId/headId as typed text (see also ALLOCATION-01 on raw ids). Endpoint existence cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/allocation/page.tsx`, `apps/web/src/app/(app)/finance/budget/allocation/ReappropriateWithApproval.tsx`
- **Fix steps:**
  1. Decision: wire or delete. If wire: render <ReappropriateWithApproval/> in the PageHeader actions of allocation/page.tsx, gated by budget/finance approver roles via getSessionRoles().
  2. Replace its free-text budgetId/headId inputs with selects fed from the allocations rows (props) to avoid raw uuid entry.
  3. Verify amount handling uses rupeesToMinorString (lib/money.ts), not float math.
  4. If not wiring, delete the file.
- **Acceptance:**
  - Button visible for permitted roles; submitting creates the re-appropriation and eFile and shows the file ref.
  - No dead files remain (grep).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Budget movement approval flow: must keep eOffice approval and audit; do not enable without backend consumer confirmed.
- **Depends on:** GAP-FINANCE-BUDGET-ALLOCATION-01

### GAP-FINANCE-BUDGET-ALLOCATION-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Subtitle promises "release" but the summary has no released field (page.tsx:7-10 comment); "Pending" card = allocations with zero commitment, easy to read as approval pending; subtitle says department-wise but rows are per head.
- **Verified evidence:** page.tsx:17 subtitle 'Department-wise allocation, release, and utilization.' while the comment (7-10) says the summary has no released field and the card was renamed 'Committed' (22). Row grain is per budget head + FY (AllocationTable columns 54-59), not department. 'Pending' card (line 23) = allocations.length - committed, i.e. rows with zero commitment, not approvals pending. The same subtitle text is in the hub tile (finance/page.tsx 'Budget Allocation').
- **Files to change:** `apps/web/src/app/(app)/finance/budget/allocation/page.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Change subtitle to 'Allocation, commitment and expenditure by budget head and financial year.' in page.tsx:17 and the hub tile description.
  2. Rename card 'Pending' to 'Not yet committed' (or 'Uncommitted heads').
  3. Optionally add tooltip via HelpTip explaining the definition.
- **Acceptance:**
  - Copy no longer says release/department-wise; card label states its meaning.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; check i18n keys if the hub is translated (next-intl).

### GAP-FINANCE-BUDGET-ALLOCATION-05  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Money via cellType "amount" = formatMoney full precision (₹18,00,00,000.00) - compare fund-releases/monitoring which use a "₹x.xx Cr/L" shorthand: three formats within one module.
- **Verified evidence:** AllocationTable.tsx:56-59 use cellType 'amount' -> formatMoney (exact bigint math, ₹18,00,00,000.00). Compact 'Cr/L' formats exist only as duplicated local helpers in MonitoringTable.tsx:10, budget/monitoring/page.tsx:9 and FundReleasesTable.tsx:10 (float Number(BigInt)/100, toFixed). So inconsistency across the budget module is real, but the full-precision variant is the correct/exact one; the compact ones are lossy and duplicated. (Finding said 'fund-releases/monitoring' - accurate.)
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/finance/budget/monitoring/MonitoringTable.tsx`, `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`, `apps/web/src/app/(app)/finance/budget/fund-releases/FundReleasesTable.tsx`
- **Fix steps:**
  1. Decision: standardise on compact for stat cards/summary and full formatMoney for tables (recommended).
  2. Add formatMoneyCompact(minor: bigint|number|string) in lib/formatters.ts with bigint arithmetic; unit-test it.
  3. Replace the three local rupees() helpers with it; keep formatMoney in tables/exports.
- **Acceptance:**
  - grep for local 'toFixed(2)} Cr' returns none.
  - formatMoneyCompact(1800000000n) === '₹18.00 Cr'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money display; ensure rounding never hides paise in reconciliation tables.
- **Depends on:** GAP-FINANCE-AUDIT-PARAS-04


---
## /finance/budget/demand-grants  —  `finance/budget-demand-grants.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/demand-grants/page.tsx`
- **Design reference:** `redesign/finance/budget-demand-grants.html`

### GAP-FINANCE-BUDGET-DEMAND-GRANTS-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Failed fetch shows 0 Total / 0 Voted / 0 Charged / 0 Services and "No demand for grants records found." (page.tsx:19-22; DemandGrantsTable.tsx:33-34).
- **Verified evidence:** demand-grants/page.tsx:6-9,19-22: on source==='error' grants=[] so Total/Voted/Charged/Services StatCards show 0; DemandGrantsTable.tsx:41-49 shows the DataSourceBadge ('Couldn't load - showing nothing') and then the DataTable empty state 'No demands / No demand for grants records found.' (66-67). A badge is present, but the cards are unqualified zeros. No amounts are affected.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/demand-grants/page.tsx`, `apps/web/src/app/(app)/finance/budget/demand-grants/DemandGrantsTable.tsx`
- **Fix steps:**
  1. In page.tsx on source==='error' return PageHeader + <RefreshErrorState error={toHumanError('load',{area:'demand for grants'})} backHref='/finance'/> instead of cards and table.
  2. Or pass '—' to the StatCards and suppress DataTable when provenance==='error-no-data'.
- **Acceptance:**
  - Mock error -> Retry UI, no zeros.
  - Empty ok -> zeros + empty message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-FINANCE-AUDIT-PARAS-02

### GAP-FINANCE-BUDGET-DEMAND-GRANTS-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Page and subtitle say "Parliamentary demand for grants" (page.tsx:15; also the hub tile description, finance/page.tsx:14) though the tenant is a State department whose grants are voted by the Legislative Assembly; copy is Union-specific.
- **Verified evidence:** demand-grants/page.tsx:15 subtitle 'Parliamentary demand for grants with voted/charged breakup.' and finance/page.tsx hub tile carries the same text. glossary.ts:36 already words Voted as "Parliament's or the Assembly's approval", so the glossary is neutral while these two strings are Union-specific. Whether the tenant is a State department is a product fact I cannot verify from code; the finding's tag WIRING is wrong (copy).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/demand-grants/page.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Replace with neutral copy: 'Demands for grants with voted/charged breakup.' (or read a tenant label from orgConfig.ts if it has a legislature name).
  2. Update the hub tile description to match; check next-intl message files if translated.
- **Acceptance:**
  - No 'Parliamentary' string in finance UI (grep).
  - Copy signed off by product for State vs Union.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-BUDGET-DEMAND-GRANTS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Voted + Charged need not equal Total: the two card counts filter on class (page.tsx:8-9) and any other class value is uncounted with no "Other" card; Class value is shown as lowercase raw "voted"/"charged" text (DemandGrantsTable.tsx:21).
- **Verified evidence:** page.tsx:8-9 voted and charged filter on String(g.class).toLowerCase(); any other class (or empty) is in Total (line 19) but in neither card, so Voted+Charged can be < Total. DemandGrantsTable.tsx:54 Class column has no render, so it prints the raw value ('voted'/'charged' lowercase). The comment at :7 says the DB column is voted|charged, so gap may be theoretical if a DB CHECK exists - cannot verify (backend absent).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/demand-grants/page.tsx`, `apps/web/src/app/(app)/finance/budget/demand-grants/DemandGrantsTable.tsx`
- **Fix steps:**
  1. Add other = grants.length - voted - charged and show an 'Other' StatCard only when > 0 (or always).
  2. Add Class column render: (r)=>humanizeStatus(String(r.class)) from @/lib/formatters (verify it capitalises) or a Voted/Charged label map.
- **Acceptance:**
  - Test with class 'voted','charged','x' -> cards 1,1,Other 1.
  - Table shows 'Voted' not 'voted'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-BUDGET-DEMAND-GRANTS-04  ·  LOW  ·  confirmed  ·  theme MISSING-FEATURE (was OTHER)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** No row link or detail route exists for a demand, so demand line items (per major head) cannot be inspected from here.
- **Verified evidence:** DemandGrantsTable.tsx:50-64 sets no rowLinkKey/rowHref; no finance/budget/demand-grants/[id] directory exists (only DemandGrantsTable, error, loading, page). So no drill-down. Existence of a per-demand line-item API is cannot-verify; this is a missing feature rather than a broken link.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/demand-grants/[id]/page.tsx`, `apps/web/src/app/(app)/finance/budget/demand-grants/DemandGrantsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Backend/decision: confirm a GET for a demand and its per-major-head lines exists (loaders.ts:2058 only lists /finance/budgets/demand-grants).
  2. If yes add getFinanceDemandGrantById loader, [id]/page.tsx (with RefreshErrorState on error) and rowLinkKey='id' rowLinkPrefix in the table.
  3. If no, record as backlog and leave as-is.
- **Acceptance:**
  - Row click opens the demand with head-wise lines totalling the demand amount.
  - 404 vs error handled distinctly.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; read-only.

### GAP-FINANCE-BUDGET-DEMAND-GRANTS-05  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Status is StatusPill of an open string; unmapped values fall to the info default (StatusPill.tsx:52-60 in ds).
- **Verified evidence:** DemandGrantsTable.tsx:56 status column cellType 'status' -> StatusPill (DataTable.tsx:127). ds/StatusPill.tsx line ~40-48: STATUS_MAP[status.toLowerCase()] ?? 'info', so unmapped values are neutral blue-ish, as claimed, though the finding's line refs (52-60) are wrong; the fallback is in the component body near the end of the file. Label is humanized, not raw. The status vocabulary for demands is not visible (type in @civitasone/types, backend absent), so which values are unmapped is cannot-verify; 'info' as a neutral default is intentional per the file comment.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Obtain the demand status enum (e.g. draft, submitted, voted, passed) from the finance-service budget module.
  2. Add any missing keys to STATUS_MAP (e.g. voted/lapsed) or pass `variant` via the new prop from AUDIT-PARAS-01.
  3. Add a unit test listing every enum value with expected variant.
- **Acceptance:**
  - Every enum value has an explicit tone (test iterates the enum).
- **Needs:** backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; tone changes shared by other modules that reuse the same keys.
- **Depends on:** GAP-FINANCE-AUDIT-PARAS-01


---
## /finance/budget/formulation  —  `finance/budget-formulation.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/formulation/page.tsx`
- **Design reference:** `redesign/finance/budget-formulation.html`

### GAP-FINANCE-BUDGET-FORMULATION-01  ·  HIGH  ·  confirmed  ·  theme LABEL-MISMATCH (was I18N)

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Column labels do not match the fields: "Last Year (BE)" renders releasedAmount and "Proposed (BE)" renders sanctionedAmount (FormulationTable.tsx:50-51,74-75); a clerk reads released funds as last year's estimate. Revised Estimates uses beMinor/reMinor from the same list, so the two pages disagree on what BE is.
- **Verified evidence:** FormulationTable.tsx:99-100 maps lastYear: b.releasedAmount and proposed: b.sanctionedAmount; columns at lines 123-124 label them "Last Year (BE)" and "Proposed (BE)" (obs line numbers 50-51,74-75 were off). Released/sanctioned funds are not last-year BE or proposed BE. RevisedEstimates page.tsx:97-98 uses b.beMinor/b.reMinor from the same getFinanceBudgets() list. BudgetSummary is in @civitasone/types which is absent from the snapshot, so the true prior-year BE source (beMinor of the previous FY row) cannot be verified. Theme I18N is wrong: this is a data-mapping/label defect, not i18n.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/FormulationTable.tsx`, `apps/web/src/app/(app)/finance/budget/formulation/page.tsx`
- **Fix steps:**
  1. Confirm BudgetSummary fields (beMinor, reMinor, sanctionedAmount, releasedAmount) with the finance-service owner.
  2. Change Row/columns: BE = b.beMinor (label "Budget Estimate (BE)"), Sanctioned = b.sanctionedAmount, Released = b.releasedAmount; drop the "Last Year" label unless the prior-FY row is looked up by head (group by majorHead+subHead, take FY-1 beMinor; else show "—").
  3. Keep cellType:"amount" (formatMoney) on paise strings.
  4. Apply the same field vocabulary in RevisedEstimates so the two pages agree (see REVISED-ESTIMATES-05).
- **Acceptance:**
  - Component test with fixture {beMinor:"1000000", sanctionedAmount:"500000", releasedAmount:"200000"}: BE column shows ₹10,000.00, Sanctioned ₹5,000.00, Released ₹2,000.00.
  - Test: Last Year column shows the FY-1 BE for the same head, or "—" when absent.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Finance officers may be reading these numbers today for decisions; changing meaning needs a sign-off on column definitions.
- **Depends on:** GAP-FINANCE-BUDGET-REVISED-ESTIMATES-05

### GAP-FINANCE-BUDGET-FORMULATION-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** "Proposed Outlay" is the sum of sanctionedAmount over all fiscal years (page.tsx:12,36), i.e. a multi-year total of sanctioned money, not this year's proposed outlay.
- **Verified evidence:** formulation/page.tsx:12 totalSanctioned = sum of BigInt(b.sanctionedAmount) over all budgets; line 36 renders it as "Proposed Outlay"; the card title (line 44) even says "all fiscal years". getFinanceBudgets() (loaders.ts:1864) takes no fy, so rows from every FY are summed. The sum is BigInt-safe, but semantically it is multi-year sanctioned, not this year's proposed BE.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/page.tsx`, `apps/web/src/app/_data/loaders.ts (getFinanceBudgets(fy?) if backend supports ?fy=)`
- **Fix steps:**
  1. Resolve fy from searchParams (validated with isValidFinancialYear, default currentFinancialYear()) and render <FyFilter/> in PageHeader actions, as monitoring/page.tsx does.
  2. Filter budgets by b.financialYear === fy (or pass ?fy= to the loader if finance-service supports it - verify) before computing stats.
  3. Compute Proposed Outlay as the sum of beMinor (proposed BE) for that FY, not sanctionedAmount; rename card title to "Budget estimates (BE) - FY {fy}".
  4. Keep BigInt summation and formatMoney.
- **Acceptance:**
  - Test: fixtures with two FYs; page for FY 2026-27 shows only that FY's total.
  - Card label and title include the selected FY.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Headline number used by finance; verify with owner which field is the 'proposed outlay'.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-01

### GAP-FINANCE-BUDGET-FORMULATION-03  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Failed fetch shows zero cards and the default "No records found" empty state (page.tsx:12-14).
- **Verified evidence:** formulation/page.tsx:7 destructures source but only passes it to FormulationTable (line 45). On error StatCards render budgets.length=0, uniqueHeads=0, pending=0 and formatMoney(0n) = ₹0.00 (lines 34-37); the table shows the default DataTable empty state. Overstated: FormulationTable.tsx:114 renders DataSourceBadge and useSeededResource derives provenance "error-no-data" so the amber "Couldn't load - showing nothing" pill is shown (resource.ts:208-213), and error.tsx exists for thrown errors. The cards still fabricate zeros. revised-estimates/page.tsx:116-145 is the correct pattern (toResourceState, "—" cards, RefreshErrorState).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/page.tsx`, `apps/web/src/app/(app)/finance/budget/fund-releases/page.tsx`, `apps/web/src/app/(app)/finance/budget/outcome-budget/page.tsx`, `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`
- **Fix steps:**
  1. Import toResourceState from @/app/_data/useResource and RefreshErrorState/toHumanError as revised-estimates/page.tsx does.
  2. const errored = toResourceState(result).status === "error"; pass value={errored ? null : x} to every StatCard (StatCard renders "—" for null).
  3. When errored render <RefreshErrorState error={toHumanError("load",{area:"budget estimates"})} backHref="/finance"/> in place of the table; decide whether to keep the cache fallback of useSeededResource (if kept, only replace the cards and rely on the badge).
  4. Extract a shared helper (see note) so the four budget pages do this identically.
- **Acceptance:**
  - Server test/mocked loader returning source "error": cards show "—", RefreshErrorState with Retry visible, no "No records found".
  - Loader ok with genuinely empty list: cards show 0 and empty state remains.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; be careful to preserve offline cached-data behaviour if desired.

### GAP-FINANCE-BUDGET-FORMULATION-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Major Heads card delta says "submitted N" but counts status === "approved" (page.tsx:35).
- **Verified evidence:** formulation/page.tsx:35: delta={`submitted ${budgets.filter(b => b.status === "approved").length}`} - label says submitted, filter is approved. The tab list in FormulationTable.tsx:60-67 separates Submitted/Approved/Pending, so this is inconsistent. Also uniqueHeads (line 15) counts distinct majorHead across all FYs, and the card is labelled "Major Heads".
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/page.tsx`
- **Fix steps:**
  1. Change the delta to `approved ${n}` or, if 'submitted' was intended, filter status === "submitted".
  2. Compute counts once (const byStatus = ...) and reuse for Pending Review card.
  3. Scope to the selected FY (see FORMULATION-02).
- **Acceptance:**
  - Test: fixtures with 2 approved, 1 submitted; delta text matches the label used.
  - Label and filter status strings share one constant.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Trivial.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-02

### GAP-FINANCE-BUDGET-FORMULATION-05  ·  LOW  ·  partly  ·  theme STATUS (was NAVUX)

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Tab "Submitted" and stat "Pending Review" are different statuses; a newly proposed estimate (new page) has no visible status path here.
- **Verified evidence:** FormulationTable.tsx:60-67 tabs Submitted/Approved/Pending map to statuses submitted/approved/pending, while the stat card (page.tsx:37) is "Pending Review" = status "pending", so the labels invite confusion. Cannot verify which status POST /v1/finance/budgets assigns to a new estimate (finance-service absent), so 'no visible status path' is unproven; the new page (new/page.tsx:86-89) does redirect to the list. Back navigation exists (PageHeader back=...).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/FormulationTable.tsx`, `apps/web/src/app/(app)/finance/budget/formulation/page.tsx`
- **Fix steps:**
  1. Get the budget status enum and initial state from finance-service (draft/pending/submitted/approved?).
  2. Make tab labels and card labels use one vocabulary (e.g. card "Awaiting approval" = tab "Pending").
  3. Add StatusPill mappings for all enum values (see REVISED-ESTIMATES-03).
  4. After creating an estimate, redirect with ?highlight=<id> or ?tab=Pending so the new row is visible.
- **Acceptance:**
  - Test: every status value in the enum renders a non-neutral pill and appears under exactly one tab.
  - Manual: create an estimate, land on the list and see it in the matching tab.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-BUDGET-REVISED-ESTIMATES-03


---
## /finance/budget/formulation/new  —  `finance/budget-formulation-new.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx`
- **Design reference:** `redesign/finance/budget-formulation-new.html`

### GAP-FINANCE-BUDGET-FORMULATION-NEW-01  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Amount conversion uses float: Math.round(Number(amount || "0") * 100).toString() (page.tsx:75) - values like 1234567.895 or > 2^53 paise are rounded/lost before the bigint-safe backend schema sees them; the header comment (page.tsx:4-11) stresses bigint safety, but the conversion itself is not.
- **Verified evidence:** apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx:75 does Math.round(Number(amount||"0")*100).toString(). Real: float multiply, and >=1e21 stringifies as exponent ("1e+21") which the bigint schema rejects; precision is lost above 2^53 paise. Overstated: input has type=number step=0.01 (line 136) so browser validity blocks 3-decimal values like 1234567.895 in practice. A correct string-based helper already exists: rupeesToMinorString() in apps/web/src/lib/money.ts:28 (rejects >2dp, negative, zero). The sibling AssessmentCreateForm.tsx:18 has the same float pattern (parseFloat*100).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx`, `apps/web/src/app/(app)/finance/budget/formulation/new/page.test.tsx (new)`
- **Fix steps:**
  1. Import rupeesToMinorString from @/lib/money in new/page.tsx.
  2. In submit(), replace line 75 with const beMinor = rupeesToMinorString(amount); if (beMinor === null) set a field error on the amount input ("Enter an amount in rupees with at most 2 decimals, greater than 0"), setIsError and return before fetch.
  3. Change the amount input from type=number to type=text inputMode=decimal (type=number hands the code a JS number-ish string and can emit exponent form for big values) and keep the pattern ^\d+(\.\d{1,2})?$.
  4. Show a live preview under the field using formatMoney(beMinor) so the clerk sees the paise value that will be sent.
  5. Add a test: "1234567.89" -> body beMinor "123456789"; "1.005" -> blocked, no fetch; "90071992547409.93" -> "9007199254740993" exactly.
- **Acceptance:**
  - Unit test: submitting 1234567.89 POSTs beMinor exactly "123456789".
  - Unit test: 1.005, -5, 0, abc and 1e21 never call fetch and show an inline error.
  - Manual: enter 90071992547409.93 and inspect network body; beMinor is "9007199254740993".
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money input path; zero is now rejected (was allowed by min=0) - confirm with finance that a zero BE is not a valid proposal. Consider fixing AssessmentCreateForm.tsx the same way in a follow-up.

### GAP-FINANCE-BUDGET-FORMULATION-NEW-02  ·  HIGH  ·  partly  ·  theme DATA-SCOPE (was PII)

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Budget head options are labelled "code · name" from GET /finance/accounts (page.tsx:127-129) - the full chart of accounts (limit 200, no type filter), not budget heads; a clerk can propose an estimate against a bank account or liability head.
- **Verified evidence:** new/page.tsx:46 fetches /api/proxy/v1/finance/accounts?limit=200 (no type/classification filter) and lines 119-121 render every row as "code · name". The chart-of-accounts/new/page.tsx:26-27 shows accounts carry classification asset/liability/equity/income/expense, so bank/liability heads are in this list. Not verifiable: whether GET accounts returns a classification field or accepts a filter, and whether POST /v1/finance/budgets rejects non-expense heads (finance-service is absent from the snapshot). Theme PII is wrong: this is a wrong-source/validation issue, not PII masking.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx`, `services/finance-service (backend: accounts list filter and budget create validation, not in snapshot)`
- **Fix steps:**
  1. Confirm with the finance-service owner whether GET /v1/finance/accounts supports ?classification=expense (or ?budgetable=true) and returns classification/level on each row.
  2. If yes, request /api/proxy/v1/finance/accounts?classification=expense&limit=200 (and extend AccountRow with classification, level).
  3. If no, ask backend to add the filter and to reject POST /v1/finance/budgets for non-expense/non-postable heads with a field error on headId (already displayed via formError.fieldError("headId")).
  4. Group options by level (major/minor/sub-minor) with optgroup so labels remain unambiguous.
  5. Interim client guard: if rows carry classification, filter to expense client-side.
- **Acceptance:**
  - Component test with mocked accounts of classification bank/liability/expense: only expense heads appear in the select.
  - Backend/contract test: POST /budgets with a liability headId returns 422 with headId error, page shows it under the field.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Budget posted against a non-budget head corrupts BE/expenditure roll-ups; backend enforcement is the real control, UI filter is only convenience.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-NEW-05

### GAP-FINANCE-BUDGET-FORMULATION-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** A one-click irreversible submit: no confirm dialog and no reason, unlike every other finance posting (FinanceActions.tsx, JournalEntryForm.tsx:443-451); success clears the amount and auto-redirects after 700 ms via setTimeout (page.tsx:86-89) so the confirmation is barely readable.
- **Verified evidence:** new/page.tsx:65-96 submit() POSTs immediately on form submit with no ConfirmDialog and no reason; lines 86-89 set "Budget estimate submitted.", clear amount, router.refresh() and setTimeout(router.push, 700). ConfirmDialog with requireReason exists at apps/web/src/app/_components/ds/ConfirmDialog.tsx:1-40 and is used by AssessmentCreateForm.tsx (confirmOpen state). The setTimeout is not cleared on unmount. Maker!=checker cannot be checked here (backend). Audit emission is backend (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx`
- **Fix steps:**
  1. Add confirmOpen state; the form's onSubmit validates and opens <ConfirmDialog> (from ../../../../../_components/ds) with a description "Propose BE of {formatMoney(beMinor)} for {head} FY {fy}", confirmLabel "Submit estimate".
  2. Move the fetch into the dialog's onConfirm; keep busy state passed to the dialog.
  3. Only add requireReason if the POST body/back-end accepts a reason; otherwise confirm-only (do not invent a field) - agree with backend.
  4. On success, render the message with a link "View in Budget Formulation" and navigate on user action, or push after ~2500ms with the timer stored in a ref and cleared on unmount.
  5. Verify backend emits the audit event for create budget; raise with finance-service if missing.
- **Acceptance:**
  - Component test: clicking Submit opens the dialog and issues no fetch; confirming issues exactly one POST.
  - Cancel/ESC closes the dialog with no request.
  - Success message stays visible until the user navigates or >=2.5 s.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; UX only. Maker-checker / audit emission is a backend property not verifiable from the web snapshot.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-NEW-01

### GAP-FINANCE-BUDGET-FORMULATION-NEW-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** No duplicate check or existing-estimate hint: the same head + FY can be submitted repeatedly (no idempotency header, unlike JournalEntryForm.tsx:74,152), so a double click creates two estimates.
- **Verified evidence:** new/page.tsx:76-80 sends no x-idempotency-key, unlike finance/journal-entry/JournalEntryForm.tsx:74,159 (crypto.randomUUID key). The proxy already forwards it (app/api/proxy/[...path]/route.ts:7). Overstated: the submit button is disabled={busy || !headId} (line 142) and setBusy(true) runs synchronously at line 67, so a normal double click is blocked; the residual risk is a retry after a network timeout or re-entering the form for the same head+FY. There is no existing-estimate hint. Whether the backend dedupes head+FY is cannot-verify (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx`
- **Fix steps:**
  1. Add const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID()) and send it as the x-idempotency-key header (same as JournalEntryForm.tsx:159); rotate it only after a successful save.
  2. Guard submit with an early return if busy (belt and braces for fast double submit).
  3. On 409/duplicate response from the backend, surface via formError.fromResponse and offer a link to the existing estimate.
  4. Optionally fetch /v1/finance/budgets?fy=<fy> once headId+fy chosen and show "An estimate already exists (BE ₹x)" - only if the endpoint supports it (verify).
- **Acceptance:**
  - Test: two rapid submit events produce one fetch, header x-idempotency-key present and identical on a retry.
  - Test: after success the key changes for the next form use.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; idempotency only effective if the backend honours the header for POST /budgets (verify).

### GAP-FINANCE-BUDGET-FORMULATION-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** Client-only fetch with no loading state for heads and a silent 200-row cap (page.tsx:46 limit=200); a tenant with more accounts sees a truncated list with no hint.
- **Verified evidence:** new/page.tsx:42-63 fetches ?limit=200 client-side in useEffect; no loading flag exists (the select is simply empty with only the disabled "Select a head…" option until it resolves), no truncation hint, no search (native <select>). loadError is shown on failure (lines 109-111) so error is not silent, but the cap is. chart-of-accounts/new/page.tsx:41 uses the same pattern.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new, shared)`
- **Fix steps:**
  1. Add accountsLoading state; disable the select and show "Loading heads…" option until resolved.
  2. Replace <select> with a new shared <EntityPicker> (async search: query param q, debounced, paging) backed by the accounts endpoint; verify with backend that q/cursor is supported, else add.
  3. Until then, if response length === 200 show a hint "Showing first 200 heads - refine by searching" and never present the list as complete.
  4. Combine with the expense-only filter from NEW-02 so the list is small.
- **Acceptance:**
  - Test: mock response with 200 rows shows the truncation hint; fewer rows do not.
  - Test: select is disabled with a loading option while the fetch is pending.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; new shared picker will be reused by fund-releases office/head fields.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-NEW-02

### GAP-FINANCE-BUDGET-FORMULATION-NEW-06  ·  LOW  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** fy is a free-text field validated only by a regex pattern; "2026-28" passes; default is derived from the client clock (page.tsx:24-28).
- **Verified evidence:** new/page.tsx:129 uses pattern="\d{4}-\d{2}" only; "2026-28" and "2026-99" pass client-side (the backend may reject; not verifiable). defaultFy() (lines 24-28) uses the browser's local clock/getMonth, not IST; the shared currentFinancialYear() in apps/web/src/lib/fiscalYear.ts is IST-correct and validates via financialYearOf. Note the same-file fiscalYearLabel/recentFinancialYears helpers exist and FyFilter uses them.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/new/page.tsx`, `apps/web/src/lib/fiscalYear.ts (add isValidFinancialYear)`
- **Fix steps:**
  1. Add isValidFinancialYear(fy) to lib/fiscalYear.ts: /^(\d{4})-(\d{2})$/ and (start+1)%100 === Number(yy).
  2. Replace defaultFy() with currentFinancialYear() from @/lib/fiscalYear.
  3. Replace the free-text input with a <select> populated from recentFinancialYears() (plus next FY, as a BE is prepared ahead), or keep text and validate on submit.
  4. Block submit with an inline error via the validator; keep formError.fieldError("fy") for server errors.
- **Acceptance:**
  - Unit test: isValidFinancialYear("2026-27") true; "2026-28", "2026-2", "26-27" false.
  - Test: with clock mocked to 2027-03-31T19:00Z (IST 1 Apr 2027) default FY is 2027-28.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Confirm whether BE for a future FY is allowed before restricting the option list.


---
## /finance/budget/fund-releases  —  `finance/budget-fund-releases.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/fund-releases/page.tsx`
- **Design reference:** `redesign/finance/budget-fund-releases.html`

### GAP-FINANCE-BUDGET-FUND-RELEASES-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Raw identifiers as content: ID column prints the release UUID and From/To Office print String(officeId).slice(-8) (FundReleasesTable.tsx:31-35,48-52) - officers cannot tell which office got the money.
- **Verified evidence:** FundReleasesTable.tsx:85 column key "id" prints the raw release UUID; lines 69-71 build _from/_to as String(fromOfficeId).slice(-8) shown in columns 87-88 (obs lines 31-35,48-52 were off). No office-name lookup exists in the snapshot (no office loader in app/_data/loaders.ts), so names need a backend join or an org-directory read.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/fund-releases/FundReleasesTable.tsx`, `apps/web/src/app/(app)/finance/budget/fund-releases/page.tsx`, `apps/web/src/app/_data/loaders.ts (office directory loader)`
- **Fix steps:**
  1. Ask backend to include fromOfficeName/toOfficeName in allocation-distributions rows, or add a loader for the org/office directory and build a Map<id,name> in page.tsx.
  2. Show office name in From/To columns (fallback: "Unknown office", never the id tail); keep the UUID in the row link only.
  3. Replace the ID column with a short human reference (release number if the API has one) or drop it; add a row href to a detail page if one exists.
  4. Keep the raw id available via a title/tooltip or copy button for support.
- **Acceptance:**
  - Component test: row with office ids and a name map renders names, no 8-char id fragments.
  - Row without a mapped name renders "Unknown office", not an id.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; money routing readability. Do not guess office names.

### GAP-FINANCE-BUDGET-FUND-RELEASES-02  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Failed fetch shows four zeros and "No allocation distributions found." (page.tsx:31-32; FundReleasesTable.tsx:66-67).
- **Verified evidence:** fund-releases/page.tsx:8-10,21-24 derive four counts from releases, all 0 when the loader returns [] on error; FundReleasesTable.tsx:101-103 shows the "No fund releases / No allocation distributions found." empty state. Overstated: FundReleasesTable.tsx:82 renders DataSourceBadge with derived provenance ("Couldn't load - showing nothing") since page.tsx:32 passes source; the zero cards and empty copy remain misleading.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/fund-releases/page.tsx`
- **Fix steps:**
  1. Use toResourceState(result) as in revised-estimates/page.tsx; pass null to StatCard values when errored (renders "—").
  2. Render <RefreshErrorState error={toHumanError("load",{area:"fund releases"})} backHref="/finance"/> instead of the table on error.
  3. Reuse the shared helper from FORMULATION-03.
- **Acceptance:**
  - Mock loader source "error": cards "—", RefreshErrorState visible, no empty-state copy.
  - Healthy empty list keeps 0 counts and the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-03

### GAP-FINANCE-BUDGET-FUND-RELEASES-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Amount uses local rupees() = Number(BigInt)/100 with "₹x.xx Cr/L" shorthand and toFixed(0) below ₹1 lakh (FundReleasesTable.tsx:8-13): paise dropped, float division on a paise bigint, and a different format from formatMoney used elsewhere in finance.
- **Verified evidence:** FundReleasesTable.tsx:44-49 (obs 8-13 off): rupees() does Number(BigInt(val))/100 then >=1e7 -> "₹x.xx Cr", >=1e5 -> "₹x.xx L", else toFixed(0), so paise are dropped below ₹1 lakh (₹1,234.56 shows ₹1235) and shorthand loses exactness above; BigInt(String(val)) also throws on a non-integer string (a decimal amountMinor would crash the client render). Shared formatMoney (lib/formatters.ts:90) is paise-exact and returns "—" for bad input. Money must render exact in a finance ledger.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/fund-releases/FundReleasesTable.tsx`, `apps/web/src/app/(app)/finance/budget/fund-releases/page.tsx`
- **Fix steps:**
  1. Delete local rupees().
  2. Add cellType:"amount" on a column keyed amountMinor (raw paise string) so DataTable calls formatMoney; drop _amount.
  3. If compact display is wanted, add formatMoneyCompact(minor) in lib/formatters.ts using BigInt division (1 Cr = 10_000_000_00n paise) and show the exact value in a title attribute.
  4. Also fix currency column: if currency is not INR, do not render as ₹ (show ISO code).
- **Acceptance:**
  - Test: amountMinor "123456" renders ₹1,234.56.
  - Test: amountMinor "12500000000" renders ₹12,50,00,000.00 (or compact Cr form with exact title).
  - Invalid value renders "—" without throwing.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Display-only, low. Same defect in monitoring (MONITORING-03).
- **Depends on:** GAP-FINANCE-BUDGET-FUND-RELEASES-04

### GAP-FINANCE-BUDGET-FUND-RELEASES-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** CSV export ships the display strings (_amount "₹1.25 Cr", _status, _from) because those columns have no cellType (DataTable.tsx:266-271 vs FundReleasesTable.tsx:31-33); the file is not machine-usable.
- **Verified evidence:** DataTable.tsx:267-271 csvCellValue only special-cases cellType amount/rupees/status, otherwise String(row[col.key]); FundReleasesTable.tsx columns 87-91 use display keys _from,_to,_amount,_status with no cellType, and exportable is on (line 99), so CSV holds "₹1.25 Cr", "Issued" and 8-char office fragments. Note even with cellType amount, csvCellValue emits formatMoney text ("₹12,50,000.00"), which is not machine-usable either.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/finance/budget/fund-releases/FundReleasesTable.tsx`, `apps/web/src/app/(app)/finance/budget/monitoring/MonitoringTable.tsx`
- **Fix steps:**
  1. Add optional Column.csv?: (row) => string to DataTable's Column type (line ~47) and use it first in csvCellValue.
  2. In DataTable make cellType "amount" export the plain decimal rupees (paise string -> "1250000.00") via a new helper minorToDecimalString in lib/money.ts; keep on-screen formatMoney.
  3. In FundReleasesTable switch to raw keys + cellType (amountMinor as amount, status as status) and add csv: for office (full id and name), effectiveFrom (ISO).
  4. Emit a BOM/UTF-8 header only if needed for ₹; prefer plain digits and a currency column.
  5. Log/audit CSV export of finance data if policy requires (check SECURITY.md) - decision.
- **Acceptance:**
  - Unit test on DataTable: exportable table with an amount column exports "1250000.00" not "₹12,50,000.00".
  - Fund releases CSV contains ISO date, full office ids/names, status code, amount numeric.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Changing amount CSV format affects every DataTable export consumer (~80 call sites); gate behind a prop (csvRaw) or announce.

### GAP-FINANCE-BUDGET-FUND-RELEASES-05  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** issuedBy is computed (_issued, line 35) but no column shows it; effective date is a sliced ISO string, and the CCY column is constant for a rupee-only tenant.
- **Verified evidence:** FundReleasesTable.tsx:71 computes _issued but no column references it (columns 84-93) - confirmed dead data. Effective date is String(effectiveFrom).slice(0,10) (line 72), i.e. ISO yyyy-mm-dd rather than formatIndianDate (lib/formatters.ts:2); the slice of a timestamptz could show the UTC date, off by one in IST. CCY column (line 90) is rendered raw; whether it is constant per tenant is cannot-verify, but showing a constant column is cosmetic.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/fund-releases/FundReleasesTable.tsx`
- **Fix steps:**
  1. Either add an "Issued by" column (name, not id tail) or remove _issued.
  2. Render Effective with formatIndianDate(effectiveFrom) via a render() column; keep ISO in csv.
  3. Hide the CCY column when all rows are INR, or merge it into the amount cell (formatMoney with currency).
- **Acceptance:**
  - Test: effectiveFrom "2026-03-31T20:00:00Z" renders 01 Apr 2026 (IST).
  - No unused computed fields remain (lint).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Trivial.
- **Depends on:** GAP-FINANCE-BUDGET-FUND-RELEASES-01


---
## /finance/budget/monitoring  —  `finance/budget-monitoring.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`
- **Design reference:** `redesign/finance/budget-monitoring.html`

### GAP-FINANCE-BUDGET-MONITORING-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Error handling is split-brained: badge/stats depend on the summary fetch and the table on the lines fetch, but only the summary's source is passed to the table (page.tsx:26-33,109-110); a failed lines fetch shows no badge at all while the table says "No budget allocation lines found for this FY."
- **Verified evidence:** monitoring/page.tsx:26-29 fetches summary and lines in parallel but only destructures source from the summary ({ data: summary, source }, { data: lines }) and passes it to MonitoringTable at line 110. Cases: lines fail + summary ok -> source "api", empty lines, no badge (DataSourceBadge returns null for live) and the table says "No budget allocation lines found for this FY." (MonitoringTable.tsx:210); summary fails + lines ok -> table shows rows under a "Couldn't load - showing nothing" badge while rows are displayed, and stat cards show ₹0 / 0. The page never shows a badge for its own summary cards.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`, `apps/web/src/app/(app)/finance/budget/monitoring/MonitoringTable.tsx`
- **Fix steps:**
  1. Capture both sources: const [summaryRes, linesRes] = await Promise.all([...]); summaryErr = summaryRes.source==="error", linesErr = linesRes.source==="error".
  2. Pass linesRes.source to MonitoringTable (so its badge/empty state is driven by the lines fetch).
  3. When summaryErr render "—" in all four StatCards and a RefreshErrorState/inline banner above them; when linesErr render RefreshErrorState instead of the table.
  4. Add a test for each of the 2x2 combinations.
- **Acceptance:**
  - Lines error + summary ok: table area shows error state with Retry, not "No budget allocation lines".
  - Summary error + lines ok: cards show "—", table has no contradictory badge.
  - Both ok and empty: legit empty copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-03

### GAP-FINANCE-BUDGET-MONITORING-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Head ID column prints the raw head uuid (MonitoringTable.tsx:75 "headId"): officers monitoring 200 heads cannot identify them.
- **Verified evidence:** MonitoringTable.tsx:189 (obs :75 off) first column { key: "headId", label: "Head ID" } prints the raw uuid; rows are BudgetMonitoringLine records from loaders.ts:2101-2113 (BudgetMonitoringLinesResponse schema is in @civitasone/types, absent), so whether the API already returns head code/name is cannot-verify. The accounts endpoint (/v1/finance/accounts) has code+name per id (chart-of-accounts/new/page.tsx:20).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`, `apps/web/src/app/(app)/finance/budget/monitoring/MonitoringTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Check if BudgetMonitoringLine already has headCode/headName; if so render "code · name".
  2. Otherwise ask backend to add headCode/headName to /budget-monitoring lines (preferred), or fetch getChartOfAccounts() in page.tsx and build Map<id,label> passed as prop (paginate risk: limit).
  3. Render label in the first column; keep headId out of the visible UI (use as the row key).
  4. Retain headId as an extra CSV column only.
- **Acceptance:**
  - Test: row {headId:"uuid"} with a map renders "2202 · General Education" and no uuid text.
  - Unknown head renders "Unknown head".
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; do not display a guessed name.

### GAP-FINANCE-BUDGET-MONITORING-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Local rupees() converts Number(BigInt)/100 and prints "₹x.xx L/Cr" or toFixed(0) (page.tsx:7-12; MonitoringTable.tsx:8-13): float division on paise, paise dropped below ₹1 lakh, CSV export writes the shorthand strings.
- **Verified evidence:** Local rupees() is duplicated in monitoring/page.tsx:7-12 and MonitoringTable.tsx:122-127 (obs page 7-12 correct; table 8-13 off): Number(BigInt(v))/100, Cr/L shorthand with toFixed(2) and toFixed(0) below ₹1 lakh; used for the Allocated/Expended cards (page.tsx:58,64) and the _allocated/_committed/_actual/_available columns (172-175). CSV (exportable, line 206) writes those display strings because the columns have no cellType (DataTable.tsx:267-271). BigInt(String(val)) throws for non-integer strings.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`, `apps/web/src/app/(app)/finance/budget/monitoring/MonitoringTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Remove both rupees() copies.
  2. Cards: value={errored ? null : formatMoney(totals.allocatedMinor)}.
  3. Table: columns keyed allocatedMinor/committedMinor/actualMinor/availableMinor with cellType:"amount"; drop the _-prefixed strings.
  4. If compact form is wanted, add one shared formatMoneyCompact (BigInt division) in lib/formatters.ts and reuse it in fund-releases.
  5. Fix CSV via the DataTable csv/raw export from FUND-RELEASES-04; add committed to the cards (see -04).
- **Acceptance:**
  - Test: allocatedMinor "123456" -> ₹1,234.56 in table and card.
  - CSV export shows 1234.56 style numeric values.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money display; test carefully - amounts formerly rounded now show full precision.
- **Depends on:** GAP-FINANCE-BUDGET-FUND-RELEASES-04

### GAP-FINANCE-BUDGET-MONITORING-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** "On Track" is total count minus exceptions (page.tsx:36-39) and is 0 whenever totals.count is absent, so a missing field reads as "nothing on track"; no Total Committed card although committed drives the over-commit status.
- **Verified evidence:** monitoring/page.tsx:36-38: onTrack = totals.count ? Number(count) - overCommitted - underUtilised - projOverspend : 0, so a missing/0 count (including the error default BUDGET_MONITORING_EMPTY in loaders.ts:2085) yields 0 "On Track". Also the exception buckets are subtracted assuming a head has one exception; overlapping exceptions could go negative. Cards (lines 54-78) are Allocated, Expended, On Track, Exceptions - no Committed even though committedMinor is in totals and drives over_committed. "Exceptions" only sums three named keys.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`
- **Fix steps:**
  1. Parse count with typeof check; if count is not a finite number (or summary errored) set onTrack to null so StatCard shows "—".
  2. Clamp with Math.max(0, ...) and note if exceptions can overlap (ask backend; prefer server-provided onTrack).
  3. Add a "Total Committed" StatCard using formatMoney(totals.committedMinor).
  4. Type totals properly instead of Record<string,unknown> casts.
- **Acceptance:**
  - Test: totals without count -> On Track "—", not 0.
  - Test: count 10 with exceptions 2/1/1 -> 6; committed card shows formatted committedMinor.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-BUDGET-MONITORING-01

### GAP-FINANCE-BUDGET-MONITORING-05  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** ?fy= is accepted as any non-empty string (page.tsx:22-25) unlike statements, which validates YYYY-YY; Utilisation bar colour uses actual expenditure only (>90% red) while status is derived server-side from commitment - they can contradict (e.g. red bar, "On Track").
- **Verified evidence:** monitoring/page.tsx:22-25 accepts any non-empty ?fy=, while financial-statements/page.tsx:10 validates /^\d{4}-\d{2}$/ with fallback to currentFinancialYear(); a bad fy goes straight to the backend (endpoints return 400 -> empty zeros). MonitoringTable.tsx:138-145 colours the bar from utilisationBps (red >90%, warn >60%) while the Status column (exceptionBadge, lines 129-136) comes from the server exception field; whether utilisationBps is actual/allocated or committed-based is cannot-verify (types absent), but the two signals are independent so contradictions are possible.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/monitoring/page.tsx`, `apps/web/src/lib/fiscalYear.ts`, `apps/web/src/app/(app)/finance/budget/monitoring/MonitoringTable.tsx`
- **Fix steps:**
  1. Use shared isValidFinancialYear (add to fiscalYear.ts) and fall back to currentFinancialYear() for invalid input.
  2. Confirm with backend what utilisationBps measures; label the column "Expended %" and add a tooltip.
  3. Derive bar colour from the same exception field as Status (over_committed/projected_overspend red/amber) or show two markers (committed and actual).
  4. Combine Status pill using StatusPill tones instead of a plain text status.
- **Acceptance:**
  - Test: ?fy=abc falls back to the current FY and the loader is called with a valid value.
  - Test: row with exception over_committed never shows a green bar / "On Track" pill combination.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /finance/budget/outcome-budget  —  `finance/budget-outcome-budget.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/outcome-budget/page.tsx`
- **Design reference:** `redesign/finance/budget-outcome-budget.html`

### GAP-FINANCE-BUDGET-OUTCOME-BUDGET-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Failed fetch shows zeros and "No outcome budget indicators found." (page.tsx:19-23; OutcomeBudgetTable.tsx:40-41).
- **Verified evidence:** outcome-budget/page.tsx:19-23 cards show outcomes.length, achieved, inProgress and outcomes.length - achieved - inProgress, all 0 when the loader falls back to [] (loaders.ts:2066-2073); OutcomeBudgetTable.tsx:73-75 shows "No outcomes / No outcome budget indicators found." Overstated: the table renders DataSourceBadge (line 50) with error-no-data provenance so an amber warning is shown. Zero cards and empty copy remain misleading.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/outcome-budget/page.tsx`
- **Fix steps:**
  1. Use toResourceState(result); pass null to StatCards when errored.
  2. Render RefreshErrorState (toHumanError("load",{area:"outcome budget"})) instead of the table on error, per revised-estimates/page.tsx.
  3. Use the shared helper from FORMULATION-03.
- **Acceptance:**
  - Error fixture: cards "—", RefreshErrorState visible, no "No outcome budget indicators found."
  - Empty ok fixture: zeros and empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-03

### GAP-FINANCE-BUDGET-OUTCOME-BUDGET-02  ·  MEDIUM  ·  partly  ·  theme UNITS (was DATEFMT)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Target/Achieved are bare numbers with no unit and % Done is achievement/target only (OutcomeBudgetTable.tsx:21-29): for "lower is better" indicators (days, cost) over-shoot is scored as Achieved (page.tsx:9).
- **Verified evidence:** OutcomeBudgetTable.tsx:55-56 render targetValue/achievedValue as raw values with no unit; column % Done (57-63) is achievementBps/100 (server value) and page.tsx:8-9 treats achievementPct>=100 as Achieved. The code does not itself compute achieved/target, it trusts the server achievementBps, so for lower-is-better indicators the outcome depends on how the backend computes bps - cannot-verify (BudgetOutcomeSummary and service absent; no direction/unit field visible). Bare numbers with no unit is confirmed. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/outcome-budget/OutcomeBudgetTable.tsx`, `apps/web/src/app/(app)/finance/budget/outcome-budget/page.tsx`
- **Fix steps:**
  1. Confirm with backend whether BudgetOutcomeSummary has unit and polarity (higher/lower is better) fields and how achievementBps is computed for lower-is-better.
  2. Render Target/Achieved with the unit (render: v + " " + unit) using tabular numerals.
  3. If polarity is exposed, compute status/achieved consistently on server; otherwise request it.
  4. Show a note/tooltip on % Done stating the formula.
- **Acceptance:**
  - Test: row with unit "days" renders "30 days".
  - Backend contract test: lower-is-better indicator that overshoots is not marked Achieved.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Outcome scoring is reported to oversight; wrong polarity misreports performance.

### GAP-FINANCE-BUDGET-OUTCOME-BUDGET-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** "Not Started" is the remainder (total - achieved - inProgress, page.tsx:25), so rows with a null/absent achievementBps (Number(null ?? 0) = 0) and negative values are all lumped as not started; a missing measurement is not distinguished from zero progress.
- **Verified evidence:** outcome-budget/page.tsx:8 achievementPct = Number(o.achievementBps ?? 0)/100 makes null/undefined 0 (and NaN for garbage strings), line 9 achieved >=100, line 10 inProgress 0<p<100 (NaN and negatives fall out), line 23 Not Started = total - achieved - inProgress, so absent, zero and negative/NaN are all 'Not Started' (obs line 25 was 23). The table renders (Number(null ?? 0)/100).toFixed(1) => "0.0%" for a missing value (OutcomeBudgetTable.tsx:62).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/outcome-budget/page.tsx`, `apps/web/src/app/(app)/finance/budget/outcome-budget/OutcomeBudgetTable.tsx`
- **Fix steps:**
  1. Classify each outcome: no measurement when achievementBps is null/undefined/NaN; notStarted when finite and <=0.
  2. Add a fifth card or fold it into the label: "Not measured" vs "Not started".
  3. In the table render "—" when achievementBps is null instead of 0.0%.
  4. Compute the counts explicitly, not by subtraction.
- **Acceptance:**
  - Test: [null, 0, 5000, 10000, -10] -> not measured 1, not started 2 (0 and -10 or flagged), in progress 1, achieved 1.
  - Table shows "—" for null achievementBps.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-BUDGET-OUTCOME-BUDGET-04  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Status column (StatusPill) and % Done can disagree: status is a separate field from achievementBps and no rule reconciles them; % Done is right-aligned text with no progress bar.
- **Verified evidence:** OutcomeBudgetTable.tsx:64 renders status via cellType "status" (StatusPill) from the server status field while % Done (57-63) is a separate text render of achievementBps with no bar and no reconciliation; ProgressBar exists at ds/ProgressBar.tsx. Whether status values disagree with achievementBps and which enum values exist is cannot-verify (type and service absent). StatusPill STATUS_MAP has no outcome-specific values (on_track, off_track, etc.), so unknown values render the neutral pill.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/outcome-budget/OutcomeBudgetTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Get the status enum from BudgetOutcomeSummary/backend and add its values to STATUS_MAP.
  2. Replace the % Done render with <ProgressBar value={pct}/> plus the numeric label; clamp visually but show the true number.
  3. Derive the displayed status from achievementBps when the server status is missing, and flag rows where they conflict.
- **Acceptance:**
  - Test: each enum value renders the intended pill tone.
  - Row with achievementBps 10000+ shows a full bar and the exact percentage.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-BUDGET-REVISED-ESTIMATES-03


---
## /finance/budget/revised-estimates  —  `finance/budget-revised-estimates.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/revised-estimates/page.tsx`
- **Design reference:** `redesign/finance/budget-revised-estimates.html`

### GAP-FINANCE-BUDGET-REVISED-ESTIMATES-01  ·  MEDIUM  ·  confirmed  ·  theme FY-SCOPE (was I18N)

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Each row is one budget (head + fiscal year) but the table has no FY column and the loader takes no fy (page.tsx:34-35 getFinanceBudgets()), so the same head in 2025-26 and 2026-27 appears twice with different numbers; the empty copy says "for this FY" although no FY control exists.
- **Verified evidence:** revised-estimates/page.tsx:113 calls getFinanceBudgets() with no fy (loaders.ts:1864 takes no argument), toRow() (lines 91-110) has no financialYear field and RevisedEstimatesTable.tsx:182-195 has no FY column, so the same head in two FYs appears twice; emptyMessage at line 205 says "for this FY" although there is no FY control. Contrast FormulationTable.tsx:127 which has an FY column. I18N theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/revised-estimates/page.tsx`, `apps/web/src/app/(app)/finance/budget/revised-estimates/RevisedEstimatesTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add <FyFilter/> in PageHeader actions and read searchParams.fy validated via the shared FY validator, default currentFinancialYear() (as monitoring/page.tsx does).
  2. Filter budgets by b.financialYear === fy (or add ?fy= support to getFinanceBudgets after checking the backend).
  3. Add financialYear to RevisedEstimateRow and an FY column.
  4. Update empty copy to "No revised estimates for FY {fy}".
- **Acceptance:**
  - Test: fixtures for 2025-26 and 2026-27 with the same head; selecting FY shows one row each time.
  - Empty message names the selected FY.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; numbers previously mixed across FYs will change.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-02

### GAP-FINANCE-BUDGET-REVISED-ESTIMATES-02  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** BE/RE are converted to a float rupee number (minorToRupeesOrNull -> Number/100) and printed with toLocaleString (formatters.ts:67-72), so large paise values lose the exact-paise guarantee that formatMoney provides; variance is computed on floats (page.tsx:21).
- **Verified evidence:** revised-estimates/page.tsx:97-100 minorToRupeesOrNull(b.beMinor) -> Number(minor)/100 (lib/formatters.ts:150-155), variancePct computed on floats (obs line 21 off; it is line 100), and RevisedEstimatesTable.tsx:190-191 renders with formatRupees (Number.toLocaleString). Real deviation from the paise-bigint rule, but exactness is only lost above 2^53 paise (about ₹9e13), which is unrealistic for a budget line; the ‘large paise values’ risk is theoretical, the convention breach is real. The two-decimal output equals formatMoney for normal values.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/revised-estimates/page.tsx`, `apps/web/src/app/(app)/finance/budget/revised-estimates/RevisedEstimatesTable.tsx`
- **Fix steps:**
  1. Keep beMinor/reMinor as strings in RevisedEstimateRow (budgetEstimateMinor, revisedEstimateMinor: string | null).
  2. Compute variance with BigInt: bps = be > 0n ? ((re - be) * 10000n) / be : 0n (guard invalid input), status from BigInt comparison; format with formatBps or a fixed-1dp helper.
  3. Render columns with cellType "amount" (formatMoney) instead of formatRupees; keep sort keys numeric via a separate sortValue if DataTable supports it, else sort on the string length+lexical helper.
  4. Remove minorToRupeesOrNull usage here.
- **Acceptance:**
  - Test: be "900719925474099300" re "900719925474099400" yields exact display and status increased.
  - Test: null be renders "—" and status unknown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; watch sorting and CSV of the amount columns.

### GAP-FINANCE-BUDGET-REVISED-ESTIMATES-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Status uses StatusPill, which has no mapping for increased/decreased/no_change/unknown (StatusPill.tsx STATUS_MAP), so every row renders the neutral info pill; direction is not colour-coded.
- **Verified evidence:** StatusPill.tsx STATUS_MAP (lines 5-39) has no increased/decreased/no_change/unknown, so StatusPill falls back to variant "info" (line 53); RevisedEstimatesTable.tsx:194 uses cellType "status" with those values (RevisedEstimateRow.status, lines 165), so every row is the same neutral pill labelled by humanizeStatus. Direction has no other cue (icon).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/finance/budget/revised-estimates/RevisedEstimatesTable.tsx`
- **Fix steps:**
  1. Do not add generic increased/decreased to the global STATUS_MAP (semantics vary); instead use a per-table render: (r) => <StatusPill status={...} label={...}/> can't set variant, so add an optional variant prop to StatusPill (PillVariant) or a local pill span with class pill warn/info/mut.
  2. Map increased -> warn, decreased -> info (or good per finance decision), no_change -> mut, unknown -> mut.
  3. Add an arrow/text cue (▲ ▼ =) so colour is not the only signal.
  4. Reuse for formulation/outcome status maps.
- **Acceptance:**
  - Test: each of the four statuses renders a distinct pill class and label.
  - Snapshot: unknown renders muted, not info.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; decide tone (increase is not inherently good or bad).

### GAP-FINANCE-BUDGET-REVISED-ESTIMATES-04  ·  LOW  ·  partly  ·  theme BUSINESS-RULE (was I18N)

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** "Increased" is counted like good news while a raised RE on a capital head can mean overspend; no threshold or tolerance (e.g. >10%) highlights material variance.
- **Verified evidence:** page.tsx:118-119,134 count Increased/Decreased with a green icon background (#ecfdf3) for Increased, and toRow (line 108) uses strict re > be with no tolerance; there is no material-variance threshold or highlight anywhere in RevisedEstimatesTable.tsx. The page does not explicitly call an increase 'good news' and capital-vs-revenue head type is not available in the row (cannot verify), so this is a product/UX suggestion rather than a defect. Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/revised-estimates/page.tsx`, `apps/web/src/app/(app)/finance/budget/revised-estimates/RevisedEstimatesTable.tsx`
- **Fix steps:**
  1. Decide the materiality threshold (e.g. abs variance >= 10%) with finance; keep as a named constant or tenant config.
  2. Use neutral iconBg for Increased; add a "Material variance (>10%)" card and highlight those rows (bold variance and a non-colour marker).
  3. Sort default by abs(variance) descending.
- **Acceptance:**
  - Test: variance 12% row flagged as material, 5% not.
  - Increased card has no positive-green styling.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; needs finance to define the threshold.
- **Depends on:** GAP-FINANCE-BUDGET-REVISED-ESTIMATES-02

### GAP-FINANCE-BUDGET-REVISED-ESTIMATES-05  ·  LOW  ·  confirmed  ·  theme DATA-MAPPING (was OTHER)

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Same BudgetSummary list feeds Formulation and Revised Estimates with different column meanings (see formulation).
- **Verified evidence:** Both pages call getFinanceBudgets() (formulation/page.tsx:7, revised-estimates/page.tsx:113). Formulation shows sanctionedAmount as 'Proposed (BE)' and releasedAmount as 'Last Year (BE)' (FormulationTable.tsx:99-100,123-124) while Revised Estimates uses beMinor/reMinor (page.tsx:97-98), so BE means different fields on the two screens. Which field is authoritative is cannot-verify (BudgetSummary in @civitasone/types absent).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/formulation/FormulationTable.tsx`, `apps/web/src/app/(app)/finance/budget/revised-estimates/page.tsx`, `apps/web/src/app/_data/loaders.ts (shared BE/RE selector)`
- **Fix steps:**
  1. Agree a field glossary (beMinor = budget estimate, reMinor = revised, sanctionedAmount = sanctioned, releasedAmount = released) with finance-service.
  2. Create one shared mapper (e.g. lib/finance/budgetColumns.ts) that both pages use for BE/RE/sanctioned/released.
  3. Fix FormulationTable per FORMULATION-01.
  4. Add a test that both pages show the same BE for one fixture row.
- **Acceptance:**
  - Test: a single budget fixture shows identical BE on formulation and revised-estimates.
  - Column labels come from one shared constant.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Same numbers feed finance decisions; needs sign-off on the glossary.
- **Depends on:** GAP-FINANCE-BUDGET-FORMULATION-01


---
## /finance/budget/sanctions  —  `finance/budget-sanctions.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/sanctions/page.tsx`
- **Design reference:** `redesign/finance/budget-sanctions.html`

### GAP-FINANCE-BUDGET-SANCTIONS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** "+ New Sanction" POSTs only { reason, status: "pending" } (FinanceActions.tsx:173): a sanction record with no subject, head, amount or line items is created from a one-line reason, then shows up in the list with blank fields.
- **Verified evidence:** SanctionCreateAction (FinanceActions.tsx:160-178) confirms with a single reason text and posts {reason, status:'pending'} to /sanctions (line 173). No subject, head, amount, line items or date are collected, though SanctionDetail rows (detail page.tsx:48-60) display them. The confirm copy says 'draft' but status is sent as 'pending', and the toast says 'submitted for approval'. Backend contract unverifiable (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`, `apps/web/src/app/(app)/finance/budget/sanctions/new/page.tsx (new)`, `apps/web/src/app/(app)/finance/budget/sanctions/page.tsx`
- **Fix steps:**
  1. Create /finance/budget/sanctions/new form: subject, major head (select from chart of accounts), amount (rupee input converted to paise string), remarks, line items (description/head/amount).
  2. Change '+ New Sanction' to a Link to that route; remove SanctionCreateAction.
  3. POST full payload via existing postJson; amount as paise string per SanctionDetailSchema convention; keep reason as maker note.
  4. Send status 'draft' (or omit) rather than 'pending' once backend supports it; align toast/copy.
  5. Redirect to the new sanction's detail page on 202/201.
- **Acceptance:**
  - Submit with empty amount is blocked with a field error.
  - Created sanction appears with subject/head/amount populated.
  - Amount 1,250.50 sends '125050'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money field entry: paise conversion must be exact (no float); creates budget-commit records.
- **Depends on:** GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-04

### GAP-FINANCE-BUDGET-SANCTIONS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Failed fetch shows zeros (Active 0, Sanctioned ₹0.00, Pending 0, Approved 0) plus a table with no error explanation beyond the small badge (page.tsx:39-40; SanctionsTable.tsx).
- **Verified evidence:** page.tsx:29-32 computes all four StatCards from server data, which is [] on error (loaders.ts:1874-1879), giving 0 / formatMoney(0n) / 0 / 0. The only error signal is the badge inside SanctionsTable (SanctionsTable.tsx:41) and useSeededResource may even show cached rows below zeroed stats (resource.ts:241-249), so the cards and table can disagree. source is available at page.tsx:8 but unused for the cards.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/sanctions/page.tsx`, `apps/web/src/app/(app)/finance/budget/sanctions/SanctionsTable.tsx`
- **Fix steps:**
  1. When source==='error' use <LoadErrorState result area='sanctions'/> from the page (or show '—' in the StatCards) instead of 0 and ₹0.00.
  2. Compute stats from the rows the table uses (move stat computation into a client wrapper on useSeededResource) or hide stats when provenance is 'cached'/'error-no-data'.
  3. Keep the badge only for the cached case.
- **Acceptance:**
  - Mock fetch failure with empty cache: stats show '—' plus retry state.
  - Cached rows: stats derive from cached rows, not zero.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; misleading zero on a finance dashboard is the risk today.
- **Depends on:** LoadErrorState

### GAP-FINANCE-BUDGET-SANCTIONS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** "Sanctioned (FY)" sums every sanction regardless of status (page.tsx:14: reduce over all rows) so pending or rejected amounts inflate the "sanctioned" figure; "Active Sanctions" counts all rows; no fiscal-year filter despite "(FY)".
- **Verified evidence:** page.tsx:14 sums BigInt(s.amount) across every row regardless of status, labelled 'Sanctioned (FY)' (line 30). 'Active Sanctions' = sanctions.length (29). No fiscal-year filter; the loader takes no params (loaders.ts:1874). Whether SanctionSummary carries a fiscal-year field or status values other than pending/approved (e.g. rejected) cannot be verified (@civitasone/types absent).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/sanctions/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Sum only status==='approved' for 'Sanctioned' and relabel; optionally add 'Pending value'.
  2. Define 'Active' explicitly (approved and not closed/rejected) and count accordingly.
  3. If SanctionSummary has a date/fiscal-year field, filter to the active FY (fiscal-years endpoint) or add ?fy= support; otherwise relabel without '(FY)'.
  4. Extract a pure helper summariseSanctions(rows) with unit tests.
- **Acceptance:**
  - Unit test: rows approved 100, pending 50, rejected 25 give Sanctioned 100.
  - Card label matches the filter applied.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Headline budget number overstated; audit/finance reviewers may quote it.

### GAP-FINANCE-BUDGET-SANCTIONS-05  ·  LOW  ·  partly  ·  theme COPY (was NAVUX)

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Segmented tab "Sanctioned" filters status "approved" while the header card says "Approved" and the column header says "Sanctioned By": three words for one state (SanctionsTable.tsx:12-16).
- **Verified evidence:** SanctionsTable.tsx:12-17 tab 'Sanctioned' maps to status 'approved'; stat card label is 'Approved' (page.tsx:32); column 'Sanctioned By' (SanctionsTable.tsx:52) is the officer, not a state. So two labels for one state (Sanctioned/Approved) plus the pill's raw status; the third term is a person column, not a synonym.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/sanctions/SanctionsTable.tsx`, `apps/web/src/app/(app)/finance/budget/sanctions/page.tsx`
- **Fix steps:**
  1. Pick one term (recommend 'Approved') and rename the tab and card consistently.
  2. Keep 'Sanctioned By' but consider 'Approved By'.
  3. Derive tab labels and card labels from one shared status-label map.
- **Acceptance:**
  - Tab, card and StatusPill show the same word for approved.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /finance/budget/sanctions/[id]  —  `finance/budget-sanctions-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/budget/sanctions/[id]/page.tsx`
- **Design reference:** `redesign/finance/budget-sanctions-detail.html`

### GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01  ·  HIGH  ·  partly  ·  theme APPROVAL (was OTHER)

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Two competing approval paths with no guidance: a direct "Approve sanction" PATCH (FinanceActions.tsx:97-115) and "Raise for approval" to eOffice (RaiseEOfficeNote, page.tsx:71) with a notifyPath that flips the sanction to pending approval; a pending sanction can be approved directly while an eFile for it is in flight.
- **Verified evidence:** Both controls render for a pending sanction: SanctionApproveAction at [id]/page.tsx:41 (isPending = status==='pending', line 24; PATCH /sanctions/{id}/approve, FinanceActions.tsx:97-116, reason-required confirm) and RaiseEOfficeNote at page.tsx:71-79 (POST /estab/files/from-module, then best-effort POST notifyPath submit-approval, RaiseEOfficeNote.tsx:114-129, failure swallowed at 126). The page never knows whether an eFile exists because that status is fetched client-side inside RaiseEOfficeNote (lines 75-91), so Approve stays visible while an eFile is in flight. Whether submit-approval moves the status off 'pending' is backend behaviour in finance-service, absent from snapshot (cannot-verify); no on-screen guidance explains which path to use.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/sanctions/[id]/page.tsx`, `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`, `apps/web/src/app/_components/RaiseEOfficeNote.tsx`
- **Fix steps:**
  1. Decide policy: is direct Approve allowed when a linked eFile exists (recommended: no; the eOffice decision callback is the approver).
  2. Lift linked-file lookup (GET /api/proxy/v1/estab/files/by-ref?refType=finance_sanction&refId) into the server page or a small client wrapper <SanctionApprovalPanel> that passes hasLinkedFile down.
  3. Hide or disable SanctionApproveAction when a linked eFile exists; show 'Awaiting eOffice decision: <file_no>' with Open file link instead.
  4. Add one-line helper copy above the two controls: 'Approve directly (authority holder) or route through eOffice file noting.'
  5. In RaiseEOfficeNote surface a notifyPath failure (currently empty catch, line 126) as a warning so the sanction status is not silently out of step.
  6. Backend: reject /approve with 409 while an open eFile is linked.
- **Acceptance:**
  - Component test: pending sanction with linked eFile renders no 'Approve sanction' button and shows the eFile number.
  - Pending sanction without eFile shows both options plus helper copy.
  - Mock notifyPath 500: warning banner shown after eFile raise.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval/maker-checker semantics on committed budget; RaiseEOfficeNote is shared by 8 detail pages (grants, hr/disciplinary, assets, payments, legal, procurement, contracts), so changes must be prop-gated.
- **Depends on:** GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-03

### GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Failed fetch shows "Sanction not found … the ID is invalid" (page.tsx:12-23): the loader returns null on error, and the DataSourceBadge (page.tsx:42) is only reachable when a sanction exists.
- **Verified evidence:** getFinanceSanctionById (loaders.ts:1882-1889) returns {data:null, source:'error', status} for any non-2xx, schema failure or network error (apiClient.ts:141-171). page.tsx:12-22 tests only !sanction and renders EmptyState 'Sanction not found ... ID is invalid', so a 500/403/timeout is presented as a bad ID. The DataSourceBadge at line 42 is unreachable (source==='error' implies data===null), i.e. dead code.
- **Files to change:** `apps/web/src/app/(app)/finance/budget/sanctions/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status/errorMessage from getFinanceSanctionById.
  2. If source==='error' and status!==404: render <LoadErrorState result={...} area='sanction' backHref='/finance/budget/sanctions'/> (handles 403 vs retry via RefreshErrorState).
  3. Only when status===404 (or source 'api' with null) keep the 'Sanction not found' EmptyState.
  4. Remove the unreachable DataSourceBadge at line 42 and its import.
- **Acceptance:**
  - Mock fetch 500: retry/error state shown, no 'not found' text.
  - Mock 404: 'Sanction not found' shown.
  - Mock 403: PermissionDenied copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.
- **Depends on:** LoadErrorState

### GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** RaiseEOfficeNote asks the officer to type two raw UUIDs ("employee UUID", "approver UUID", RaiseEOfficeNote.tsx:172-179) and validates with UUID_RE; a finance clerk cannot know either id. Failure prints the raw response body (RaiseEOfficeNote.tsx:119) and classification defaults to "confidential" (line 60).
- **Verified evidence:** RaiseEOfficeNote.tsx:173-180 has free-text inputs 'Initiating officer ID' (placeholder 'employee UUID') and 'Forward to officer ID' ('approver UUID'), validated by UUID_RE (line 25; 102-103). Failure sets error to raw res.text() (line 119, shown at 163) and classification defaults to 'confidential' (line 60) without the caller (sanction page.tsx:71-79) overriding it or the user seeing it. No EntityPicker exists in apps/web (grep empty).
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/EntityPicker (typeahead, value=id, label=name+designation) backed by an existing employee search endpoint (hrms-service employees list; confirm the query param before wiring).
  2. Default initiatedBy to the signed-in employee id from session (read-only chip) and use EntityPicker for 'Forward to'.
  3. Replace UUID_RE errors with 'Choose an officer'; keep ids only in the payload.
  4. Map failed responses through useFormError/toHumanError instead of throwing res.text() (line 119).
  5. Add a classification select (default from prop) so the user sees the value being applied; sanction page passes an explicit classification.
- **Acceptance:**
  - Component test: officers chosen by name, payload contains their UUIDs, no UUID text visible.
  - Server 400 with body shows plain-language message, not JSON.
  - Classification select visible and sent in payload.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared by 8 pages; wrong routing target would send confidential files to the wrong officer. Needs an employee lookup endpoint accessible to finance roles (cannot verify from snapshot).

### GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-06  ·  LOW  ·  partly  ·  theme DATEFMT (was LOADING)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Approval trail timestamps are printed as delivered (page.tsx:92-98), Remarks appear only if set, and the page has no loading.tsx/error.tsx so the generic finance skeleton shows four stat cards this page does have but no breadcrumb.
- **Verified evidence:** True: approval-trail timestamps print raw (page.tsx:97 {step.timestamp}, no formatIndianDate/DateTime). False: the segment does have loading.tsx and error.tsx one level up (budget/sanctions/loading.tsx, error.tsx using RouteError with back link) and Next applies them to [id]; the skeleton has a header block and exactly four stat-card placeholders, matching this page's StatGrid. Remarks conditional render is intended. Only the missing formatting is real (and the trail step type is asserted inline, line 92).
- **Files to change:** `apps/web/src/app/(app)/finance/budget/sanctions/[id]/page.tsx`
- **Fix steps:**
  1. Add a formatIndianDateTime helper (IST, dd Mon yyyy, HH:mm) to lib/formatters.ts if absent and use it on step.timestamp.
  2. Guard invalid timestamps with '—'.
- **Acceptance:**
  - Unit test: ISO string renders '05 Mar 2026, 14:30'; null/invalid renders '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /finance/chart-of-accounts  —  `finance/chart-of-accounts.html`

- **Source:** `apps/web/src/app/(app)/finance/chart-of-accounts/page.tsx`
- **Design reference:** `redesign/finance/chart-of-accounts.html`

### GAP-FINANCE-CHART-OF-ACCOUNTS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** On a failed fetch the badge sits above four zero stats and the "No accounts set up yet … Add your first head to get started" empty state with an "+ Add Head" button (AccountsTable.tsx:124-130): the officer is told the chart is empty and pushed to create heads on top of a live one.
- **Verified evidence:** page.tsx:6-33 never branches on source; on error accounts=[] so stats show 0 and AccountsTable renders EmptyState 'No accounts set up yet ... Add your first head' with '+ Add Head' (AccountsTable.tsx:123-129). Provenance badge (66) is the only hint and renders from useSeededResource; cache fallback may show rows beneath zero stats.
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/page.tsx`, `apps/web/src/app/(app)/finance/chart-of-accounts/AccountsTable.tsx`
- **Fix steps:**
  1. In page.tsx, if source==='error' render <LoadErrorState result area='chart of accounts'/> in place of stats and table (keep header).
  2. In AccountsTable, show the first-run EmptyState only when provenance==='live' and rows.length===0; for 'error-no-data' show a retry state.
  3. Show '—' for stats when data is unavailable.
- **Acceptance:**
  - Mock failure with empty cache: retry state, no 'Add your first head' CTA.
  - Genuinely empty live chart still shows CTA.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Reduces risk of duplicate heads being created against a live chart.
- **Depends on:** LoadErrorState

### GAP-FINANCE-CHART-OF-ACCOUNTS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** "Income / Expense" = total minus asset+liability (page.tsx:8,32), so equity heads are counted as income/expense; TypeFilter includes "equity" but the Segmented control has no Equity option (AccountsTable.tsx:14,43), leaving equity heads reachable only under All.
- **Verified evidence:** page.tsx:8 counts asset+liability only and line 32 shows accounts.length - majorHeads as 'Income / Expense', so equity (and any other type) is included. TypeFilter allows 'equity' (AccountsTable.tsx:14) but SEG_OPTIONS (43) omits 'Equity'. Also label 'Asset / Liability' is described as major heads.
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/page.tsx`, `apps/web/src/app/(app)/finance/chart-of-accounts/AccountsTable.tsx`
- **Fix steps:**
  1. Compute counts per type (income+expense) explicitly; add an Equity stat or fold into the label.
  2. Add 'Equity' to SEG_OPTIONS.
  3. Move counting to a pure helper with tests.
- **Acceptance:**
  - Unit test: 2 asset, 1 equity, 3 income gives Income/Expense 3.
  - Equity segment shows equity heads.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-CHART-OF-ACCOUNTS-04  ·  MEDIUM  ·  confirmed  ·  theme LISTUX (was PII)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** DataTable has no pageSize, sort or CSV here (AccountsTable.tsx:137), so a full LMMHA (hundreds of heads) renders as one long table, while sibling registers page at 15-20 and export.
- **Verified evidence:** DataTable at AccountsTable.tsx:137-147 sets no pageSize, sortable or exportable (all opt-in per ds/DataTable.tsx:69-84), so all rows render in one table; the custom search input (79-96) exists. Sibling registers (sanctions) pass pageSize 15, sortable, filterable. The PII theme tag is wrong; balances are financial, not PII.
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/AccountsTable.tsx`
- **Fix steps:**
  1. Add pageSize={20} sortable exportable exportFilename='chart-of-accounts' to DataTable.
  2. Add caption and identifyingColumnKey='name'.
  3. Consider dropping custom search in favour of filterable if behaviour matches.
- **Acceptance:**
  - 500 rows render 20 per page with pager.
  - Export downloads CSV of filtered rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** CSV export of ledger heads is finance-internal; confirm role expectations.


---
## /finance/chart-of-accounts/new  —  `finance/chart-of-accounts-new.html`

- **Source:** `apps/web/src/app/(app)/finance/chart-of-accounts/new/page.tsx`
- **Design reference:** `redesign/finance/chart-of-accounts-new.html`

### GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Mapping or changing a PFMS HoA code (PATCH .../hoa) is a one-click overwrite with no ConfirmDialog, no reason, and no display of the head's current code (AccountRow.hoaCode is loaded but never shown in the select). HoA codes drive PFMS payment and budget mapping; a wrong code silently misroutes. Contrast Journal Entry, which requires a maker-checker reason.
- **Verified evidence:** submitMap (new/page.tsx:124-151) PATCHes /accounts/{id}/hoa directly on form submit with {hoaCode}; no ConfirmDialog (ds/ConfirmDialog supports requireReason) and no reason. The select (233-238) lists only 'code · name' though AccountRow.hoaCode is typed (line 21) and loaded, so the current code is never shown. Backend accepts 202 (line 136). Maker-checker enforcement and audit emission are finance-service concerns, not visible here.
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/new/page.tsx`, `services/finance-service (verify audit event and reason field)`
- **Fix steps:**
  1. Show the selected head's current hoaCode (or 'Not mapped') under the select from accounts.find(id).
  2. On submit open ConfirmDialog (danger, requireReason, reasonLabel 'Reason for changing PFMS HoA code') summarising old to new code.
  3. Send reason in the PATCH body once backend schema accepts it; surface 202 as 'submitted for approval'.
  4. Backend: require reason, block maker approving own change, emit audit event with old/new value.
- **Acceptance:**
  - Selecting a head shows its current code.
  - Submit opens dialog; Confirm disabled until reason entered.
  - PATCH body contains reason; 4xx shows field error.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: HoA codes drive PFMS payment and budget mapping; misrouting is silent.

### GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Level (Major / Minor / Sub-minor) is chosen but no parent head can be selected (page.tsx:101-110), so a minor or sub-minor head is created unattached to any major head; the resulting tree cannot be inferred from the form.
- **Verified evidence:** Create form (new/page.tsx:165-223) has code, name, level select (LEVEL_OPTIONS 25-29), classification, hoaCode; submit body (87-93) has no parent. The header comment (6-9) says the endpoint accepts code, name, level, hoaCode, classification only, so the tree cannot be expressed. Backend schema unverifiable.
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/new/page.tsx`, `services/finance-service (accounts create schema, if parentId not supported)`
- **Fix steps:**
  1. Confirm whether POST /v1/finance/accounts supports a parent reference; if not add parentId (opaque id, no FK per CLAUDE.md rule 13).
  2. Add a 'Parent head' select shown when level>0, filtered to accounts one level up (needs level on AccountRow).
  3. Send parentId in submitCreate and validate required for level 1 and 2.
  4. Display the resulting path (Major > Minor) in the success message.
- **Acceptance:**
  - Level Minor with no parent cannot be submitted.
  - Created head shows under chosen parent on the list.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong hierarchy corrupts reporting roll-ups.
- **Depends on:** GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-04

### GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was OTHER)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Map-card feedback banner is always role="status" (page.tsx) even when isError is true, so a failed save is announced politely rather than as an alert, unlike the create card.
- **Verified evidence:** Map-card banner at new/page.tsx:227 is always role='status' aria-live='polite' even when isError; the create card (167) switches to role='alert'/assertive.
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/new/page.tsx`
- **Fix steps:**
  1. Copy the create card pattern: role={isError?'alert':'status'} and aria-live accordingly on line 227.
  2. Extract a small <FormBanner isError> used by both cards.
- **Acceptance:**
  - Failed PATCH renders element with role=alert; success renders role=status.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Accounts are fetched client-side with limit=200 and no pagination or search (page.tsx): a chart with more heads truncates silently and the select cannot find them.
- **Verified evidence:** loadAccounts fetches /accounts?limit=200 (new/page.tsx:41) and renders all in a native select (235-237); no search, no total, no truncation notice. Backend pagination/search params cannot be verified (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new, shared with sanction eOffice fix)`
- **Fix steps:**
  1. Replace the select with an async searchable picker calling /accounts?q=&limit=20.
  2. Confirm the accounts list endpoint supports a search param; add if missing.
  3. Show the current head (code, name, hoaCode) after selection.
  4. Until then show 'Showing first 200 of N' if the response has a total.
- **Acceptance:**
  - Chart with 500 heads: typing a code finds head 450.
  - Picker debounces and shows loading state.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; a head beyond 200 cannot be mapped today.
- **Depends on:** GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-03

### GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-05  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Load failure banner does not disable or explain the map form; the select is simply empty, with no retry button.
- **Verified evidence:** Not silent: a load failure sets loadError and renders a role='alert' banner with plain-language text (new/page.tsx:161-163). True: no retry button, and the map form stays enabled with an empty select (233-238) so the user can only stare at an empty list; create card is unaffected (independent).
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/new/page.tsx`
- **Fix steps:**
  1. Render <RefreshErrorState>-style retry (button calling loadAccounts()) inside the banner.
  2. Disable the Head select and Save button while loadError is set, with helper text.
  3. Clear loadError on successful reload.
- **Acceptance:**
  - Mock 500: banner has Retry; select disabled; Retry success enables it.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-06  ·  LOW  ·  partly  ·  theme COPY (was OTHER)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Title "Add / Map Head of Account (LMMHA)" exposes the acronym without expansion (List of Major and Minor Heads of Account); the page also concedes "Import LMMHA" lands here with no import (file header comment).
- **Verified evidence:** Title 'Add / Map Head of Account (LMMHA)' (new/page.tsx:156) shows the bare acronym; the list page uses <Term name='LMMHA'> (chart-of-accounts/page.tsx:14) to expand it. The claim that 'Import LMMHA' lands here is stale: that button was removed from the list page (page.tsx:19-24); only the file header comment (10-14) still mentions it.
- **Files to change:** `apps/web/src/app/(app)/finance/chart-of-accounts/new/page.tsx`
- **Fix steps:**
  1. Use <Term name='LMMHA'> in the title/subtitle, or write 'Head of Account' in full.
  2. Update the stale header comment.
- **Acceptance:**
  - Title exposes the expansion via Term tooltip.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/config  —  `finance/config.html`

- **Source:** `apps/web/src/app/(app)/finance/config/page.tsx`
- **Design reference:** `redesign/finance/config.html`

### GAP-FINANCE-CONFIG-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** The page tells an accountant to run API calls: "Use the API: POST /v1/finance/opening-balances" and "for now, use POST /v1/finance/fiscal-years and POST /v1/finance/bank-accounts" (page.tsx:99-102,108-110). The screen named "Finance Configuration" has no way to configure anything; the working create form for fiscal years is on /finance/fiscal-years and is not linked from here.
- **Verified evidence:** config/page.tsx:87-90 says 'Use the API: POST /v1/finance/opening-balances' and 96-99 'for now, use POST /v1/finance/fiscal-years and POST /v1/finance/bank-accounts'. Working UIs exist: /finance/fiscal-years (FiscalYearForm, page.tsx:64) and /finance/opening-balances (OpeningBalanceForm). No bank-account create UI exists anywhere in apps/web (bank-accounts is only referenced in config).
- **Files to change:** `apps/web/src/app/(app)/finance/config/page.tsx`, `apps/web/src/app/(app)/finance/config/BankAccountForm.tsx (new)`
- **Fix steps:**
  1. Replace API text with Links: 'Manage fiscal years' (/finance/fiscal-years) and 'Enter opening balances' (/finance/opening-balances).
  2. Build BankAccountForm (bankName, branch, accountNo, ifsc, type, purpose) posting to /v1/finance/bank-accounts via browserJson with zod client validation; refresh on success.
  3. Remove the 'coming soon' footer paragraph.
- **Acceptance:**
  - Config page has no text instructing API calls.
  - Bank account can be added from the UI and appears in table.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Bank account data entry is sensitive; validate IFSC format and mask account on display.
- **Depends on:** GAP-FINANCE-CONFIG-02

### GAP-FINANCE-CONFIG-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Bank account numbers print in full in a plain table column (page.tsx:80-83); no masking (last-4) or role gate beyond FINANCE_ROLES, so audit_officer, procurement_officer and payroll_admin see every departmental account number.
- **Verified evidence:** config/page.tsx:71 (not 80-83) renders accountNo unmasked in the DataTable. Access is the finance layout gate: FINANCE_ROLES (lib/auth/workRoles.ts:32-43) includes audit_officer, budget_officer, procurement_officer, accounts_officer, payroll_admin, tenant_admin, admin, and layout.tsx:27-36 only checks membership. No <Masked> component exists (grep). Server-side masking by finance-service cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/config/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`
- **Fix steps:**
  1. Create <Masked value reveal roles onReveal> showing last 4 digits, with an audited reveal (POST audit event) for finance_officer/finance_admin only.
  2. Use it in the accountNo column render.
  3. Ideally have finance-service return masked numbers by default with a reveal endpoint that emits an audit event.
  4. Keep CSV export off for this table.
- **Acceptance:**
  - audit_officer sees XXXX1234 with no reveal control.
  - finance_admin reveal emits an audit call and shows the full number.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/financial identifier exposure to non-finance roles; needs role decision.

### GAP-FINANCE-CONFIG-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** On a failed load the stat cards still read "Not set" and 0 (page.tsx:26-27,45-46): the red error state below contradicts "Active FY: Not set", which reads as a genuine configuration gap.
- **Verified evidence:** config/page.tsx:35-36 render 'Not set' and banks.length (0) regardless of errored (defined line 20); the RefreshErrorState (39-41) appears below the cards and contradicts them. Note the error state itself is already implemented, only the stat cards are wrong. The stale dashboard shows 'Opening Balances' card only when activeFY, hidden on error.
- **Files to change:** `apps/web/src/app/(app)/finance/config/page.tsx`
- **Fix steps:**
  1. When errored, render '—' for both StatCard values.
  2. Distinguish 'No active FY' (api ok, none active) from unknown.
- **Acceptance:**
  - Mock failure: cards show '—' and the retry state; success without active FY still shows 'Not set'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-CONFIG-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Start/End dates render raw from the API with no formatIndianDate (page.tsx:64-65), unlike fiscal-years which formats them.
- **Verified evidence:** DataTable columns startDate/endDate (config/page.tsx:52-53) render raw API strings; fiscal-years uses formatIndianDate (FiscalYearsTable.tsx imports it, adding startDateDisplay).
- **Files to change:** `apps/web/src/app/(app)/finance/config/page.tsx`
- **Fix steps:**
  1. Add render: (r)=>formatIndianDate(r.startDate) for both columns.
  2. Import from @/lib/formatters.
- **Acceptance:**
  - ISO 2026-04-01 renders 01/04/2026 (formatter output); invalid renders raw or '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-CONFIG-05

### GAP-FINANCE-CONFIG-05  ·  MEDIUM  ·  partly  ·  theme DUPLICATION (was DEADROUTE)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Duplicates /finance/fiscal-years: the same fiscal-years endpoint is fetched with a different, looser mapper and a read-only table, so the two lists can diverge in fields and status handling.
- **Verified evidence:** Real duplication: config/page.tsx:10-12 fetches /api/v1/finance/fiscal-years with an unvalidated cast mapper ({data}?.data ?? null) while fiscal-years/page.tsx:11-44 accepts arrays or {data}, filters and defaults fields. Config is read-only; fiscal-years adds form and activation. Divergence risk is real (an array payload makes config error), but 'dead route' is the wrong tag and fields are the same five.
- **Files to change:** `apps/web/src/app/(app)/finance/config/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/finance/fiscal-years/page.tsx`
- **Fix steps:**
  1. Extract mapFiscalYears/getFiscalYears from fiscal-years/page.tsx to loaders.ts as getFinanceFiscalYears.
  2. Use it in config; better, replace config's FY table with a summary plus link to /finance/fiscal-years.
  3. Do the same for bank accounts (getFinanceBankAccounts with zod schema).
- **Acceptance:**
  - Both pages use one loader; array payload works in both.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-CONFIG-04

### GAP-FINANCE-CONFIG-06  ·  LOW  ·  confirmed  ·  theme NAVUX (was OTHER)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** The "Opening Balances" card sits after two large tables and links to the Chart of Accounts, not to /finance/opening-balances, which exists as a route.
- **Verified evidence:** The Opening Balances card (config/page.tsx:84-93) is placed after both tables, renders only when activeFY exists, and its link 'View account heads' goes to /finance/chart-of-accounts; /finance/opening-balances exists (page + OpeningBalanceForm).
- **Files to change:** `apps/web/src/app/(app)/finance/config/page.tsx`
- **Fix steps:**
  1. Move the card up (setup order: FY, bank accounts, opening balances) or make a stepper.
  2. Change link to /finance/opening-balances with label 'Enter opening balances'.
  3. Show it disabled with hint when no active FY instead of hiding.
- **Acceptance:**
  - Link navigates to /finance/opening-balances.
  - Card visible without active FY with explanatory hint.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-CONFIG-01


---
## /finance/dashboard  —  `finance/dashboard.html`

- **Source:** `apps/web/src/app/(app)/finance/dashboard/page.tsx`
- **Design reference:** `redesign/finance/dashboard.html`

### GAP-FINANCE-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme DATA-INTEGRITY (was PII)

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** "Expenditure by Category" is fabricated: BudgetChart.tsx:26-32 multiplies total expenditure by hard-coded shares (Salaries 35%, Infra 25%, Programs 20%, Grants 12%, Other 8%). No API field supplies a category split, so a finance officer sees a plausible chart that is not their data and would be exported by "Export MIS".
- **Verified evidence:** BudgetChart.tsx:43-49 builds barData from Math.round(utilized*0.35/0.25/0.20/0.12/0.08); chart titled 'Expenditure by Category' (line 57). loaders.ts:1833-1845 mapFinanceDashboard exposes only budgetUtilisationPct, pendingSanctions, paymentsThisMonth, totalExpenditure - no category field. Export MIS (PrintExportButton -> window.print) prints the chart. Backend finance-service not in snapshot, so whether a category endpoint exists is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/dashboard/BudgetChart.tsx`, `apps/web/src/app/(app)/finance/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Remove the hard-coded barData block (BudgetChart.tsx:43-49) and the 'Expenditure by Category' <Chart type=bar> immediately, replacing it with an EmptyState 'Category breakdown not available'.
  2. Decision: ask finance-service owners for a category split (e.g. expenditure grouped by budget head) on /api/v1/finance/dashboard or a new read-model endpoint; amounts in paise strings.
  3. When available, extend FinanceDashboardSchema + mapFinanceDashboard with categoryBreakdown[{label, amountMinor}] and feed it to BudgetChart, converting minor->rupees once.
  4. Add unit test that BudgetChart renders no bar chart when categoryBreakdown is absent.
- **Acceptance:**
  - BudgetChart with expenditure=1000000 and no breakdown renders no bars and no 'Salaries/Infra' labels.
  - With a mocked breakdown, bar values equal the supplied amounts, not fixed percentages.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Fabricated split shown to finance officers and printed in MIS; removing it is safe, adding the real split needs backend agreement.
- **Depends on:** GAP-FINANCE-DASHBOARD-05

### GAP-FINANCE-DASHBOARD-02  ·  HIGH  ·  confirmed  ·  theme DATA-INTEGRITY (was I18N)

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** FyFilter only sets ?fy= in the URL; the dashboard loader does not accept it (FyFilter.tsx header comment; page.tsx getFinanceDashboard() takes no argument), so switching FY changes the dropdown but not one number, yet the stats are labelled "(FY)", "(YTD)".
- **Verified evidence:** FyFilter.tsx:8-11 comment admits loaders ignore ?fy=; onChange (21-26) only router.push + refresh. dashboard/page.tsx:26 calls getFinanceDashboard() with no args (loaders.ts:1855 takes none, path fixed /api/v1/finance/dashboard). Labels 'Expenditure (YTD)' (en.json:2039) stay static. Whether the endpoint supports an fy query is cannot-verify (backend absent).
- **Files to change:** `apps/web/src/app/(app)/finance/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/finance/_components/FyFilter.tsx`
- **Fix steps:**
  1. Change page to accept { searchParams: { fy?: string } } and pass fy to getFinanceDashboard(fy).
  2. Add optional fy param to getFinanceDashboard building /api/v1/finance/dashboard?fy=... (only after backend confirms the param); key the cache/telemetry per fy.
  3. Validate fy with lib/fiscalYear recentFinancialYears() list before use.
  4. Until backend supports it, hide FyFilter on this page (or disable with tooltip) so it cannot imply filtering.
  5. Show the applied FY in the subtitle.
- **Acceptance:**
  - Selecting FY 2024-25 issues a request with fy=2024-25 and numbers change (mock fetch assertion).
  - With unsupported backend the selector is not rendered.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** A misleading FY control on financial reporting; wrong-year figures could be quoted in MIS.

### GAP-FINANCE-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme DATA-INTEGRITY (was I18N)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** "Expenditure (YTD)" delta repeats budgetUtilisationPct, the same value as the first card (page.tsx:57-62): one datum shown twice, and "Approved" delta on the first card is a static label, not a measure.
- **Verified evidence:** page.tsx:50-57 first card delta is the literal string 'Approved' with up={false}; page.tsx:58-64 'Expenditure (YTD)' delta is formatPercent(data.budgetUtilisationPct), identical to first card value (line 54). 'Approved' is hard-coded English, not in next-intl (page otherwise uses t()).
- **Files to change:** `apps/web/src/app/(app)/finance/dashboard/page.tsx`, `apps/web/messages/en.json`, `apps/web/messages/hi.json`
- **Fix steps:**
  1. Drop the 'Approved' delta from the utilisation card or replace with a real measure (e.g. sanctioned budget via formatMoney once the API supplies it).
  2. Replace the expenditure card delta with something distinct (e.g. paymentsThisMonth) or remove it; delete the up/down arrows where no direction exists.
  3. If a caption is kept, move to a financeDashboard.* key in en.json and hi.json.
- **Acceptance:**
  - Rendered cards never show the same percentage twice.
  - No hard-coded English strings remain in the StatCards (i18n lint).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; cosmetic/clarity only.

### GAP-FINANCE-DASHBOARD-04  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** "Remaining" in the donut is inferred as utilised x (100 - pct)/pct (BudgetChart.tsx:15-20), zero when pct is 0 or above 100, so an over-spent budget shows a full ring and "Remaining ₹0.00" instead of an overspend.
- **Verified evidence:** Real, but lines are BudgetChart.tsx:33-36 (not 15-20). remaining is only computed when 0<pct<=100 as utilized*(100-pct)/pct, else 0; pct>100 gives Remaining 0.00 and a full ring with no overspend indicator; pct 0/null also yields 0 (no sanctioned budget, remaining unknowable). Also computed in float rupees (expenditure/100, Math.round) rather than paise/BigInt, contrary to money rules. The infinity bug was already fixed.
- **Files to change:** `apps/web/src/app/(app)/finance/dashboard/BudgetChart.tsx`, `apps/web/src/app/(app)/finance/dashboard/page.tsx`
- **Fix steps:**
  1. Have the API return sanctionedMinor (paise string) and derive remaining = sanctioned - expenditure in BigInt; stop back-computing from the percentage.
  2. In BudgetChart, when expenditure>sanctioned render an 'Overspent by ₹X' label using formatMoney and a warning colour/icon instead of a Remaining slice.
  3. When utilisationPct is null or 0 with no budget, show 'No sanctioned budget' rather than a ₹0.00 Remaining slice.
  4. Pass paise strings into BudgetChart and format via formatMoney; convert to numbers only for chart geometry.
- **Acceptance:**
  - pct=120 renders 'Overspent' text and no 'Remaining ₹0.00' legend.
  - pct=null renders the no-budget message.
  - pct=25, expenditure 25000000 paise gives Remaining ₹7,50,000.00 (or exact from sanctioned).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display; wrong remaining could misstate available budget.
- **Depends on:** GAP-FINANCE-DASHBOARD-05

### GAP-FINANCE-DASHBOARD-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Chart card and module tiles are not gated on source === "error": on failure the stats read "—" but the chart renders a zero donut and bars (page.tsx:31-38, 82-86).
- **Verified evidence:** page.tsx: stat cards are gated by errored (lines 54-77) but <Card title=budgetChart> (82-86) always renders BudgetChart with FINANCE_DASHBOARD_EMPTY (pct null, totalExpenditure 0) -> zero donut and zero bars; modules Card (88-106) also renders (links are static, so tiles are arguably fine). Only the small DataSourceBadge signals failure. Line refs in observation 31-38 are the comment, actual 82-86.
- **Files to change:** `apps/web/src/app/(app)/finance/dashboard/page.tsx`
- **Fix steps:**
  1. When errored, replace the chart Card body with the shared LoadErrorState (app/_components/ds/LoadErrorState.tsx, pass {status, errorMessage} from getFinanceDashboard result) so 403 shows PermissionDenied and other failures show a retry.
  2. Keep the quick-link module tiles rendered (navigation only) or dim them; do not gate on data.
  3. Destructure status/errorMessage from the loader result.
- **Acceptance:**
  - Mock loader returning source:'error' renders no <svg> chart and shows retry/permission state.
  - Healthy load still renders both charts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-DASHBOARD-04

### GAP-FINANCE-DASHBOARD-06  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** "Export MIS" is window.print() of the page (PrintExportButton.tsx header comment), not an MIS file; the tile grid prints with it.
- **Verified evidence:** PrintExportButton.tsx:60-86 sets document.title then window.print(); page.tsx:43 uses it labelled 'Export MIS'. globals-print.css:4-8 hides nav/buttons/sidebar only; the module tile <Link class=stat> grid and FyFilter select are not hidden so they print. No file export exists.
- **Files to change:** `apps/web/src/app/(app)/finance/dashboard/page.tsx`, `apps/web/src/app/globals-print.css`
- **Fix steps:**
  1. Decision: define the MIS deliverable (CSV/XLSX/PDF) and request a finance-service export endpoint.
  2. Interim: rename label to 'Print' (en/hi) so it does not promise an MIS file.
  3. Add className='no-print' to the modules Card and FyFilter wrapper so print shows only stats + charts.
  4. Add a print header with FY, tenant and generated timestamp.
- **Acceptance:**
  - Print preview omits quick-link tiles.
  - Button label reads Print until a real export exists.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Officers may submit a print as MIS; contents include fabricated split until -01 fixed.
- **Depends on:** GAP-FINANCE-DASHBOARD-01

### GAP-FINANCE-DASHBOARD-07  ·  LOW  ·  partly  ·  theme A11Y (was FABRICATED)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Chart component exposes no data table or text alternative in the code read (Chart.tsx) beyond a legend; colours are hex literals (#4f46e5 etc.), not tokens (BudgetChart.tsx:24-32).
- **Verified evidence:** Chart.tsx SVGs (lines 63,130,206,258,293,338) have no role/aria-label and only per-element <title>; no data table alternative, so accessibility gap is real. Hex literals #4f46e5 etc. at BudgetChart.tsx:39-40,44-48 are real (title lines shifted from 24-32). Legend exists for the donut labels.
- **Files to change:** `apps/web/src/app/_components/Chart.tsx`, `apps/web/src/app/(app)/finance/dashboard/BudgetChart.tsx`
- **Fix steps:**
  1. In Chart.tsx add role='img' and aria-labelledby (title + desc) to each <svg>, and render a visually-hidden <table> of label/value rows.
  2. Replace hex literals in BudgetChart with CSS variable tokens (e.g. var(--chart-1..5)) defined in civitas-ds.css.
  3. Ensure slice/bar not colour-only (labels present).
- **Acceptance:**
  - axe reports no svg-img-alt violations on /finance/dashboard.
  - Screen-reader table lists every series value.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared Chart change affects every dashboard; visual regression test needed.


---
## /finance/debt  —  `finance/debt.html`

- **Source:** `apps/web/src/app/(app)/finance/debt/page.tsx`
- **Design reference:** `redesign/finance/debt.html`

### GAP-FINANCE-DEBT-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Subtitle promises "EMI schedules, and lender-wise outstanding debt" (page.tsx:14) but the route renders only instrument/source/amount/maturity/status: there is no EMI schedule, no lender, no outstanding balance. The "Amount" column is a single figure of unstated meaning (sanctioned vs outstanding).
- **Verified evidence:** debt/page.tsx:14 subtitle says 'EMI schedules, and lender-wise outstanding debt'; DebtTable.tsx:18-24 columns are only instrument, source, amountMinor, maturity, status. page.tsx:21 comment states treasury.finance_debt has no lender column. FinanceDebtSummary type is in @civitasone/types (absent from snapshot), so whether EMI/outstanding fields exist is cannot-verify. Amount meaning (sanctioned vs outstanding) not stated anywhere in UI.
- **Files to change:** `apps/web/src/app/(app)/finance/debt/page.tsx`, `apps/web/src/app/(app)/finance/debt/DebtTable.tsx`
- **Fix steps:**
  1. Immediately reword subtitle to what is shown ('Loan and debt instruments by source').
  2. Label the Amount column with its real meaning once confirmed with backend (e.g. 'Sanctioned amount').
  3. Decision: backend to add lender, outstandingMinor and an EMI schedule endpoint; then add an expandable row / detail route using DataTable rowHref.
  4. Move page strings to next-intl.
- **Acceptance:**
  - Subtitle no longer promises EMI/lender.
  - Amount header states sanctioned/outstanding.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Misleading scope on a debt console; low data risk.

### GAP-FINANCE-DEBT-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Stat "Sources" (page.tsx:22) counts distinct source codes (RBI/market/central_govt): a 3-value metric on a debt console; the code comment admits treasury.finance_debt has no lender column (page.tsx:21) so the stat is a stand-in.
- **Verified evidence:** debt/page.tsx:22 value = new Set(loans.map(l=>l.source)).size with comment at :21 admitting source is the closest field. Metric is a distinct count of 3 possible values.
- **Files to change:** `apps/web/src/app/(app)/finance/debt/page.tsx`
- **Fix steps:**
  1. Replace 'Sources' card with 'Total sanctioned' (sum of amountMinor via BigInt + formatMoney) or 'Maturing in 12 months'.
  2. If a stat needs lender, wait for backend column (see DEBT-01).
- **Acceptance:**
  - Card shows an amount total equal to sum of table rows.
  - No count-of-source card remains.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-DEBT-01

### GAP-FINANCE-DEBT-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Failed fetch gives Total Loans 0 / Active 0 / Closed 0 / Sources 0 (page.tsx:7-9,18-22): genuine-looking zeros; only the small badge inside the table says loading failed (DebtTable.tsx:16).
- **Verified evidence:** page.tsx:6-9,18-22 derive stats from loans (empty [] on failure per loaders.ts:2195-2203), so Total 0/Active 0/Closed 0/Sources 0 render as real numbers; only DebtTable.tsx:16 DataSourceBadge (via useSeededResource) signals failure. Note table may show cached rows while stats show 0.
- **Files to change:** `apps/web/src/app/(app)/finance/debt/page.tsx`, `apps/web/src/app/(app)/finance/debt/DebtTable.tsx`
- **Fix steps:**
  1. Read source (and status/errorMessage) in page.tsx; when source==='error' render '—' for all four StatCards, matching finance/dashboard/page.tsx `errored` pattern.
  2. Render LoadErrorState above the table on error.
  3. Better: compute stats inside DebtTable from useSeededResource rows so cards and table agree with cache state.
- **Acceptance:**
  - Failed loader shows '—' in all four cards.
  - Successful empty list shows genuine 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-ADVANCES-02

### GAP-FINANCE-DEBT-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Source codes print raw ("central_govt", "RBI", "market") via the default DataTable text cell (DebtTable.tsx:20); Maturity has no formatIndianDate render, so the date shows in whatever raw format the API returns.
- **Verified evidence:** DebtTable.tsx:20,22: source and maturity columns have no render/cellType; DataTable cellValue (DataTable.tsx:126-141) falls to String(row[key]). Raw 'central_govt' prints; maturity prints as API string (advances table uses formatIndianDate for dates, so the helper is available in formatters.ts:2).
- **Files to change:** `apps/web/src/app/(app)/finance/debt/DebtTable.tsx`
- **Fix steps:**
  1. Add render for maturity: formatIndianDate(row.maturity).
  2. Add render for source using a label map (central_govt->'Central Govt', RBI, market->'Market') or humanizeStatus from lib/formatters.
  3. Add i18n keys for column labels.
- **Acceptance:**
  - A row with maturity 2030-03-31 shows 31 Mar 2030 (Indian format).
  - 'central_govt' shows 'Central Govt'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; CSV export uses raw value, keep raw for export.

### GAP-FINANCE-DEBT-05  ·  LOW  ·  confirmed  ·  theme A11Y (was OTHER)

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** "Closed" stat uses an icon of a tick on a warning-amber tile and "Active" an upward chart, so tile colours do not match meaning (page.tsx:19-20 iconBg #ecfdf3 / #fffaeb).
- **Verified evidence:** page.tsx:19-20: Active uses icon 📈 with iconBg #ecfdf3 (green), Closed uses ✅ with #fffaeb (amber); the tick on amber does not match the semantics. Purely cosmetic (colours are hex literals).
- **Files to change:** `apps/web/src/app/(app)/finance/debt/page.tsx`
- **Fix steps:**
  1. Swap tile colours so Closed uses neutral/green tick and Active uses info; use ds tokens instead of hex.
- **Acceptance:**
  - Closed tile no longer uses amber.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/expenditure/advances  —  `finance/expenditure-advances.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/advances/page.tsx`
- **Design reference:** `redesign/finance/expenditure-advances.html`

### GAP-FINANCE-EXPENDITURE-ADVANCES-01  ·  HIGH  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** "Overdue > 90d" counts status === "overdue" (page.tsx:13) not days-past-due > 90, and "Settled (MTD)" sums every adjusted advance regardless of date (page.tsx:18): both labels claim a period or threshold the code never applies.
- **Verified evidence:** advances/page.tsx:13 overdue = status==='overdue' (no days-past-due math); line 18 settled sums adjustedAmount for status==='adjusted' with no date filter. Labels en.json:1814-1815 'Settled (MTD)' and 'Overdue > 90d'. Line 12 'Open' counts status==='active'.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/page.tsx`, `apps/web/messages/en.json`, `apps/web/messages/hi.json`
- **Fix steps:**
  1. Compute overdue90 = advances where dueDate < today-90d and balance>0 using date-fns/UTC midnight, or rename label to 'Overdue'.
  2. Filter settled by adjustment date within current month if the API exposes it (else rename to 'Settled (all time)').
  3. Update en/hi strings.
- **Acceptance:**
  - Advance due 100 days ago counts in Overdue>90d; one due 30 days ago does not.
  - Settled card excludes prior-month adjustments.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Reported KPIs; wrong label misleads accounts officers.

### GAP-FINANCE-EXPENDITURE-ADVANCES-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** Failed fetch gives Open 0 / Outstanding ₹0.00 / Settled ₹0.00 / Overdue 0 (page.tsx:12-18) - zeros read as a clean ledger to an accounts officer; only the in-table badge signals failure.
- **Verified evidence:** page.tsx:10-18 stats computed from advances ([] on failure per loaders.ts:1909-1917) so Open 0, formatMoney(0n)='₹0.00' etc. Only AdvancesTable's DataSourceBadge signals failure. source is available but not used for stats.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/advances/AdvancesTable.tsx`
- **Fix steps:**
  1. In page.tsx, when source==='error' show '—' for all four cards (same pattern as finance/dashboard/page.tsx errored).
  2. Render LoadErrorState using loader status/errorMessage.
  3. Optionally compute stats client-side from useSeededResource rows.
- **Acceptance:**
  - Failed load shows dashes and error state, not ₹0.00.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-DEBT-03

### GAP-FINANCE-EXPENDITURE-ADVANCES-03  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Personal advances (officer names) and party advances share one list with a free-text Purpose (type, capitalised) - no recovery-mode column and no DPDP role gating of individual officers' balances beyond FINANCE_ROLES.
- **Verified evidence:** Single table mixes personal and party advances with beneficiary + type columns (AdvancesTable.tsx:61-70); no recovery-mode column in code. The page has no role gating in the file (FINANCE_ROLES gating, if any, would be in layout/middleware not read here) - cannot-verify. DPDP concern is a judgement, not a code defect.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/AdvancesTable.tsx`
- **Fix steps:**
  1. Confirm FINANCE_ROLES enforcement on the route/proxy.
  2. Decision: add an advance-kind (officer/party) from API and a filter tab; add recoveryMode column if API supplies it.
  3. Mask/omit officer balances for roles not in payroll-recovery scope using a shared <Masked>.
- **Acceptance:**
  - Officer/Party filter tab present.
  - Unauthorised role sees masked balances.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII exposure of officers' balances.

### GAP-FINANCE-EXPENDITURE-ADVANCES-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** The "Ageing" button is window.print() of the current page (PrintExportButton.tsx), not an ageing report: it prints the same table under the title "Advance Ageing".
- **Verified evidence:** advances/page.tsx:27 PrintExportButton label 'Ageing' (en.json:1809) with documentTitle 'Advance Ageing' just calls window.print() (PrintExportButton.tsx:71-80) of the same page; no ageing buckets computed.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/advances/AdvancesTable.tsx`
- **Fix steps:**
  1. Rename button to 'Print' or build a real ageing report: bucket balances 0-30/31-60/61-90/>90 days from dueDate in a new AdvanceAgeing component (BigInt sums, formatMoney).
  2. Print CSS: mark filters/tabs .no-print.
- **Acceptance:**
  - Ageing view shows four buckets whose totals equal Outstanding.
  - Button label matches behaviour.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-EXPENDITURE-ADVANCES-01

### GAP-FINANCE-EXPENDITURE-ADVANCES-05  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** No CSV export on this table although sibling registers have exportable (AdvancesTable.tsx:50-66 vs BillsTable/GuaranteesTable).
- **Verified evidence:** AdvancesTable.tsx:60-77 DataTable has no exportable/exportFilename props; BillsTable.tsx:56, GuaranteesTable.tsx:32, SchemeTable.tsx:36 and DebtTable.tsx:30 set exportable. Line refs 50-66 in the observation are wrong (DataTable is 60-77).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/AdvancesTable.tsx`
- **Fix steps:**
  1. Add exportable and exportFilename='advances-register' to the DataTable.
  2. Check DataTable CSV export writes raw paise vs formatted (DataTable.tsx:268 uses formatMoney) and that PII export is role-gated/audited.
- **Acceptance:**
  - Export button appears; CSV has all filtered rows with ₹ amounts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** CSV of officers' advances is PII; ensure route role gate.

### GAP-FINANCE-EXPENDITURE-ADVANCES-06  ·  LOW  ·  confirmed  ·  theme I18N

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** "Officer / Party" column key is beneficiary while the create form asks for "Payee" (advances/new/page.tsx labelPayee): two names for one field.
- **Verified evidence:** AdvancesTable.tsx:63 key beneficiary label colBeneficiary 'Officer / Party' (en.json:1838) vs form labelPayee 'Payee' (en.json:1825), payload key payee (new/page.tsx:47). Naming mismatch, cosmetic.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/AdvancesTable.tsx`, `apps/web/src/app/(app)/finance/expenditure/advances/new/page.tsx`, `apps/web/messages/en.json`
- **Fix steps:**
  1. Pick one term ('Payee') and update both message sets in en.json and hi.json.
- **Acceptance:**
  - Form and register use same label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/expenditure/advances/new  —  `finance/expenditure-advances-new.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/advances/new/page.tsx`
- **Design reference:** `redesign/finance/expenditure-advances-new.html`

### GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** The advance is created immediately on submit with no ConfirmDialog and no reason/authority capture, unlike Bills, Sanctions and Journal Entry (page.tsx:33-45). An advance is an outward commitment of public money; the audit trail carries no maker justification and a double click is only guarded by the busy flag (no idempotency key, unlike JournalEntryForm).
- **Verified evidence:** new/page.tsx:30-67 submit POSTs directly to /api/proxy/v1/finance/advances; no ConfirmDialog/ActionButton and no reason field (form fields lines 83-117 only advanceNo, payee, amount, dueDate, purpose). FinanceActions.tsx uses ActionButton requireReason for sanctions/bills/payments; JournalEntryForm.tsx:74,159 sends x-idempotency-key from state and uses confirmOpen. Busy flag only (line 119). Whether backend requires a reason is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/new/page.tsx`, `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`
- **Fix steps:**
  1. Add const [idempotencyKey,setIdempotencyKey]=useState(()=>crypto.randomUUID()) and send it as x-idempotency-key in the fetch (line 41); rotate on success, as JournalEntryForm does.
  2. Replace submit button with the shared ConfirmDialog (as JournalEntryForm confirmOpen) showing payee, amount via formatMoney, due date; add requireReason field 'Sanctioning authority & reason'.
  3. Include reason in the POST body only if the createAdvanceBody schema accepts it (confirm with backend); otherwise send as audit header/event.
  4. Disable submit after success until redirect.
- **Acceptance:**
  - Double-click Submit sends one request with the same idempotency key.
  - Confirmation dialog appears with amount before POST; cancel sends nothing.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Outward commitment of public money; low regression risk for web change, reason field needs backend support for audit.

### GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-02  ·  HIGH  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Advance number is a free-text required field (page.tsx:79): officers type the running number by hand, so duplicates and gaps are possible; only the server can reject a duplicate.
- **Verified evidence:** new/page.tsx:84-85 (lines shifted) advanceNo is a required free-text <input id=adv-no>; only server-side validation surfaces via formError.fieldError('advanceNo'). Whether backend can auto-number is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/new/page.tsx`
- **Fix steps:**
  1. Decision: have finance-service assign advanceNo (sequence per FY) and remove the input, showing the number after creation.
  2. If manual entry must stay, add pattern/format hint and a debounced uniqueness check against the advances list.
  3. Keep field-level error display for duplicate.
- **Acceptance:**
  - Creating two advances yields unique consecutive numbers with no user entry (or duplicate typed value shows inline error).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate voucher numbers affect audit trail.

### GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Payee is optional (page.tsx:84-86) yet the register column "Officer / Party" is the primary identifier; an advance can be created for nobody. No employee/vendor picker, and DPDP-sensitive individual advances are entered as free text.
- **Verified evidence:** new/page.tsx:91-92 payee input has no required attribute and payload sends payee: form.payee || undefined (line 47); free text, no employee/vendor picker. Register column beneficiary (AdvancesTable.tsx:63) is primary. DPDP claim is judgement; no PII controls visible. Backend may reject empty payee (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/new/page.tsx`
- **Fix steps:**
  1. Mark payee required (aria-required, required attr) unless backend allows anonymous advances.
  2. Replace with a searchable picker over employees/vendors (reuse existing HR/vendor pickers) storing opaque ID + display name.
  3. Document DPDP purpose in help text.
- **Acceptance:**
  - Submitting without payee is blocked client-side.
  - Picker selection sends the ID.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII: free-text officer names; picker requires cross-service read API.

### GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Amount uses Math.round(Number*100): "1e3", negatives blocked only by min=0 in the browser, and no upper limit vs sanction or entitlement is shown (page.tsx:31,90).
- **Verified evidence:** new/page.tsx:40 amountMinor = Math.round(Number(form.amount||'0')*100).toString(); float multiplication (1.005*100 rounds wrong), type=number accepts '1e3' and '-5' via typing (min only affects validity UI/submit; form validation would block negatives but not exponent notation). No sanction/entitlement cap shown. Zod on backend is unseen.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/new/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Change input to type=text inputMode=decimal with regex /^\d{1,13}(\.\d{1,2})?$/ and pattern attr.
  2. Add shared helper rupeesToPaiseString(str) that splits on '.' and builds paise with string/BigInt math (no Number/Math.round).
  3. Reject <=0 and show inline error.
  4. Show applicable sanction limit if API supplies it.
- **Acceptance:**
  - '1e3' and '-5' rejected; '10.05' -> '1005'; '0.29' -> '29'.
  - Unit test for helper on 1.005, 0.1+0.2 style inputs.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money entry; regression if helper mis-parses commas.

### GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme ERRORS (was ROLEGATE)

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Every failure, including a 403 for a role that cannot create advances, shows the same "couldn't save... try again" copy (useFormError.ts CODE_TO_KIND), so an unauthorised user is told to retry.
- **Verified evidence:** new/page.tsx:53-56 uses formError.fromResponse(res,'save'); useFormError.ts:40-44 CODE_TO_KIND maps only VALIDATION_FAILED/VALIDATION_ERROR/NOT_FOUND; fromResponse (100-111) never reads res.status, so 403 gets messages.ts 'save' copy 'Nothing was changed. Please try again'. (The LoadErrorState/PermissionDenied path exists only for loaders.)
- **Files to change:** `apps/web/src/lib/useFormError.ts`, `apps/web/src/lib/messages.ts`
- **Fix steps:**
  1. Add a 'forbidden' MessageKind in messages.ts ('You don't have permission to do this. Ask your administrator for access.') with actions back/help.
  2. In fromResponse, if res.status===403 (or code FORBIDDEN) use kind 'forbidden'; add 401 -> session expired.
  3. Add tests in useFormError tests for 403.
- **Acceptance:**
  - 403 response shows permission copy with no 'try again'.
  - 422 still shows save copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared hook used across ~50 forms; copy change only.

### GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-06  ·  LOW  ·  partly  ·  theme I18N

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Purpose is a single-line input for a field the register shows as a capitalised "type" column (AdvancesTable.tsx colPurpose maps key type): the label suggests free text while the list treats it as a category.
- **Verified evidence:** Form Purpose (new/page.tsx:112-113) is a free-text single-line input and is sent as purpose; register shows key 'type' capitalised with label colPurpose (AdvancesTable.tsx:64). Whether the API maps purpose to type or is a category is cannot-verify (schema absent); mismatch of field names (purpose vs type) is real.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/advances/new/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/advances/AdvancesTable.tsx`
- **Fix steps:**
  1. Confirm with backend whether purpose and type are the same column.
  2. If type is an enum, change the input to a <select> of allowed values plus optional remarks; else render register value without capitalise transform.
- **Acceptance:**
  - Created advance shows same wording in register as entered.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /finance/expenditure/bills  —  `finance/expenditure-bills.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/bills/page.tsx`
- **Design reference:** `redesign/finance/expenditure-bills.html`

### GAP-FINANCE-EXPENDITURE-BILLS-01  ·  HIGH  ·  partly  ·  theme API (was OTHER)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** "+ New Bill" POSTs only { reason, status: "pending" } (FinanceActions.tsx:193): a bill record is lodged from a one-line reason with no vendor, invoice number, amount, PO or lines, then appears in the register with blank columns.
- **Verified evidence:** Real: BillCreateAction (apps/web/src/app/(app)/finance/_components/FinanceActions.tsx:180-198) is an ActionButton with requireReason whose onConfirm does postJson('/api/proxy/v1/finance/bills',{reason,status:'pending'}) (l.193). No vendor, invoice no, amount, PO or lines are collected; BillsTable columns (BillsTable.tsx:40-49) need billNo/vendor/amount/poRef. Unverifiable: whether finance-service accepts this body (services/finance-service and @civitasone/types createBillBody are absent; UC page comment new/page.tsx:134-139 shows createBillBody has grossMinor, so backend likely rejects with 400 -> generic error toast rather than creating a blank row). Also sends client-supplied status:'pending'.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/new/page.tsx`, `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`, `apps/web/src/app/(app)/finance/expenditure/bills/page.tsx`
- **Fix steps:**
  1. Create bills/new/page.tsx as a real form (model on utilization-certificates/new/page.tsx + useFormError) with vendor (picker over getFinanceVendors), invoice/bill no, invoice date, gross amount in rupees -> paise string via a shared rupeesToMinorString helper (no Math.round(x*100)), optional PO ref, reason.
  2. Validate with a zod schema mirroring createBillBody (confirm the field list with finance-service owners) before POST; disable submit while busy.
  3. Replace BillCreateAction on bills/page.tsx with <Link href='/finance/expenditure/bills/new' className='btn primary'>; keep ActionButton confirm+reason on the final submit step.
  4. Stop sending status:'pending' from the client; let the server set initial status.
  5. Show field errors from formError.fieldError(...) and redirect to the new bill detail.
- **Acceptance:**
  - Unit: submitting without vendor/amount shows field errors and makes no fetch call.
  - Manual: fill valid form -> POST body contains vendor, invoice no, grossMinor string; new row shows all columns non-blank.
  - Body contains no 'status' key.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money entry point: amount must be paise-exact and server-validated; maker-checker on bill pass must remain.
- **Depends on:** GAP-FINANCE-EXPENDITURE-BILLS-05

### GAP-FINANCE-EXPENDITURE-BILLS-02  ·  HIGH  ·  confirmed  ·  theme STATS (was DATEFMT)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** "Value In Pipeline" sums every bill including paid ones (page.tsx:18) and "Paid (MTD)" sums all paid bills with no date filter (page.tsx:19): "pipeline" is total value, "MTD" is all time.
- **Verified evidence:** bills/page.tsx:18 totalAmount = sum of ALL bills (any status incl. paid, rejected) and is labelled 'Value In Pipeline' (l.39); l.19 paidAmount sums every status==='paid' bill with no date filter and is labelled 'Paid (MTD)' (l.40). BigInt summing is correct; the semantics are wrong. (Cited line numbers are 18/19 for the computation, 39/40 for the cards.)
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Pipeline = sum over status in ('pending','under_review') only (same predicate as inProcess at l.13), or rename label to 'Total Value'.
  2. MTD: filter paid bills by a paid date (BillSummary has submittedDate/dueDate in BillsTable type; no paidDate seen - cannot verify) in the IST current month; if no paid date exists in the API, rename to 'Paid (all time)' and ask backend to expose paidAt.
  3. Compute month boundaries in IST via a shared helper rather than new Date() local time.
  4. Update statValueInPipeline/statPaidMtd strings in en.json and hi.json accordingly.
- **Acceptance:**
  - Unit: bills [pending 100, paid 50 (paid last month), paid 25 (this month)] -> pipeline 100, MTD 25.
  - Manual: label matches value definition.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Finance dashboards misreporting outstanding vs paid amounts; do not ship MTD without a real paid date.

### GAP-FINANCE-EXPENDITURE-BILLS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Failed fetch shows Bills In Process 0, Total 0, ₹0.00, ₹0.00 (page.tsx:13-19); the only signal is the badge in the table.
- **Verified evidence:** bills/page.tsx:11 destructures data/source; on error getFinanceBills returns [] (loaders.ts:1892), so inProcess=0, bills.length=0, formatMoney(0n)=₹0.00 render in StatCards (l.37-40). `source` is only forwarded to BillsTable (l.46), whose useSeededResource may even show cached rows (resource.ts:232-249) while the cards still say 0 - cards and table can disagree. StatCard already renders '—' for null (StatCard.tsx displayValue).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/page.tsx`
- **Fix steps:**
  1. In BillsPage compute `const failed = source === 'error' && bills.length === 0`.
  2. Pass null (StatCard renders '—') for all four stat values when failed.
  3. Render <RefreshErrorState error={toHumanError('load',{area:'bills'})} backHref='/finance'/> (from ds, pattern in metadata/records/page.tsx:23) above/in place of the Card when failed; keep BillsTable only for the cached-fallback case.
  4. Better: move stat computation into a client wrapper that reads rows from the same useSeededResource so cards and table cannot disagree.
- **Acceptance:**
  - Component test: mock getFinanceBills -> {data:[],source:'error'}; expect '—' in stats and a Retry button, no '₹0.00'.
  - Manual: block /api/v1/finance/bills, page shows error state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.
- **Depends on:** SHARED: finance stats-on-error helper (pass null to StatCard + render LoadErrorState/RefreshErrorState)

### GAP-FINANCE-EXPENDITURE-BILLS-04  ·  MEDIUM  ·  partly  ·  theme IA (was OTHER)

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** "Finance Configuration" link sits beside the primary action on a bills page; the code comment concedes it is the closest destination, not a pre-audit rules screen (page.tsx:28-31).
- **Verified evidence:** Link exists at bills/page.tsx:31 (<Link href='/finance/config' className='btn ghost'>{t('financeConfigLink')}</Link>) next to BillCreateAction (l.32); the comment at l.28-30 does say there is no dedicated pre-audit-rules screen. /finance/config exists (finance/config dir). It is a UX/IA judgement rather than a defect; not a dead link.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Product decision: remove the ghost button from the bills header (recommended) or relabel to what /finance/config really contains.
  2. If removed, delete the Link import (bills/page.tsx:7) and financeConfigLink key in en.json/hi.json.
  3. If pre-audit rules are needed, track as a separate screen.
- **Acceptance:**
  - Manual: bills header shows only the primary action (or the relabelled link).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-EXPENDITURE-BILLS-05  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** "+ New Bill" shows for every FINANCE_ROLES member (page.tsx:32); who may lodge bills is enforced by finance-service (absent), so read-only roles reach a 403 after the dialog.
- **Verified evidence:** Confirmed UI facts: BillCreateAction is rendered unconditionally (bills/page.tsx:32); the only role gate is the module-wide finance/layout.tsx:30-33 against FINANCE_ROLES (lib/auth/workRoles.ts:36 - includes read-oriented roles such as audit_officer, budget_officer, procurement_officer, tenant_admin). So any of these sees the button. The '403 after the dialog' outcome and the actual finance-service create-role list are cannot-verify (service absent); on failure FinanceActions.postJson throws a generic financeActionError, not a role-specific message.
- **Files to change:** `apps/web/src/lib/auth/workRoles.ts`, `apps/web/src/app/(app)/finance/expenditure/bills/page.tsx`, `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`
- **Fix steps:**
  1. Add FINANCE_WRITE_ROLES (derive from finance-service bills routes' write guard; confirm with backend) in workRoles.ts.
  2. In bills/page.tsx read session roles server-side (same helper finance/layout.tsx uses) and render <BillCreateAction/> only when a role intersects FINANCE_WRITE_ROLES.
  3. Make postJson map HTTP 403 to a specific 'You do not have permission' message.
  4. Keep server enforcement authoritative; apply same guard to SanctionCreateAction and other list-level create actions.
- **Acceptance:**
  - Unit: audit_officer session -> no '+ New Bill' button; finance_officer -> present.
  - Manual: forced POST as audit_officer returns 403 and shows permission message.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** UI hiding is cosmetic; wrong role list could hide the action from legitimate makers.

### GAP-FINANCE-EXPENDITURE-BILLS-06  ·  LOW  ·  partly  ·  theme UUID

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** PO Ref uses formatInternalRef and shows raw ids in the mono cell for Bill (BillsTable.tsx:46); dates via formatIndianDate.
- **Verified evidence:** BillsTable.tsx:43 renders formatInternalRef(b.poRef) which returns the raw ref string as-is (formatters.ts:26-29), e.g. 'procurement_po:abc-123' with the type prefix and id - only null/'undefined' become '—'. But the observation's 'raw ids in the mono cell for Bill' is wrong: the mono cell (l.41) is b.billNo, a human bill number, not an id. Dates use formatIndianDate (l.45-46) correctly.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/BillsTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Have the bills API/loader return a poNumber (human PO no.) alongside poRef - cannot verify it exists; otherwise resolve via procurement PO loader.
  2. In BillsTable colPoRef render the PO number as a <Link> to /procurement/... PO detail; fall back to '—' when unresolved.
  3. Optionally extend formatInternalRef (or add formatEntityRef) to strip the 'type:' prefix.
- **Acceptance:**
  - Unit: poRef 'procurement_po:abc-123' with poNumber 'PO-2026-014' renders 'PO-2026-014'.
  - poRef null -> '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /finance/expenditure/bills/[id]  —  `finance/expenditure-bills-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/bills/[id]/page.tsx`
- **Design reference:** `redesign/finance/expenditure-bills-detail.html`

### GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** A failed fetch is indistinguishable from a missing bill: getFinanceBillById falls back to null, so the page renders "Bill not found - may have been removed or the ID is invalid" (page.tsx:17-24) and the DataSourceBadge on the found branch (page.tsx:45) can never show for a load failure.
- **Verified evidence:** getFinanceBillById (loaders.ts:1900-1907) returns null data with source 'error' on any failure; page.tsx:13-23 renders not-found whenever !bill regardless of source, so 500/403/network errors read 'not found' - true. The found-branch badge (line 41) only shows when bill exists and source==='error' which cannot occur with fetchJson, so it is dead. However apiClient.ts already returns status/errorCode (lines 8-26, 144), so the fix is available.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status and errorMessage from getFinanceBillById.
  2. If source==='error' && status!==404 render shared LoadErrorState (403 -> PermissionDenied) with area 'bill' and backHref; only status 404 shows the not-found EmptyState.
  3. Remove the dead DataSourceBadge on the found branch.
- **Acceptance:**
  - Mock 500 shows retry error state; mock 404 shows Bill not found; mock 403 shows permission denied.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-DASHBOARD-05

### GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** "Pass bill" is always enabled (FinanceActions.tsx:126-138); only Release payment is gated (canPay). A paid or already-passed bill can be "passed" again, and a mismatched 3-way match is not blocked in the UI.
- **Verified evidence:** FinanceActions.tsx:126-138 'Pass bill' ActionButton has no disabled prop; only 'Release payment' has disabled={!canPay} (line 143). Component receives only status, not threeWayMatch, so it cannot block on mismatch. Reason dialog exists. Server-side enforcement is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`, `apps/web/src/app/(app)/finance/expenditure/bills/[id]/page.tsx`
- **Fix steps:**
  1. Add threeWayMatch prop to BillPassPayActions (pass bill.threeWayMatch from page.tsx:40).
  2. Compute canPass = status in ('submitted','pending','under_review') && threeWayMatch==='matched'; set disabled={!canPass} on Pass bill with a title/aria-describedby explaining why.
  3. Keep backend as final authority; surface its rejection via the toast.
- **Acceptance:**
  - Bill with status 'paid' or 'passed' shows Pass disabled.
  - threeWayMatch 'mismatch' disables Pass with reason text.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Approval workflow; wrong status enum list could block legitimate passes - confirm enum with backend.

### GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-05  ·  LOW  ·  partly  ·  theme A11Y (was FABRICATED)

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Breadcrumb is hand-rolled (page.tsx:29-33) instead of AutoBreadcrumb, and shows the bill number as the current crumb while the not-found branch shows literal "Not found".
- **Verified evidence:** page.tsx:16-18 (not-found) and 27-31 (found) hand-roll <nav class=crumbs>; found shows bill.billNo, not-found shows t('notFound'). AppShell.tsx:30 already renders <AutoBreadcrumb/> in TopBar by default, so the page renders two breadcrumbs. 'Not found' is a translated string, not literal.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/[id]/page.tsx`
- **Fix steps:**
  1. Delete both hand-rolled <nav> blocks; rely on AppShell AutoBreadcrumb (add SEGMENT_LABELS/dynamic crumb via AppShell `crumb` prop if bill number is wanted).
- **Acceptance:**
  - Only one breadcrumb is present on the page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme CONTENT (was DATEFMT)

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Detail cards repeat Amount, Status, Vendor and Date, already shown in the StatGrid (page.tsx:48-58).
- **Verified evidence:** page.tsx:46-51 StatGrid shows Amount, Status, Vendor, Date; Details card lines 55-57,61 repeats Vendor (56), Amount (57) and Submitted date (61); status also in the header pill (39). Bill No repeated in title.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/bills/[id]/page.tsx`
- **Fix steps:**
  1. Remove Vendor, Amount from the Details card; keep unique fields (PO, GRN, invoice no, due date, 3-way match, payment ref).
  2. Drop duplicate StatusPill/StatCard status.
- **Acceptance:**
  - Each datum appears once on the page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/expenditure/guarantees  —  `finance/expenditure-guarantees.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/guarantees/page.tsx`
- **Design reference:** `redesign/finance/expenditure-guarantees.html`

### GAP-FINANCE-EXPENDITURE-GUARANTEES-01  ·  HIGH  ·  confirmed  ·  theme STATS (was VALIDATION)

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** "Expiring Soon" is computed as total - active - released (page.tsx:23), i.e. every guarantee that is neither active nor released (expired, invoked, cancelled...). It does not look at any expiry date, so it neither means "expiring" nor is it soon; a lapsed guarantee that should trigger a revalidation counts the same as an invoked one.
- **Verified evidence:** guarantees/page.tsx:23 passes guarantees.length - active - released as the 'Expiring Soon' stat (label key statExpiringSoon, en.json). active/released are matched by status string (l.9-10). No date is examined; expired/invoked/cancelled all inflate it. FinanceGuaranteeSummary shape (@civitasone/types) is absent so whether an expiry/validity field exists is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/guarantees/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. If the summary has a validity/expiry date: compute expiring = status active AND expiry within 30 days (IST) and add a separate 'Lapsed/Expired' stat from status==='expired'.
  2. If no date field: rename the card to 'Other status' or 'Expired / invoked', and request the field from backend.
  3. Update statExpiringSoon copy in en.json/hi.json; extract the counting into a small pure function for unit tests.
- **Acceptance:**
  - Unit: [active exp +10d, active exp +90d, expired, invoked, released] -> expiring 1.
  - Card label matches its definition.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Misleading risk signal on guarantees; a wrong 'expiring' count can cause missed revalidation.
- **Depends on:** GAP-FINANCE-EXPENDITURE-GUARANTEES-02

### GAP-FINANCE-EXPENDITURE-GUARANTEES-02  ·  MEDIUM  ·  partly  ·  theme COLUMNS (was DATEFMT)

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** There is no expiry/validity date column at all (GuaranteesTable.tsx:19-25) on a register whose main risk is lapse; "Fee %" is shown but no beneficiary or linked bill/contract.
- **Verified evidence:** Confirmed: GuaranteesTable.tsx:54-60 has columns entity, type, amountMinor, feePct, status only - no expiry/validity date, beneficiary or linked bill/contract. Whether the API returns those fields is cannot-verify (types package and finance-service absent), so the fix may need backend. Theme is not date-format; it is a missing column.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/guarantees/GuaranteesTable.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Confirm FinanceGuaranteeSummary fields (validUntil/expiryDate, beneficiary, refs); add to backend response if missing.
  2. Add columns with render: formatIndianDate(g.validUntil) and a beneficiary column; add en/hi keys colValidUntil, colBeneficiary.
  3. Highlight rows expiring within 30 days via StatusPill tone or row class.
  4. Add the same fields to the CSV export (exportable) automatically via columns.
- **Acceptance:**
  - Component test: row with validUntil renders '30 Sep 2026' style date.
  - Manual: expiring row is visually flagged.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-EXPENDITURE-GUARANTEES-01

### GAP-FINANCE-EXPENDITURE-GUARANTEES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Failed fetch renders four zero stat cards and an empty table (page.tsx:9-10,20-23); only the badge inside the table reports the failure (GuaranteesTable.tsx).
- **Verified evidence:** guarantees/page.tsx:8-10,20-23: on fetch error loader returns [] so stats read 0/0/0/0; page passes source only to GuaranteesTable (l.30), where DataSourceBadge is the only failure signal (GuaranteesTable.tsx:52). Table may show cached rows while cards show 0.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/guarantees/page.tsx`
- **Fix steps:**
  1. Compute `failed = source==='error' && guarantees.length===0`.
  2. Pass null to the four StatCard values when failed (renders '—').
  3. Render <RefreshErrorState error={toHumanError('load',{area:'guarantees'})} backHref='/finance'/> in place of the table Card when failed (or use LoadErrorState).
  4. Preferably derive stats from the same useSeededResource rows in a client wrapper.
- **Acceptance:**
  - Component test: source 'error' + [] -> '—' stats, Retry visible.
  - Normal data unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** SHARED: finance stats-on-error helper (pass null to StatCard + render LoadErrorState/RefreshErrorState)

### GAP-FINANCE-EXPENDITURE-GUARANTEES-04  ·  LOW  ·  partly  ·  theme MISSING-ACTION (was DEADROUTE)

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Read-only: no create/release/invoke action exists in the route, so guarantees can only be entered elsewhere (not determinable from the route; finance-service absent).
- **Verified evidence:** True that the guarantees route is read-only: page.tsx and GuaranteesTable.tsx contain no create/release/invoke action and no rowHref. Nothing in the web app writes guarantees (grep of finance for guarantee only finds this route, finance/page.tsx card and procurement/emd-bg, which is a separate EMD/BG surface). Whether the backend supports create/release/invoke is cannot-verify. 'DEADROUTE' is the wrong theme - no dead link exists; it is a missing capability/decision.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/guarantees/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/guarantees/GuaranteesTable.tsx`
- **Fix steps:**
  1. Decide ownership: link to /procurement/emd-bg from the header if guarantees are managed there (add a btn ghost Link) and add a subtitle note.
  2. Otherwise scope create/release/invoke actions (ActionButton with requireReason, maker-checker) once backend endpoints are confirmed.
  3. Add rowHref to a guarantee detail only if a detail route is built.
- **Acceptance:**
  - Manual: header offers the correct entry point or actions.
  - No dead links introduced.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Guarantee release/invoke are money-affecting; must be maker-checker with audit event.

### GAP-FINANCE-EXPENDITURE-GUARANTEES-05  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Type and status values print as raw API strings via default cells (GuaranteesTable.tsx:19-25) - no humanizeStatus on Type.
- **Verified evidence:** GuaranteesTable.tsx:56 (type) has no render, so DataTable prints the raw value; status uses cellType:'status' (l.59) which renders StatusPill (DataTable.tsx:127), so status is not raw - the observation is half wrong. StatusPill tone coverage for guarantee statuses (active/released/expired/invoked) not verified; humanizeStatus exists (formatters.ts:44) and is the right helper for Type.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/guarantees/GuaranteesTable.tsx`
- **Fix steps:**
  1. Add render to the type column: (g) => humanizeStatus(String(g.type)) (maps e.g. 'bank_guarantee' -> 'Bank Guarantee'; add acronym entries such as EMD to STATUS_ACRONYM_LABELS if needed).
  2. Check StatusPill.tsx tone map contains guarantee statuses; add any missing (expired, invoked, released).
  3. Add unit test for type humanization.
- **Acceptance:**
  - Unit: type 'bank_guarantee' renders 'Bank Guarantee'; 'emd' renders 'EMD'.
  - Status pills show a tone (not neutral fallback) for all statuses.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /finance/expenditure/scheme-tracking  —  `finance/expenditure-scheme-tracking.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/page.tsx`
- **Design reference:** `redesign/finance/expenditure-scheme-tracking.html`

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-01  ·  HIGH  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** Subtitle promises "milestones, UC status, and progress" but the table has none of them: no milestone, no UC status, no progress column (SchemeTable.tsx:19-26). The detail page states its fake milestone tables were dropped (scheme-tracking/[id]/page.tsx:11-19).
- **Verified evidence:** Subtitle 'Scheme expenditure with milestones, UC status, and progress.' (en.json expenditureSchemeTracking.subtitle; same claim in finance/page.tsx:26 card description) vs SchemeTable.tsx:54-61 columns code, name, funding, outlay, utilised, status - no milestone/UC/progress. Detail page doc comment confirms fabricated milestones were removed. This is copy overpromise, not fabricated data.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/finance/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/SchemeTable.tsx`
- **Fix steps:**
  1. Change subtitle to e.g. 'Scheme outlay and utilisation by funding source.' in en.json and hi.json.
  2. Update finance/page.tsx:26 description likewise.
  3. Add a Utilisation % column (see -05) as the real 'progress'.
- **Acceptance:**
  - Manual: subtitle and landing-card text describe only what the table shows.
  - grep 'milestones' in messages returns no scheme copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-05

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-02  ·  HIGH  ·  confirmed  ·  theme STATS (was OTHER)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** "Pending UC" is total - active - completed (page.tsx:23): any status that is neither (on_hold, cancelled, closed...) is reported as "pending utilization certificate", which the data does not say.
- **Verified evidence:** scheme-tracking/page.tsx:23 statPendingUc = schemes.length - active - completed (status compared lowercase, l.9-10): on_hold/cancelled/closed/draft all count as 'Pending UC'. Nothing in the summary indicates UC state (SchemeTable has no UC column).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Rename the fourth card to 'Other status' (or 'On hold / other') or remove it.
  2. If real pending-UC counts are wanted, source them from getFinanceUCs grouped by scheme (needs schemeId link) - backend.
  3. Extract counting into a tested helper.
- **Acceptance:**
  - Unit: statuses [active, completed, on_hold, cancelled] -> other=2.
  - Label no longer says UC.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Misleading compliance signal; low code risk.
- **Depends on:** GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-03  ·  MEDIUM  ·  partly  ·  theme DEADROUTE

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Every row links to a detail route whose backing GET /v1/finance/schemes/:id "does not exist yet" per the detail page comment (scheme-tracking/[id]/page.tsx:12-16): clicking a row lands on the "Scheme detail not available" empty state.
- **Verified evidence:** SchemeTable.tsx:62-64 uses rowLinkKey='id' rowLinkPrefix='/finance/expenditure/scheme-tracking/' so every row links to the detail route, which shows the 'not available' state per its own comment (source [id]/page.tsx doc comment) - backend GET /v1/finance/schemes/:id absence cannot be verified (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/SchemeTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Preferred: implement list-fallback in getFinanceSchemeById (see DETAIL-01) so links work.
  2. Otherwise remove rowLinkKey/rowLinkPrefix from SchemeTable until backend ships.
  3. Add test that rows do not link when route unavailable.
- **Acceptance:**
  - Manual: clicking a row shows data, or rows are not clickable.
  - No dead-end empty state on happy path.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-01

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Failed fetch shows four zeros and an empty table; only the in-table badge explains (page.tsx:9-10).
- **Verified evidence:** scheme-tracking/page.tsx:8-10,19-23 same pattern: error -> [] -> four zeros; source passed only to SchemeTable (l.30) whose DataSourceBadge is the sole signal.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/page.tsx`
- **Fix steps:**
  1. failed = source==='error' && schemes.length===0.
  2. Pass null to StatCards when failed.
  3. Render <RefreshErrorState error={toHumanError('load',{area:'schemes'})} backHref='/finance'/> instead of the table Card.
- **Acceptance:**
  - Component test: error -> '—' and Retry.
  - Normal path unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** SHARED: finance stats-on-error helper (pass null to StatCard + render LoadErrorState/RefreshErrorState)

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Outlay and Utilised are shown side by side with no percentage, so over-utilisation (Utilised > Outlay) is invisible in the list.
- **Verified evidence:** SchemeTable.tsx:58-59 shows outlayMinor and utilisedMinor as cellType 'amount' columns (l.58-59) with no percentage or over-utilisation marker.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/SchemeTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a 'Utilisation' column with render using the shared percentOfMinor helper (bigint-safe, see DETAIL-02).
  2. Show a warning pill/tone when >100%.
  3. Add en/hi key colUtilisation; include in CSV export.
- **Acceptance:**
  - Component test: outlay 100, utilised 120 -> '120%' with warning.
  - outlay 0 -> '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-02


---
## /finance/expenditure/scheme-tracking/[id]  —  `finance/expenditure-scheme-tracking-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/[id]/page.tsx`
- **Design reference:** `redesign/finance/expenditure-scheme-tracking-detail.html`

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-01  ·  HIGH  ·  partly  ·  theme DEADROUTE (was OTHER)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** The detail route cannot show data today: the backing GET /v1/finance/schemes/:id is missing (page.tsx:12-16), so every row link from Scheme Tracking ends on "Scheme detail not available". The Designed panel is the intended shape, not current behaviour.
- **Verified evidence:** [id]/page.tsx: loader getFinanceSchemeById (loaders.ts:2046) GETs /api/v1/finance/schemes/:id; the file's own doc comment (l.85-96 of the file as printed; ~l.11-19 of the source) states this route does not exist yet, so the page hits `if (!scheme)` empty state (l.101-112). Consistent with the code, but backend absence is cannot-verify (finance-service missing from snapshot) - the claim relies on the comment. 'Designed panel' text is not in the code. Not all rows necessarily fail if the route is later added.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/[id]/page.tsx`, `services/finance-service (backend)`
- **Fix steps:**
  1. Backend: add GET /v1/finance/schemes/:id returning FinanceSchemeSummary (owner: finance-service).
  2. Interim web fix: in getFinanceSchemeById fall back to `getFinanceSchemes()` and find by id when the detail call 404s, so the row link shows the data already on the list.
  3. Until then, make SchemeTable rows non-links (drop rowLinkKey/rowLinkPrefix) - see SCHEME-TRACKING-03.
- **Acceptance:**
  - Manual: clicking a scheme row shows its detail card with outlay/utilised.
  - Unit: loader falls back to list on 404.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only.
- **Depends on:** GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-03

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Utilisation is Number(minor) division (page.tsx:33-35): paise values above 2^53 lose precision and >100% utilisation is shown unflagged.
- **Verified evidence:** [id]/page.tsx (l.114-116 in file): outlay=Number(scheme.outlayMinor), utilised=Number(...), utilisationPct=Math.round(utilised/outlay*100), outlay>0 else 0. Number() loses precision above 2^53 paise (~9e13 rupees, unrealistic but violates the paise/BigInt convention used on bills/page.tsx:18). >100% is displayed as a plain '120%' with no flag; outlay 0 shows 0% even with utilisation. Money display itself uses formatMoney (string-safe).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a formatters.ts helper `percentOfMinor(numerator, denominator): number|null` using BigInt ((n*10000n)/d) returning basis-points-accurate pct, null when d<=0.
  2. Use it in the page; render '—' when null.
  3. When pct>100 render the StatCard value with a 'Over-utilised' warning (StatusPill tone danger or delta text).
  4. Reuse same helper on the list (see SCHEME-TRACKING-05).
- **Acceptance:**
  - Unit: (120n,100n)->120 flagged; (1n,0n)->null; 9007199254740993n exact.
  - Manual: over-utilised scheme shows warning.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.
- **Depends on:** GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-05

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Status StatCard prints the raw status string (scheme.status) while the card below uses StatusPill (page.tsx:49,64): inconsistent and untranslated.
- **Verified evidence:** [id]/page.tsx: Status StatCard value={scheme.status} (l.130) prints the raw string (e.g. 'on_hold'); the Card field uses <StatusPill status={scheme.status}/> (l.143). StatCard accepts only string|number (StatCard.tsx:8).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/[id]/page.tsx`
- **Fix steps:**
  1. Change StatCard value to humanizeStatus(scheme.status) (import from @/lib/formatters).
  2. Verify StatusPill has tones for scheme statuses (active, completed, on_hold, closed, cancelled).
  3. Optionally drop the duplicate status stat.
- **Acceptance:**
  - Unit/snapshot: status 'on_hold' shows 'On Hold' in card and pill.
  - Consistent wording.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-04  ·  LOW  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** A failed fetch and an unknown id are the same empty state; the badge for source=error only appears when a scheme exists (page.tsx:46).
- **Verified evidence:** [id]/page.tsx: loader returns null on error (loaders.ts:2047), and `if(!scheme)` (l.101) returns the same 'not available' EmptyState for error and not-found. The DataSourceBadge branch (l.124) sits after that return, so `source==='error'` there is effectively unreachable (error implies scheme null).
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/[id]/page.tsx`
- **Fix steps:**
  1. Before the !scheme check: if (source==='error') return the page with <RefreshErrorState error={toHumanError('load',{area:'scheme'})} backHref='/finance/expenditure/scheme-tracking'/>.
  2. Keep the EmptyState only for source==='api' && !scheme.
  3. Remove the dead DataSourceBadge actions branch.
- **Acceptance:**
  - Component test: source 'error' -> Retry shown; api+null -> not-available.
  - Manual: offline shows retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** SHARED: finance stats-on-error helper (pass null to StatCard + render LoadErrorState/RefreshErrorState)

### GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05  ·  LOW  ·  partly  ·  theme MISSING-LINK (was DEADROUTE)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Scheme detail has no link to related UCs or fund releases, though the list subtitle promises UC status and progress.
- **Verified evidence:** Confirmed: detail Card (l.133-145) has only the scheme's own fields and no links to UCs or fund releases. The list subtitle (en.json expenditureSchemeTracking.subtitle) does promise 'milestones, UC status, and progress'. UCs carry only a free-text `scheme` field on create (new/page.tsx:173) so a reliable scheme->UC link may need backend (schemeId); cannot verify.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/scheme-tracking/[id]/page.tsx`
- **Fix steps:**
  1. Add a 'Related UCs' link: /finance/expenditure/utilization-certificates?scheme=<code> and make UCsTable honour that filter (initial filter text).
  2. Fund releases: link only if a releases route exists (budget/releases) - verify before adding.
  3. Or fix the subtitle to stop promising it (SCHEME-TRACKING-01).
- **Acceptance:**
  - Manual: link opens UC list filtered to the scheme.
  - No link shown to non-existent routes.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03


---
## /finance/expenditure/utilization-certificates  —  `finance/expenditure-utilization-certificates.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/page.tsx`
- **Design reference:** `redesign/finance/expenditure-utilization-certificates.html`

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-01  ·  HIGH  ·  confirmed  ·  theme STATUS (was CONFIRM)

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** "Pending Submission" lumps status "rejected" with "pending" (page.tsx:12, UCsTable.tsx:16): a UC returned by the verifier is counted and tabbed as not yet submitted, and the table offers no reason or resubmit path.
- **Verified evidence:** utilization-certificates/page.tsx:12 counts pending = status pending OR rejected as 'Pending Submission'; UCsTable.tsx:67 maps the 'Pending' tab to ['pending','rejected']. Rows have no rowHref/actions (DataTable at l.110-125), so a rejected UC shows no reason or resubmit path. The rejection reason field's existence is cannot-verify. Theme should be STATUS, not CONFIRM.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/UCsTable.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Split: pending = 'pending'; add a separate 'Returned / Rejected' StatCard and tab (TAB_STATUS_MAP index).
  2. Keep tabs position-based (per UX-017 comment) and add tabRejected key in en/hi.
  3. Add row actions: for rejected show reason (if API provides rejectionReason) and a Resubmit ActionButton (requireReason) once endpoint confirmed.
  4. Update statPendingSubmission copy accordingly.
- **Acceptance:**
  - Unit: [pending, rejected, submitted] -> pending 1, rejected 1.
  - Rejected tab lists only rejected rows.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; resubmit action needs maker-checker/audit on backend.

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** Failed fetch gives Total 0 / 0 / 0 / ₹0.00 (page.tsx:11-14) - a grant-monitoring officer would read that as no UCs outstanding; only the in-table badge reports the failure.
- **Verified evidence:** page.tsx:9-16: on error ucs=[] so counts 0 and formatMoney(0n) = ₹0.00 are rendered (l.34-37); `source` is only passed to UCsTable (l.45). Table may fall back to cached rows while cards say 0.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/page.tsx`
- **Fix steps:**
  1. failed = source==='error' && ucs.length===0.
  2. Pass null to all four StatCards (renders '—').
  3. Render <RefreshErrorState error={toHumanError('load',{area:'utilization certificates'})} backHref='/finance'/> in place of the Card.
  4. Preferred long-term: compute stats from useSeededResource rows in client wrapper.
- **Acceptance:**
  - Component test: error -> '—' x4 and Retry, no '₹0.00'.
  - Happy path unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** SHARED: finance stats-on-error helper (pass null to StatCard + render LoadErrorState/RefreshErrorState)

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-03  ·  MEDIUM  ·  confirmed  ·  theme STATS (was OTHER)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** "Covered Amount" sums every UC regardless of status (page.tsx:14), so pending and rejected UCs inflate "covered".
- **Verified evidence:** page.tsx:16 totalAmount = BigInt sum over ALL ucs regardless of status; shown as 'Covered Amount' (l.37). Pending and rejected UCs are included.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Sum only status in ('submitted','verified') (reuse the predicate from l.11) for 'Covered Amount', or verified only if the definition requires acceptance - confirm with finance owner.
  2. Optionally add sub-line for pending amount.
  3. Update label if definition changes.
- **Acceptance:**
  - Unit: [verified 100, pending 50, rejected 25] -> covered 100 (or 100 with submitted incl.).
  - BigInt math preserved.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Reported figure for grant monitoring; definition must be agreed.

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** The list has Grantee, Grant Ref and Period but the create form collects none of them (new/page.tsx:15,44-52): only ucNo, scheme, amount and purpose are sent, so new UCs show blank Grantee/Period.
- **Verified evidence:** Duplicate in substance of NEW-02. new/page.tsx:153 form state {ucNo,purpose,scheme,amount}; body at l.173 sends ucNo, purpose, scheme, amountMinor, currency only. UCsTable.tsx:112-115 shows grantee, grantRef, period.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/new/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/UCsTable.tsx`
- **Fix steps:**
  1. Implement together with NEW-02 (add grantee, grantRef, periodFrom, periodTo).
  2. Guard period rendering when dates absent.
  3. Do not fix twice; close one finding.
- **Acceptance:**
  - See NEW-02.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** See NEW-02.
- **Depends on:** GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-02

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-05  ·  LOW  ·  partly  ·  theme CONTENT (was VALIDATION)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** The code comment records that a "Download Format" duplicate button was removed because no UC template exists (page.tsx:21-24) - the register still has no template for grantees.
- **Verified evidence:** page.tsx:25-27 comment says the duplicate 'Download Format' button was removed because no UC template exists; header now only has '+ New UC' (l.28). This is a code comment describing a removal, not a defect; a missing template is a content/product gap. Theme is not VALIDATION.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/page.tsx`, `apps/web/public (template file, new)`
- **Fix steps:**
  1. Decision: supply an official UC format (GFR 12-A) PDF/DOCX under apps/web/public/templates or object storage.
  2. If supplied, restore a secondary 'Download Format' <a download> button in the header with correct href.
  3. Otherwise no action.
- **Acceptance:**
  - Manual: button downloads the template file (if added).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** None; content must come from the finance department.


---
## /finance/expenditure/utilization-certificates/new  —  `finance/expenditure-utilization-certificates-new.html`

- **Source:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/new/page.tsx`
- **Design reference:** `redesign/finance/expenditure-utilization-certificates-new.html`

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** A UC - a statutory certificate that grant money was spent as sanctioned - is submitted with no confirmation dialog, no declaration or attestation, no signing authority and no reason capture (page.tsx:41-46). Submission is immediate; nothing in the request identifies who certifies.
- **Verified evidence:** new/page.tsx submit() (l.159-189 in file) POSTs directly on form submit: no ConfirmDialog, no declaration/attestation checkbox, no reason field. Confirmed for the UI. Who certifies is cannot-verify: the auth identity is attached by the /api/proxy gateway/JWT, and backend audit/maker-checker (finance-service) is absent - nothing in the payload names the certifier, but the server may derive it. Compare BillCreateAction which uses ActionButton+ConfirmDialog with reason.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/new/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add a required declaration checkbox ('I certify that the grant was utilised for the sanctioned purpose') to the form and disable submit until ticked.
  2. On submit open ConfirmDialog (ds/ConfirmDialog) with title/description; only then run the existing fetch in submit() (use useConfirmAction from ds/ActionButton).
  3. Send declaration:true (and certifier designation field if backend adds one) in the body; confirm contract with backend.
  4. Backend: emit audit event (actor, ucNo, amount) and enforce maker!=checker on verification.
- **Acceptance:**
  - Component test: submit without ticking declaration makes no fetch; with tick shows dialog then POSTs once.
  - Manual: audit log shows actor for UC creation.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Statutory certificate; changing payload requires backend contract agreement.

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** The list requires Grantee, Grant Ref and Period (UCsTable.tsx:59-65) but the form sends only ucNo, purpose, scheme, amountMinor (page.tsx:46): new UCs will show blank grantee, grant ref and period, and nothing ties the amount to the sanctioned grant.
- **Verified evidence:** new/page.tsx:173 body = {ucNo, purpose, scheme (optional), amountMinor, currency:'INR'}; form state l.153 has only ucNo/purpose/scheme/amount. UCsTable.tsx:112-115 reads grantee, grantRef (falls to '—'), and builds period `${periodFrom} – ${periodTo}` (l.89), which would print 'undefined – undefined' if absent. Backend createUCBody (absent) may require/derive them - cannot verify; nothing links amount to a sanctioned grant in the UI.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/new/page.tsx`, `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/UCsTable.tsx`
- **Fix steps:**
  1. Add form fields: grantee, grant ref (picker over sanction/grant records if a loader exists), periodFrom, periodTo (date inputs, ISO date strings); include in POST.
  2. Client-validate periodFrom<=periodTo and amount>0; show fieldError for each.
  3. In UCsTable guard period: render '—' when either date missing.
  4. Backend: validate amount <= sanctioned grant balance and reject over-claim.
- **Acceptance:**
  - Unit: period from > to shows error and no POST.
  - Manual: new UC shows grantee, grant ref, period in list; missing period shows '—' not 'undefined – undefined'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money-linked statutory record; contract must match createUCBody.
- **Depends on:** GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-04

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was OTHER)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** "Scheme / grant" is an optional free-text input (page.tsx:79-81), not a picker over Scheme Tracking records, so UCs cannot be reliably linked to a scheme for the Pending UC count.
- **Verified evidence:** Confirmed: new/page.tsx:213-214 is an optional plain <input id='uc-scheme'> (no `required`, sent as scheme||undefined at l.173). Partly wrong: the Pending UC stat on scheme-tracking is computed from scheme status (scheme-tracking/page.tsx:23), not from UCs, so free text does not affect that count. A picker over getFinanceSchemes (loaders.ts:2037) is feasible; whether backend expects scheme id vs name/code is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Load schemes in a server wrapper (getFinanceSchemes) and pass to the client form as options.
  2. Replace input with <EntityPicker>/select of schemes (name + code), store scheme id/code as the API expects; make it required.
  3. Confirm with backend whether field is `scheme` (string) or a new `schemeId`.
- **Acceptance:**
  - Manual: choosing a scheme sends its code/id; free text impossible.
  - Empty selection blocked.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-04  ·  LOW  ·  partly  ·  theme MISSING-FEATURE (was OTHER)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** No attachment upload for the signed UC or supporting statements, though the register status flow is pending > submitted > verified.
- **Verified evidence:** Confirmed: form (new/page.tsx:203-237) has no file input. However the status flow pending>submitted>verified is only inferred from UCsTable TAB_STATUS_MAP; no submit/verify UI exists at all in the web app for this route. Object-storage/attachment endpoint for finance is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/new/page.tsx`
- **Fix steps:**
  1. Confirm an attachment endpoint exists (S3/MinIO adapter via gateway); if so add <input type=file accept='application/pdf'> with size cap and upload before/with POST, storing attachment ids.
  2. Show the attachment on the UC row/detail.
  3. If no endpoint, raise as backend ticket and keep this as a decision.
- **Acceptance:**
  - Manual: attach PDF, submit, attachment listed.
  - Files >limit rejected client-side.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/document handling; malware scan and size limits at backend.


---
## /finance/expenses  —  `finance/expenses.html`

- **Source:** `apps/web/src/app/(app)/finance/expenses/page.tsx`
- **Design reference:** `redesign/finance/expenses.html`

### GAP-FINANCE-EXPENSES-01  ·  MEDIUM  ·  defect  ·  theme BACKEND

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** The redirect target /hr/expenses is behind the HR role gate while this route sits behind the finance gate (layout.tsx:29-34): a finance-only role that follows the redirect reaches the HR layout guard and may get "Access restricted" - two different gates on one hop; HR role lists are undeterminable from this route.
- **Service:** `hrms-service`  ·  **Endpoint(s):** `['redirect /finance/expenses -> /hr/expenses']`
- **Question:** 
- **How to verify:** 
- **Test to add:** Layout test: role finance_officer requesting /hr/expenses is not shown Access restricted.
- **Impact if wrong:** Finance roles land on a permission wall.
- **Web change if wrong:** 
- **Finding:** finance/expenses/page.tsx:10 redirects to /hr/expenses. hr/layout.tsx:32-42 HR_ROLES excludes finance_officer, finance_admin, audit_officer, budget_officer, procurement_officer, accounts_officer, while finance/layout.tsx allows them (workRoles.ts:32-43). hrms claims/routes.ts:32 lists finance_officer and payroll_admin but the web HR_ROLES omits finance_officer, so the layout blocks it before the API is reached.

### GAP-FINANCE-EXPENSES-02  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Finance sidebar and home do not need this route: it exists only for bookmarks, so it can be deleted once analytics show no hits (page.tsx:3-8).
- **Verified evidence:** Confirmed as a fact, but it is a housekeeping suggestion, not a defect. apps/web/src/app/(app)/finance/expenses/page.tsx:3-8 is a comment plus `redirect("/hr/expenses")` (line 10). No sidebar, hub tile or navRouteManifest entry references /finance/expenses (grep of apps/web/src finds only the file itself). But nothing records hits on the redirect (bare server redirect, no telemetry), so 'delete once analytics show no hits' cannot be acted on today. The folder also still holds orphaned components (ExpenseClaimForm.tsx, ExpenseClaimRow.tsx) that nothing imports.
- **Files to change:** `apps/web/src/app/(app)/finance/expenses/page.tsx`, `apps/web/src/app/(app)/finance/expenses/ExpenseClaimForm.tsx`
- **Fix steps:**
  1. Decide: keep redirects for bookmarks (current comment intent) or remove.
  2. If removing: add a permanent redirect for /finance/expenses -> /hr/expenses in next.config redirects() (file not in snapshot) or middleware, so old bookmarks still resolve without a page file.
  3. Delete page.tsx and the orphaned components listed (ExpenseClaimForm.tsx, ExpenseClaimRow.tsx) in the same PR; grep confirms no importers.
  4. If keeping: add a telemetry event (existing emitError/telemetry helper in apps/web/src/app/_data/apiClient.ts pattern) or rely on gateway access logs so hits are measurable.
- **Acceptance:**
  - Visiting /finance/expenses still lands on /hr/expenses after the change.
  - `grep -r ExpenseClaimForm apps/web/src` returns nothing after deletion.
  - pnpm typecheck passes.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Only risk is breaking old bookmarks/emails; mitigated by keeping a config-level redirect.
- **Depends on:** GAP-FINANCE-LOANS-02, GAP-FINANCE-MEDICAL-02, GAP-FINANCE-HOME-03


---
## /finance/fiscal-years  —  `finance/fiscal-years.html`

- **Source:** `apps/web/src/app/(app)/finance/fiscal-years/page.tsx`
- **Design reference:** `redesign/finance/fiscal-years.html`

### GAP-FINANCE-FISCAL-YEARS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Creating a fiscal year makes it the active one immediately: the dialog says so ("The server marks newly created fiscal years active immediately", FiscalYearForm.tsx:172-176). Entering next year's FY early therefore switches the whole tenant's posting year and closes the current one, a consequence buried in dialog prose with no reason field, no two-person approval and no check for gaps or overlaps with existing years.
- **Verified evidence:** Dialog copy is at FiscalYearForm.tsx:196-201 (not 172-176): 'The server marks newly created fiscal years active immediately'. The confirm dialog (190-205) has no requireReason and no danger flag; POST body (73-80) is only code/label/startDate/endDate, so no reason reaches the server. validate() (45-59) checks code regex, non-empty label, dates present and end>start only; the form receives no existing rows (page.tsx:64 renders <FiscalYearForm /> with no props), so overlap/gap checks are impossible client-side. Whether the server really auto-activates and closes the prior year is cannot-verify (finance-service is not in the snapshot); the UI copy asserts it and FiscalYearsTable.tsx:118-120 says the previous active year is 'closed'.
- **Files to change:** `apps/web/src/app/(app)/finance/fiscal-years/FiscalYearForm.tsx`, `apps/web/src/app/(app)/finance/fiscal-years/page.tsx`, `apps/web/src/lib/fiscalYear.ts`, `finance-service POST /api/v1/finance/fiscal-years (not in snapshot)`
- **Fix steps:**
  1. Decision first: prefer that POST creates the year as draft/inactive and only the existing Activate action switches the posting year (backend change). If the server must keep auto-activate, do steps 2-5 as compensating controls.
  2. Pass `rows` from page.tsx to <FiscalYearForm rows={fiscalYears} />; add findFiscalYearConflicts(newYear, rows) to lib/fiscalYear.ts (returns overlap with an existing range, or a gap > 0 days after the latest year) and surface as field errors in validate().
  3. On the ConfirmDialog set danger, requireReason, reasonLabel='Reason for creating and activating this year', minReasonLength=10; rewrite description to name the currently active year (from rows) that will be closed.
  4. Send `reason` in the POST body (backend must accept it and record it in the audit event per CLAUDE.md rule 8); the dialog already passes reason to onConfirm(reason?).
  5. Backend/decision: enforce maker!=checker for activation and emit a fiscal_year.created audit event.
- **Acceptance:**
  - Component test: submitting a year that overlaps an existing row shows a field error and the dialog does not open.
  - Component test: Confirm stays disabled until a reason of >=10 chars is typed; POST body contains `reason`.
  - Manual: create next FY early -> dialog names the currently active year and states it will be closed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: changes which fiscal year all postings land in; an unintended activation misposts vouchers. Changing server default to draft needs migration of any client relying on auto-activate.
- **Depends on:** GAP-FINANCE-FISCAL-YEARS-02, GAP-FINANCE-FISCAL-YEARS-05

### GAP-FINANCE-FISCAL-YEARS-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Activating a year "will be closed" the current one (FiscalYearsTable.tsx:124-128) with no verification that period close, opening balances or pending bills are done (see /finance/period-close); the confirm dialog carries no reason capture although this changes which year every posting lands in.
- **Verified evidence:** Activate dialog is FiscalYearsTable.tsx:110-124 (description at 116-121, not 124-128): 'The currently active fiscal year, if any, will be closed. This changes which year new postings apply to.' It has no requireReason and no preconditions: activate() (33-48) just PATCHes v1/finance/fiscal-years/{code}/activate with no body. The table has no knowledge of period status, opening balances or pending bills; /finance/period-close exists (finance/period-close/page.tsx, GET /api/v1/finance/periods) but is not consulted. Server-side guards are cannot-verify (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/fiscal-years/FiscalYearsTable.tsx`, `apps/web/src/app/(app)/finance/fiscal-years/page.tsx`, `finance-service PATCH .../activate (not in snapshot)`
- **Fix steps:**
  1. Add danger + requireReason (minReasonLength 10) to the Activate <ConfirmDialog>; send {reason} as JSON body on the PATCH (backend must accept and audit it).
  2. In page.tsx also fetch /api/v1/finance/periods (same mapPeriods as period-close/page.tsx; extract it to a shared loader) and pass to the table; in the dialog list any open/soft_close periods of the outgoing year as a blocking or warning line with a link to /finance/period-close.
  3. Add a link to /finance/opening-balances in the dialog and show the count of open periods.
  4. Backend: reject activation when the outgoing year has open periods or the target lacks opening balances (return a typed error surfaced via dialog errorMessage); require a second approver (maker!=checker) and emit audit event.
- **Acceptance:**
  - Component test: Confirm disabled until reason entered; PATCH body includes reason.
  - Component test: with an open period in the outgoing year the dialog shows the warning and link.
  - Backend integration test: activation with open periods returns 409.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: wrong activation redirects every posting; blocking rules must not lock out a legitimate year-end rollover, so agree the rule set with finance owners.
- **Depends on:** GAP-FINANCE-FISCAL-YEARS-01

### GAP-FINANCE-FISCAL-YEARS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Failed load falls through to Total 0, Active "—" and the empty state "Create the first fiscal year using the form above" (page.tsx:64-67; FiscalYearsTable.tsx): a user may create a duplicate year while the badge is the only warning.
- **Verified evidence:** page.tsx:47 destructures data/source; fetchJson falls back to [] on error (line 40). Stats render `fiscalYears.length` (line 60 -> 0) and activeYear?.code ?? '—' (61) regardless of source; the only error signal is DataSourceBadge in PageHeader actions (56). FiscalYearsTable.tsx:105-107 then shows 'No fiscal years yet / Create the first fiscal year using the form above', and the create form is fully enabled (64). Whether the server rejects a duplicate code is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/fiscal-years/page.tsx`, `apps/web/src/app/(app)/finance/fiscal-years/FiscalYearsTable.tsx`
- **Fix steps:**
  1. In page.tsx, when source==='error' render <RefreshErrorState error={toHumanError(...)} backHref='/finance' /> (pattern already used in finance/config/page.tsx) in place of the StatGrid and table.
  2. Show '—' (not 0) for Total Fiscal Years when source==='error'.
  3. Do not render <FiscalYearForm /> in the error state (or pass disabled) so a duplicate cannot be created blind.
  4. Add a client-side duplicate-code check against rows when loaded (see FISCAL-YEARS-01 findFiscalYearConflicts).
- **Acceptance:**
  - Test: mock fetchJson source:'error' -> page renders retry error state, no 'Create the first fiscal year' text, form absent.
  - Manual: kill gateway, reload -> Total shows '—' and Retry refreshes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Ensure genuine empty tenant (source 'api', 0 rows) still shows the create prompt.
- **Depends on:** GAP-FINANCE-FISCAL-YEARS-01

### GAP-FINANCE-FISCAL-YEARS-04  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** loading.tsx is a single empty .skeleton div (fiscal-years/loading.tsx), unlike sibling routes with header and card skeletons; the transition is a blank flash.
- **Verified evidence:** fiscal-years/loading.tsx is a single `<div class="skeleton" role="status">` inside page-main wrap; the same one-block file is used by gst/loading.tsx. Siblings such as journal-entry/loading.tsx have header + form-card skeletons, and finance/loading.tsx has header, stat-cards and table skeletons. error.tsx exists (RouteError) so the 'retry + back link' part of the suggested fix is already in place. Ds exports SkeletonCard/SkeletonTable/SkeletonBar (ds/index.ts:42).
- **Files to change:** `apps/web/src/app/(app)/finance/fiscal-years/loading.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx to mirror page.tsx: header bar, two-card StatGrid skeleton (<SkeletonCard/> x2), form card block, then <SkeletonTable/>.
  2. Keep role=status aria-live and aria-label on the root.
  3. Reuse the same layout wrapper (page-main wrap) so no layout shift.
- **Acceptance:**
  - Manual: throttle network, navigate to /finance/fiscal-years -> header, stat and table placeholders appear.
  - axe: loading root exposes role=status with a label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-FISCAL-YEARS-05  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Code format is validated only as ^\d{4}-\d{2}$ and label/dates are free (FiscalYearForm.tsx:27,38): "2026-99" passes, and Indian FY convention (1 Apr - 31 Mar) is not enforced or prefilled.
- **Verified evidence:** CODE_PATTERN = /^\d{4}-\d{2}$/ at FiscalYearForm.tsx:8, tested at line 47; '2026-99' passes. Label only needs to be non-empty (48). Dates only need end>start (51). No prefill and no Apr 1 - Mar 31 rule, although lib/fiscalYear.ts already has fiscalYearLabel(startYear) (line 29) yielding the correct suffix. Validation is hand-rolled, not zod. Submit is already disabled while busy (177).
- **Files to change:** `apps/web/src/app/(app)/finance/fiscal-years/FiscalYearForm.tsx`, `apps/web/src/lib/fiscalYear.ts`, `apps/web/src/lib/__tests__ (new fiscalYear tests)`
- **Fix steps:**
  1. Add a zod schema (fiscalYearSchema) in lib/fiscalYear.ts: code regex plus refine that the two-digit suffix === (startYear+1)%100; startDate/endDate ISO; endDate > startDate.
  2. Add a startYear <select> (or number input) that auto-fills code via fiscalYearLabel(), label 'FY 2026-27', startDate `${y}-04-01`, endDate `${y+1}-03-31`; keep dates editable only behind an 'Non-standard year' toggle.
  3. Replace validate() with schema.safeParse and map issues to FieldErrors.
  4. Decision: confirm whether any tenant edition (PSU/Small Office) may use a calendar-year FY; if so gate the toggle by entitlement rather than hard-rejecting.
- **Acceptance:**
  - Unit: '2026-99' and '2026-28' rejected, '2026-27' accepted.
  - Unit: 2026-27 with start 2026-04-01/end 2027-03-31 passes; 2026-27 with end before start fails.
  - Manual: choosing start year 2026 prefills all four fields.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low-medium: over-strict rules could block a legitimate short first year; hence the override toggle.
- **Depends on:** GAP-FINANCE-FISCAL-YEARS-01

### GAP-FINANCE-FISCAL-YEARS-06  ·  LOW  ·  confirmed  ·  theme DATEFMT (was CONFIRM)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Confirm dialog prints startDate/endDate as raw ISO strings while the table shows formatIndianDate (FiscalYearForm.tsx:175 vs FiscalYearsTable.tsx:57).
- **Verified evidence:** FiscalYearForm.tsx:198-199 prints `{startDate} to {endDate}` straight from the date inputs (yyyy-mm-dd), while FiscalYearsTable.tsx:52-53 formats the same fields with formatIndianDate (imported line 7). Form file does not import formatIndianDate.
- **Files to change:** `apps/web/src/app/(app)/finance/fiscal-years/FiscalYearForm.tsx`
- **Fix steps:**
  1. Import formatIndianDate from '@/lib/formatters' in FiscalYearForm.tsx.
  2. Render <strong>{formatIndianDate(startDate)}</strong> to <strong>{formatIndianDate(endDate)}</strong> in the ConfirmDialog description.
- **Acceptance:**
  - Component test: dialog for 2026-04-01..2027-03-31 shows Indian-format dates, not ISO.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/gst  —  `finance/gst.html`

- **Source:** `apps/web/src/app/(app)/finance/gst/page.tsx`
- **Design reference:** `redesign/finance/gst.html`

### GAP-FINANCE-GST-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was NAVUX)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** A failed ledger, summary or ITC fetch is shown as "No GST ledger entries / No GST summary / No ITC reconciliation for this period" (GstConsole.tsx empty states; page.tsx:47-51 falls back to []), plus one badge above the period box. A filing officer scrolling to the tab reads a nil return.
- **Verified evidence:** getSummary/getLedger/getItcReconciliation each fall back to [] (page.tsx:13-35). page.tsx:46 collapses the three sources into one flag, shown only as <DataSourceBadge> at line 64. Stats then show formatMoney(0) = ₹0.00 (69-75), and GstConsole.tsx empty states (26-30 'No GST summary', 49-53 'No GST ledger entries', 80-84 'No ITC reconciliation') render for failed loads. The component gets no source info so it cannot distinguish error from empty. The line 47-51 cited is really 46-55.
- **Files to change:** `apps/web/src/app/(app)/finance/gst/page.tsx`, `apps/web/src/app/(app)/finance/gst/GstConsole.tsx`, `apps/web/src/app/(app)/finance/gst/types.ts`
- **Fix steps:**
  1. Keep per-source flags in page.tsx (summarySource, ledgerSource, itcSource) and pass `errors={{summary,ledger,itc}}` booleans to <GstConsole>.
  2. In GstConsole render <RefreshErrorState> (ds) inside the affected tab instead of EmptyState when its flag is set; mark the tab label with a warning cue.
  3. In page.tsx show '—' instead of formatMoney(0) for the stat cards whose source failed; suppress the Net GST Payable tick/warning icon on error.
  4. Keep the top badge but add an explicit 'Data incomplete - do not file' banner text.
- **Acceptance:**
  - Component test: itc source error -> ITC tab shows retry error state, not 'No ITC reconciliation'.
  - Test: summary error -> Output Tax and ITC cards show '—'.
  - Manual: genuine empty period (api ok, []) still shows the empty states.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium: a filing officer could read a nil return; fix removes that misread. No data risk.

### GAP-FINANCE-GST-02  ·  HIGH  ·  confirmed  ·  theme MONEY (was OTHER)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** "Net GST Payable" is the sum of every head's net_payable (page.tsx:57), so a negative CGST balance offsets a positive SGST/IGST balance in the headline; under GST credit utilisation rules that cross-head netting is not valid. The icon flips to a warning at >= 0 and only turns to a tick when strictly negative (page.tsx:73).
- **Verified evidence:** netPayable = itc.reduce(sum Number(r.net_payable)) at page.tsx:54 (obs said 57), across all gst_type rows (CGST/SGST/IGST/cess). Icon/colour flip at page.tsx:72-73: `netPayable >= 0` warning, tick only when strictly negative, so an exactly zero liability shows the warning. Whether backend per-head net_payable is already floored at zero or carries negative balances is cannot-verify (finance-service absent); if negative it is a credit carry-forward and cross-head netting in the headline is wrong (IGST credit can offset CGST/SGST only in the prescribed order; CGST credit cannot offset SGST).
- **Files to change:** `apps/web/src/app/(app)/finance/gst/page.tsx`, `apps/web/src/app/(app)/finance/gst/GstConsole.tsx`
- **Fix steps:**
  1. Decision with tax owner: define headline as sum of positive per-head payables plus a separate 'Credit carried forward' figure, or show per-head payable in the card.
  2. Compute payable = sum over rows of max(net_payable,0) and carry = sum of max(-net_payable,0), using BigInt (see GST-04); render both cards.
  3. Fix icon logic: zero -> neutral/tick, >0 -> warning; add non-colour text ('Payable' / 'Nil' / 'Credit').
  4. Backend: confirm net_payable semantics and expose head-wise payable after statutory utilisation order.
- **Acceptance:**
  - Unit: rows CGST -500, SGST +300 -> payable ₹3.00 and carry-forward ₹5.00 (not -₹2.00).
  - Unit: all-zero rows -> 'Nil', not warning.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** High for statutory correctness: a wrong headline payable can drive a wrong GSTR-3B payment.
- **Depends on:** GAP-FINANCE-GST-04

### GAP-FINANCE-GST-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY (was NAVUX)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** "ITC Available (Input Tax)" is the sum of tax on input rows from /summary (page.tsx:56), while the ITC Reconciliation tab has its own itc_available figures: two sources for one label, which can disagree.
- **Verified evidence:** The 'ITC Available (Input Tax)' card is inputTax = sum of total_tax on summary rows with direction 'input' (page.tsx:51-53; obs said 56), rendered at line 70. The ITC Reconciliation tab shows a separate itc_available column from /gst/itc-reconciliation (GstConsole.tsx:89), never summed on the card. Same label, two endpoints. Whether the numbers ever differ (e.g. ineligible/blocked credit, reversals) is cannot-verify without the backend.
- **Files to change:** `apps/web/src/app/(app)/finance/gst/page.tsx`, `apps/web/src/app/(app)/finance/gst/GstConsole.tsx`
- **Fix steps:**
  1. Source the card from the reconciliation response (sum of itc_available) since that is the reconciled figure, and relabel to 'Input tax credit available'.
  2. Rename summary-derived figure 'Input tax paid (all input invoices)' if kept.
  3. Add a visible mismatch check: if the two totals differ show a warning pill linking to the ITC tab.
  4. Backend: document that summary input tax and itc_available differ (eligibility) or unify them.
- **Acceptance:**
  - Unit: card equals sum(itc_available).
  - Unit: differing totals produce the mismatch pill.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: two different ITC numbers on one page undermines trust in filing figures.
- **Depends on:** GAP-FINANCE-GST-04

### GAP-FINANCE-GST-04  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Stats accumulate with Number() (page.tsx:53-59) on minor-unit strings, unlike Advances/Bills which use BigInt; large department totals in paise above 2^53 would lose precision.
- **Verified evidence:** Confirmed that totals use Number(): page.tsx:48-55 reduce with Number(r.total_tax ?? 0), Number(r.net_payable ?? 0), then formatMoney(number) which Math.round()s into BigInt (formatters.ts:90-100). Advances page does use BigInt (advances/page.tsx:17). But the overflow claim is overstated: Number is exact up to 2^53 paise (about ₹9.0e13, ninety lakh crore) so a monthly GST total cannot realistically hit it. Real defect is the pattern (violates the paise-as-bigint convention) and that an unparseable value silently becomes 0 via Number(). Caution for the fix: BigInt('12.5') throws, so numeric strings with decimals from the API need a guard.
- **Files to change:** `apps/web/src/app/(app)/finance/gst/page.tsx`, `apps/web/src/lib/formatters.ts (add sumMinor helper)`
- **Fix steps:**
  1. Add sumMinor(values: Array<string|number|null|undefined>): bigint | null to lib/formatters.ts using /^-?\d+$/ then BigInt; return null (renders '—') when any value is not an integer string.
  2. Replace the three Number reduces in page.tsx with sumMinor(...) and pass bigint to formatMoney.
  3. Keep transaction_count as Number (it is a count, not money).
- **Acceptance:**
  - Unit: sumMinor(['9007199254740993','1']) === 9007199254740994n.
  - Unit: sumMinor(['abc']) -> null, card shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Confirm API returns integer minor units (types.ts allows string|number).
- **Depends on:** GAP-FINANCE-GST-02

### GAP-FINANCE-GST-05  ·  MEDIUM  ·  partly  ·  theme OTHER (was PII)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Ledger table has 11 columns, including Party GSTIN and HSN, with no column chooser, no export and no link to the source invoice (invoice_id is fetched but not linked).
- **Verified evidence:** Table columns GstConsole.tsx:57-67 are exactly 11 (Invoice No., Date, GSTIN, Party, Direction, GST Type, HSN, Rate, Taxable, Tax, Status). Confirmed: no column chooser, no export, and invoice_id (types.ts:96) is fetched but unused. The PII framing is weak: GSTIN/HSN are business identifiers, largely public, so masking is not the right fix; there is also no finance invoice-detail route in this snapshot to link to (finance folder has bills under expenditure/bills only), and the console page has no export control (TDS returns has CSV export per hub copy).
- **Files to change:** `apps/web/src/app/(app)/finance/gst/GstConsole.tsx`, `apps/web/src/app/(app)/finance/gst/types.ts`, `apps/web/src/app/_components/ds (DataTable column props)`
- **Fix steps:**
  1. Decision: agree the link target for invoice_id (likely /finance/expenditure/bills/{id} for input, an AR invoice route for output) before wiring.
  2. Render invoice_no as <Link> when a target exists.
  3. Hide low-priority columns (HSN, Rate, Status) behind a DataTable column chooser if ds DataTable supports it, else default to 7 columns.
  4. Add a CSV export of the ledger via existing export pattern (see statutory/tds-returns) that emits an audit event server-side.
- **Acceptance:**
  - Manual: invoice number opens the source document.
  - Export downloads current period rows and creates an audit record.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low. Export of GSTIN lists should be role-gated and logged.

### GAP-FINANCE-GST-06  ·  LOW  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** The Period field is a native month input, which several desktop browsers render as free text; the YYYY-MM regex then rejects valid-looking input with only "Choose a period" as guidance.
- **Verified evidence:** PeriodSelector.tsx:153-163 uses <input type="month">; Firefox/Safari desktop fall back to a text box, and handleSubmit tests /^\d{4}-\d{2}$/ (136). Error copy is 'Choose a period (YYYY-MM) to view.' (137), so the format hint is present, contrary to 'only Choose a period'. Also the page silently ignores an invalid ?period= and shows current month (page.tsx:38) with no notice.
- **Files to change:** `apps/web/src/app/(app)/finance/gst/PeriodSelector.tsx`, `apps/web/src/app/(app)/finance/gst/page.tsx`
- **Fix steps:**
  1. Add placeholder='YYYY-MM' and pattern='\d{4}-\d{2}' to the input, and describe format in helper text (aria-describedby).
  2. Validate with month 01-12 (regex ^\d{4}-(0[1-9]|1[0-2])$) in both PeriodSelector and page.tsx.
  3. In page.tsx, when ?period is present but invalid, show an inline notice 'Invalid period, showing <current>'.
  4. Optionally replace with year+month selects using recentFinancialYears() from lib/fiscalYear.ts.
- **Acceptance:**
  - Unit: '2026-13' rejected with helpful message.
  - Manual (Firefox): typing '2026-07' loads that period.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-GST-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** loading.tsx is one empty .skeleton block for a three-fetch, table-heavy page (gst/loading.tsx).
- **Verified evidence:** gst/loading.tsx is one `<div className="skeleton" role="status">` (identical to fiscal-years/loading.tsx). The page awaits three fetches then renders header, period card, four stat cards and a tabbed table (page.tsx:57-83).
- **Files to change:** `apps/web/src/app/(app)/finance/gst/loading.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx with header skeleton, period-selector card, four <SkeletonCard/> in StatGrid layout, and <SkeletonTable/> inside a Card.
  2. Keep role=status aria-live aria-label='Loading GST console'.
- **Acceptance:**
  - Manual: throttle network, skeleton mirrors final layout without shift.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-FISCAL-YEARS-04


---
## /finance/journal-entry  —  `finance/journal-entry.html`

- **Source:** `apps/web/src/app/(app)/finance/journal-entry/page.tsx`
- **Design reference:** `redesign/finance/journal-entry.html`

### GAP-FINANCE-JOURNAL-ENTRY-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** When the chart of accounts fails to load or is empty, every line silently becomes a free-text "Account code" input (JournalEntryForm.tsx ~ accounts.length > 0 ? select : input): a clerk can post to any string with no validation and no visible warning; only a header badge on error.
- **Verified evidence:** JournalEntryForm.tsx:293-317: `accounts.length > 0 ? <select> : <input placeholder='Account code'>`. accounts comes from getChartOfAccounts() (journal-entry/page.tsx:7), which falls back to [] on error (loaders.ts:1303-1313; mapAccounts returns null on empty). Worse than stated: default lines are prefilled with hard-coded '1000' (debit) and '2000' (credit) when accounts is empty (JournalEntryForm.tsx:45-46), so an errored load presents pre-populated codes. The only warning is the DataSourceBadge (page.tsx:15). validate() only checks non-empty code (105). The same form is used by accounting/vouchers/new/page.tsx with the same defect. Server-side rejection of unknown codes is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`, `apps/web/src/app/(app)/finance/journal-entry/page.tsx`, `apps/web/src/app/(app)/finance/accounting/vouchers/new/page.tsx`
- **Fix steps:**
  1. In both page.tsx files render <RefreshErrorState> when source==='error' or accounts.length===0 instead of the form.
  2. In JournalEntryForm remove the free-text <input> branch and the '1000'/'2000' fallbacks (lines 45-46); use '' when accounts is empty.
  3. In validate() require each accountCode to be in accounts.map(a=>a.code).
  4. Filter out status==='inactive' accounts from the select.
- **Acceptance:**
  - Component test: accounts=[] -> form not rendered, retry state shown.
  - Test: unknown code in state fails validation.
  - Manual on /finance/accounting/vouchers/new: same behaviour.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** High: today a clerk can post to arbitrary codes when the CoA fails; the fix blocks posting during CoA outages (intended).
- **Depends on:** GAP-FINANCE-JOURNAL-ENTRY-04

### GAP-FINANCE-JOURNAL-ENTRY-02  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Debit/credit fields are HTML number inputs converted with parseFloat and Math.round(n*100) (JournalEntryForm.tsx:31-34): values like 0.285 round unpredictably, and there is no lakh-grouped preview until totals; a fat-fingered extra zero balances happily across lines.
- **Verified evidence:** rupeesToPaise (JournalEntryForm.tsx:31-34) = Math.round(parseFloat(val)*100); used for totals (92-93), validation (106) and the POST body (152-153, String(...)). 1.005 -> 100 while 0.285 -> 28 or 29 depending on float error; 1e5, 'Infinity' or negative numbers pass parse since form has noValidate (200) and type=number min=0 is not enforced. Line-level input shows no formatted amount; only totals use formatMoney (385-390). A safe helper already exists: rupeesToMinorString in lib/money.ts:28 (strict regex, max 2 decimals, BigInt, but returns null for 0/empty so a wrapper is needed). The 'fat-fingered zero' claim is overstated: an extra zero on one side breaks balance; it only balances if repeated on both sides.
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`, `apps/web/src/lib/money.ts`, `apps/web/src/lib/__tests__ (new money tests)`
- **Fix steps:**
  1. Add parseMinorOrZero(v): bigint | null in lib/money.ts: '' -> 0n, valid via rupeesToMinorString -> BigInt, invalid -> null.
  2. Change JournalLine to keep strings, compute totals as bigint (sum), diff as bigint; delete rupeesToPaise.
  3. Field error 'Enter an amount with at most 2 decimals' when null; switch inputs to type='text' inputMode='decimal' so browser number quirks (e, scroll) go away.
  4. Show formatMoney(parsed) under each amount input (aria-live off) for lakh-grouped preview.
  5. Send debitMinor/creditMinor from the bigint strings.
- **Acceptance:**
  - Unit: '0.285' -> error; '1.005' -> error; '10.10' -> 1010n.
  - Component test: totals of 0.1+0.2 equal 0.30 exactly and balance.
  - Manual: typing 1234567.89 shows ₹12,34,567.89 preview.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** High (money): change touches posting amounts for both journal-entry and vouchers/new; cover with unit tests before merge.

### GAP-FINANCE-JOURNAL-ENTRY-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was DATEFMT)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Posting date has no closed-period check in the UI; nothing shows whether the date falls in an open fiscal year or a locked period (see Fiscal Years / Period Close).
- **Verified evidence:** Posting date input is a plain type=date defaulting to `new Date().toISOString().slice(0,10)` (JournalEntryForm.tsx:50 and 183) - UTC, so between 00:00 and 05:30 IST it defaults to yesterday. validate() (99-117) only checks the date is non-empty. No period check even though GET /api/v1/finance/periods (period-close/page.tsx:39-44) returns period + status (open/soft_close/hard_close) and fiscal-years exist. Server enforcement is cannot-verify. Theme should be validation, not date-format.
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`, `apps/web/src/app/(app)/finance/journal-entry/page.tsx`, `apps/web/src/app/(app)/finance/accounting/vouchers/new/page.tsx`, `apps/web/src/lib/fiscalYear.ts`, `apps/web/src/app/_data/loaders.ts (add getPeriods loader)`
- **Fix steps:**
  1. Extract mapPeriods from period-close/page.tsx to a shared loader getFinancePeriods(); fetch it in both page.tsx files and pass `periods` to JournalEntryForm.
  2. Default postingDate from an IST helper (add todayIst() next to currentMonthPeriod in lib/fiscalYear.ts) instead of toISOString.
  3. On date change look up the period (YYYY-MM): show a status pill; block submit if status is hard_close and warn on soft_close.
  4. If periods failed to load, show a warning that closed-period status is unverified rather than silently allowing.
  5. Backend: keep enforcing closed periods on POST /journals.
- **Acceptance:**
  - Test: date in a hard_close period -> field error and no dialog.
  - Test: at 2026-04-01T20:00Z (01:30 IST Apr 2) default date is 2026-04-02.
  - Manual: soft_close period shows warning.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: posting into a closed period is a control failure; UI check is advisory only, server must be authoritative.
- **Depends on:** GAP-FINANCE-JOURNAL-ENTRY-01

### GAP-FINANCE-JOURNAL-ENTRY-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Remove-line is disabled at 2 lines and account selects show "code — name" for every account type, including control accounts, with no filter by type or mapping to scheme/head (JournalEntryForm.tsx:283-330).
- **Verified evidence:** Remove button disabled at lines.length<=2 (JournalEntryForm.tsx:341) - correct for double entry, not a defect. Account options render `{a.code} — {a.name}` for every account (302-306): mapAccounts (loaders.ts:628-647) keeps type (asset/liability/equity/income/expense) and status (active/inactive) but no control-account or scheme/head flag, so type filtering is possible, control-account filtering is not (cannot-verify whether backend exposes it). Inactive accounts are also included (mapAccounts line 643), which is a real gap. Obs lines 283-330 are approximately right (293-317 for select).
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`, `apps/web/src/app/_data/loaders.ts`, `packages/types AccountSummary (not located in snapshot)`
- **Fix steps:**
  1. Filter status!=='active' out of the select (or disable with '(inactive)' suffix).
  2. Group options by type with <optgroup> and add a text filter (reuse SmartCombobox from _components) since CoA can be long.
  3. Backend/decision: expose `isControl`/`postable` flags in /accounts and hide non-postable control accounts here.
  4. Keep the min-2-lines rule.
- **Acceptance:**
  - Test: inactive account not selectable.
  - Manual: type 'cash' filters the account list.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: posting to a control account bypasses subledgers.
- **Depends on:** GAP-FINANCE-JOURNAL-ENTRY-01

### GAP-FINANCE-JOURNAL-ENTRY-05  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was MONEY)

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Balance error text embeds three formatMoney values in one sentence and the summary "Please correct the highlighted fields" duplicates it (JournalEntryForm.tsx:110-126).
- **Verified evidence:** Balance message built at JournalEntryForm.tsx:110-115 embeds three formatMoney values in one sentence. It is shown in a role=alert paragraph (411), while a generic 'Please correct the highlighted fields before posting.' banner (126) is shown at the same time (425-442) - two alerts, but they are not identical text, so 'duplicates it' is only loosely true. The three amounts in one sentence are dense but already live-visible in the totals row (385-390). Theme is copy, not money.
- **Files to change:** `apps/web/src/app/(app)/finance/journal-entry/JournalEntryForm.tsx`
- **Fix steps:**
  1. Shorten to 'Debit and credit differ by ₹X (debit ₹A, credit ₹B).' or show a small 3-row table.
  2. Suppress the generic banner when the only error is errors.balance, or set it only for field-level errors.
  3. Announce via a single aria-live region to avoid double screen-reader alerts.
- **Acceptance:**
  - Test: unbalanced entry shows one alert, not two.
  - Text includes difference formatted with Indian grouping.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-JOURNAL-ENTRY-02


---
## /finance/loans  —  `finance/loans.html`

- **Source:** `apps/web/src/app/(app)/finance/loans/page.tsx`
- **Design reference:** `redesign/finance/loans.html`

### GAP-FINANCE-LOANS-01  ·  MEDIUM  ·  defect  ·  theme BACKEND

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** The redirect target /hr/loans is behind the HR role gate while this route sits behind the finance gate (layout.tsx:29-34): a finance-only role that follows the redirect reaches the HR layout guard and may get "Access restricted" - two different gates on one hop; HR role lists are undeterminable from this route.
- **Service:** `hrms-service`  ·  **Endpoint(s):** `['redirect /finance/loans -> /hr/loans']`
- **Question:** 
- **How to verify:** 
- **Test to add:** Layout test: finance_officer requesting /hr/loans is allowed.
- **Impact if wrong:** Finance roles land on a permission wall.
- **Web change if wrong:** 
- **Finding:** finance/loans/page.tsx:10 redirects to /hr/loans; hr/layout.tsx:32-42 HR_ROLES omits finance_officer, finance_admin, accounts_officer etc. (finance layout allows them, workRoles.ts:32-43).

### GAP-FINANCE-LOANS-02  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Finance sidebar and home do not need this route: it exists only for bookmarks, so it can be deleted once analytics show no hits (page.tsx:3-8).
- **Verified evidence:** Confirmed as a fact, but it is a housekeeping suggestion, not a defect. apps/web/src/app/(app)/finance/loans/page.tsx:3-8 is a comment plus `redirect("/hr/loans")` (line 10). No sidebar, hub tile or navRouteManifest entry references /finance/loans (grep of apps/web/src finds only the file itself). But nothing records hits on the redirect (bare server redirect, no telemetry), so 'delete once analytics show no hits' cannot be acted on today. The folder also still holds orphaned components (LoanSummaryCard.tsx) that nothing imports.
- **Files to change:** `apps/web/src/app/(app)/finance/loans/page.tsx`, `apps/web/src/app/(app)/finance/loans/LoanSummaryCard.tsx`
- **Fix steps:**
  1. Decide: keep redirects for bookmarks (current comment intent) or remove.
  2. If removing: add a permanent redirect for /finance/loans -> /hr/loans in next.config redirects() (file not in snapshot) or middleware, so old bookmarks still resolve without a page file.
  3. Delete page.tsx and the orphaned components listed (LoanSummaryCard.tsx) in the same PR; grep confirms no importers.
  4. If keeping: add a telemetry event (existing emitError/telemetry helper in apps/web/src/app/_data/apiClient.ts pattern) or rely on gateway access logs so hits are measurable.
- **Acceptance:**
  - Visiting /finance/loans still lands on /hr/loans after the change.
  - `grep -r LoanSummaryCard apps/web/src` returns nothing after deletion.
  - pnpm typecheck passes.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Only risk is breaking old bookmarks/emails; mitigated by keeping a config-level redirect.
- **Depends on:** GAP-FINANCE-EXPENSES-02, GAP-FINANCE-MEDICAL-02


---
## /finance/medical  —  `finance/medical.html`

- **Source:** `apps/web/src/app/(app)/finance/medical/page.tsx`
- **Design reference:** `redesign/finance/medical.html`

### GAP-FINANCE-MEDICAL-01  ·  MEDIUM  ·  defect  ·  theme BACKEND

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** The redirect target /hr/medical is behind the HR role gate while this route sits behind the finance gate (layout.tsx:29-34): a finance-only role that follows the redirect reaches the HR layout guard and may get "Access restricted" - two different gates on one hop; HR role lists are undeterminable from this route.
- **Service:** `hrms-service`  ·  **Endpoint(s):** `['redirect /finance/medical -> /hr/medical', 'GET /v1/hrms/medical/claims']`
- **Question:** 
- **How to verify:** 
- **Test to add:** Layout test: finance_officer requesting /hr/medical renders the page.
- **Impact if wrong:** Finance roles land on a permission wall.
- **Web change if wrong:** 
- **Finding:** finance/medical/page.tsx:10 redirects to /hr/medical. hrms medical/routes.ts:24 HR_ROLES includes finance_officer, but web hr/layout.tsx:32-42 HR_ROLES does not, so the layout denies a role the API accepts.

### GAP-FINANCE-MEDICAL-02  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** Finance sidebar and home do not need this route: it exists only for bookmarks, so it can be deleted once analytics show no hits (page.tsx:3-8).
- **Verified evidence:** Confirmed as a fact, but it is a housekeeping suggestion, not a defect. apps/web/src/app/(app)/finance/medical/page.tsx:3-8 is a comment plus `redirect("/hr/medical")` (line 10). No sidebar, hub tile or navRouteManifest entry references /finance/medical (grep of apps/web/src finds only the file itself). But nothing records hits on the redirect (bare server redirect, no telemetry), so 'delete once analytics show no hits' cannot be acted on today. The folder also still holds orphaned components (MedicalClaimForm.tsx) that nothing imports.
- **Files to change:** `apps/web/src/app/(app)/finance/medical/page.tsx`, `apps/web/src/app/(app)/finance/medical/MedicalClaimForm.tsx`
- **Fix steps:**
  1. Decide: keep redirects for bookmarks (current comment intent) or remove.
  2. If removing: add a permanent redirect for /finance/medical -> /hr/medical in next.config redirects() (file not in snapshot) or middleware, so old bookmarks still resolve without a page file.
  3. Delete page.tsx and the orphaned components listed (MedicalClaimForm.tsx) in the same PR; grep confirms no importers.
  4. If keeping: add a telemetry event (existing emitError/telemetry helper in apps/web/src/app/_data/apiClient.ts pattern) or rely on gateway access logs so hits are measurable.
- **Acceptance:**
  - Visiting /finance/medical still lands on /hr/medical after the change.
  - `grep -r MedicalClaimForm apps/web/src` returns nothing after deletion.
  - pnpm typecheck passes.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Only risk is breaking old bookmarks/emails; mitigated by keeping a config-level redirect.
- **Depends on:** GAP-FINANCE-EXPENSES-02, GAP-FINANCE-LOANS-02


---
## /finance/opening-balances  —  `finance/opening-balances.html`

- **Source:** `apps/web/src/app/(app)/finance/opening-balances/page.tsx`
- **Design reference:** `redesign/finance/opening-balances.html`

### GAP-FINANCE-OPENING-BALANCES-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1842 (merged)
- **First-pass claim:** Opening balances are saved with no reason, approving authority or maker-checker step (OpeningBalanceForm.tsx:118-121 posts only { fyCode, entries }), yet the confirm copy says it "cannot be undone from this screen" and sets the starting position of the ledger; every mutation should be audited and approved by a distinct officer (CLAUDE.md).
- **Verified evidence:** OpeningBalanceForm.tsx:118-121 POSTs v1/finance/opening-balances with body {fyCode, entries} only. ConfirmDialog at :235-250 has no requireReason and its copy says 'cannot be undone from this screen'. Nothing in the client carries a reason, approver or maker/checker id. Whether finance-service enforces a distinct checker or emits an audit event cannot be seen (services/finance-service absent from snapshot). A ConfirmDialog already exists, so the suggested fix is partly already done; the missing piece is the mandatory reason and the approval step.
- **Files to change:** `apps/web/src/app/(app)/finance/opening-balances/OpeningBalanceForm.tsx`, `services/finance-service/src/modules/opening-balances/routes.ts (backend, not in snapshot)`
- **Fix steps:**
  1. In OpeningBalanceForm.tsx set requireReason and reasonLabel='Reason / approving authority' on the existing ConfirmDialog.
  2. Change onConfirm to pass the reason: submitEntries(reason) and include {reason} in the POST body next to fyCode and entries.
  3. Backend: extend zod schema with reason (min length), emit an audit event via @civitasone/events, and store maker id from the JWT.
  4. Decision: if opening balances require maker-checker, backend should create a pending batch that a different finance_admin approves; add a pending state and approve action UI.
  5. Reword the dialog copy to match the real behaviour (saved vs submitted for approval).
- **Acceptance:**
  - Component test: Save button in dialog stays disabled until reason meets minReasonLength; POST body contains reason.
  - Backend test: POST without reason returns 400; audit event emitted with actor and reason.
  - If maker-checker adopted: same user cannot approve own batch (403).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changes a ledger-seeding write; backend contract change must ship together with the UI or saves will 400.

### GAP-FINANCE-OPENING-BALANCES-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** A failed balances fetch renders the empty state "No opening balances entered — enter them using the form above" beside a live entry form (page.tsx:96,113-118,151-172; apiClient.ts:117-172), which invites re-entering balances that may already exist; the only signal is the header badge.
- **Verified evidence:** page.tsx:98-99 (file offset) balances default to [] when getOpeningBalances returns source:'error' (apiClient.ts fetchJson returns {data: empty, source:'error'} on non-ok, invalid payload or network failure). Page then renders StatCards 'Entries' 0, Total Debit/Credit via formatMoney(0) (page.tsx:153-155), the live OpeningBalanceForm (:158) and the DataTable empty state 'No opening balances entered' (:160-171). Only signal is the header DataSourceBadge (page.tsx:117). Also a failed fiscal-years fetch yields an empty select with no message.
- **Files to change:** `apps/web/src/app/(app)/finance/opening-balances/page.tsx`
- **Fix steps:**
  1. In page.tsx read balancesSource and fySource separately.
  2. When selectedFy && balancesSource==='error', render <RefreshErrorState error={toHumanError('load',{area:'opening balances'})} backHref='/finance'/> in place of the StatGrid and table card, and do not render OpeningBalanceForm (or render it disabled with a warning that existing balances are unknown).
  3. Pass '—' to the three StatCards instead of 0/₹0.00 when source is error.
  4. When fySource==='error' show RefreshErrorState instead of an empty select.
  5. Keep the empty DataTable state only for source==='api' with zero rows.
- **Acceptance:**
  - Component/page test with fetchJson mocked to source:'error': error state with Retry appears, no 'No opening balances entered' text and no form.
  - Mock success with [] : empty state and form appear as today.
  - Manual: stop the gateway, reload with ?fy=2026-27; stat cards show '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; hiding the form on error slightly blocks entry when only the read is down, which is the safe direction for ledger seeding.
- **Depends on:** RefreshErrorState (exists: apps/web/src/app/_components/ds/RefreshErrorState.tsx)

### GAP-FINANCE-OPENING-BALANCES-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was CONFIRM)

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** Account Code is a free-text input (max 20 chars, OpeningBalanceForm.tsx) with no lookup against the Chart of Accounts; a mistyped code is only rejected server-side after the confirm step, and the ledger shows raw codes with no account names.
- **Verified evidence:** OpeningBalanceForm.tsx:157-166 account code is a plain <input maxLength=20>, validated only for non-empty (:70). No CoA lookup; page.tsx table columns show raw accountCode (:'Account Code' column). A getChartOfAccounts() loader exists (apps/web/src/app/_data/loaders.ts:1303, /api/v1/finance/accounts) and a SmartCombobox exists (app/_components/SmartCombobox.tsx, string options only). Server-side rejection of an unknown code cannot be verified (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/opening-balances/page.tsx`, `apps/web/src/app/(app)/finance/opening-balances/OpeningBalanceForm.tsx`, `apps/web/src/app/_data/loaders.ts (AccountSummary fields check)`
- **Fix steps:**
  1. In page.tsx call getChartOfAccounts() and pass accounts ({code,name}) to OpeningBalanceForm as a prop.
  2. Replace the free-text input with a combobox (extend SmartCombobox to accept {value,label} options or use a native <input list> with a <datalist> of 'code - name').
  3. In validate() reject codes not present in the accounts list, setting invalidRowId and a row-specific message.
  4. In page.tsx map accountCode to 'code - name' in the table column via the same accounts list.
  5. If getChartOfAccounts errors, fall back to free text with a visible warning.
- **Acceptance:**
  - Unit test: typing an unknown code blocks the confirm dialog with an inline error.
  - Selecting 'code - name' submits only the code in accountCode.
  - Saved-balances table shows account name beside code.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** If CoA fetch is stale/incomplete users could be blocked from a valid new account; keep server as final validator.

### GAP-FINANCE-OPENING-BALANCES-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** Save is offered to every FINANCE_ROLES member with no role gate (page.tsx; unlike period-close, which computes canReopen); an audit_officer or budget_officer gets a 403 only after confirming.
- **Verified evidence:** True on the web side: OpeningBalanceForm is rendered for anyone who passes the finance/layout.tsx FINANCE_ROLES gate (workRoles.ts:32, which includes audit_officer, budget_officer, procurement_officer); page.tsx has no getSessionRoles() check, unlike period-close/page.tsx:50 (canReopen). Which roles finance-service actually admits on POST /v1/finance/opening-balances, and therefore whether audit_officer gets a 403, cannot be verified (service absent); the 'only after confirming' claim rests on that.
- **Files to change:** `apps/web/src/app/(app)/finance/opening-balances/page.tsx`, `apps/web/src/app/(app)/finance/opening-balances/OpeningBalanceForm.tsx`, `apps/web/src/lib/auth/workRoles.ts`
- **Fix steps:**
  1. Confirm the write roles from services/finance-service opening-balances routes.ts and add an OPENING_BALANCE_WRITE_ROLES constant in workRoles.ts.
  2. In page.tsx compute canEdit = getSessionRoles().some(r => OPENING_BALANCE_WRITE_ROLES.includes(r)).
  3. Render OpeningBalanceForm only when canEdit; otherwise show a read-only note.
  4. Leave the server 403 as the authority.
- **Acceptance:**
  - Page test with roles ['audit_officer']: table visible, form absent.
  - With ['finance_admin']: form present.
  - Server still 403s a forged POST from a read-only role.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Wrong role list would hide the form from legitimate users; derive it from the service.

### GAP-FINANCE-OPENING-BALANCES-05  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** Rupees are converted with parseFloat and Math.round(n*100) (OpeningBalanceForm.tsx:23-26) and totals summed as JS numbers (page.tsx:98-99): fine at this scale but not the bigint-paise path CLAUDE.md requires, and "48,62,400" typed with lakh commas parses to 48 (parseFloat stops at the first comma) so the row is saved as ₹48.00.
- **Verified evidence:** OpeningBalanceForm.tsx:23-26 rupeesToPaise uses parseFloat + Math.round(n*100); parseFloat('48,62,400') = 48 so the row saves as 4800 paise (Rs 48.00) with no warning, and 'abc' silently becomes 0 (then fails as 'greater than zero'), '12abc' becomes 12. Totals at :87-88 sum JS numbers and the balance check is exact-integer compare, fine below 2^53 paise but not the bigint/string convention. Page totals at page.tsx:98-99 use Number(b.debitMinor) sums. Float risk is real for inputs like 1.005 (Math.round(100.49999)). Amounts are posted as JSON numbers debitMinor/creditMinor.
- **Files to change:** `apps/web/src/lib/money.ts (new: parseRupeesToPaise)`, `apps/web/src/app/(app)/finance/opening-balances/OpeningBalanceForm.tsx`, `apps/web/src/app/(app)/finance/opening-balances/page.tsx`
- **Fix steps:**
  1. Create parseRupeesToPaise(input): string -> bigint|null that strips commas/spaces/₹, accepts only /^\d+(\.\d{1,2})?$/, and builds paise by string split (no float).
  2. Use it in OpeningBalanceForm; on null set a row error 'Enter a valid amount, e.g. 48,62,400.00'.
  3. Sum totals as bigint and format with formatMoney(bigint).
  4. Send debitMinor/creditMinor as decimal strings if the API zod accepts them (backend check needed), else Number only after bigint safety check.
  5. In page.tsx sum with BigInt(b.debitMinor) instead of Number.
- **Acceptance:**
  - Unit: parseRupeesToPaise('48,62,400') === 486240000n; '1.005' -> null; '12abc' -> null; '0.10' -> 10n.
  - Form test: entering '48,62,400' in debit shows Rs 48,62,400.00 in the mismatch message, not 48.00.
  - Page renders totals above 2^53 paise correctly.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money path; wrong parsing changes seeded ledger balances. Add tests before release.

### GAP-FINANCE-OPENING-BALANCES-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** The fiscal-year select shows closed years without warning that setting balances on a closed year is meaningless; only the "active" year is flagged (page.tsx:133).
- **Verified evidence:** page.tsx:133 (file offset 386) option text is '{label} ({code})' plus ' — active' only when status==='active'; closed years get no marker and are selectable, and the form is shown regardless of the selected year's status. The status string is available in FiscalYearOption. Whether the backend rejects writes to a closed year is not verifiable.
- **Files to change:** `apps/web/src/app/(app)/finance/opening-balances/page.tsx`
- **Fix steps:**
  1. Append ' — closed' (or status humanized) to the option label when status !== 'active'.
  2. Compute selectedFyStatus from fiscalYears.find(code===selectedFy).
  3. If status is closed/locked, show a warning and hide or disable OpeningBalanceForm (pass disabled prop).
  4. Confirm with finance owner which statuses allow opening balances.
- **Acceptance:**
  - Select closed FY: warning banner shown, Save disabled.
  - Active FY: unchanged.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Need business rule on which FY statuses permit opening balances; wrong rule blocks legitimate entry.

### GAP-FINANCE-OPENING-BALANCES-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** loading.tsx is a single bare "skeleton" div (loading.tsx) unlike the four-card skeleton on the sibling list screens.
- **Verified evidence:** opening-balances/loading.tsx (3 lines) renders one <div className='skeleton'> only. payments/loading.tsx renders header bars, four 96px cards and a 384px block. error.tsx exists and uses RouteError, so only the loading half of the finding holds.
- **Files to change:** `apps/web/src/app/(app)/finance/opening-balances/loading.tsx`
- **Fix steps:**
  1. Replace with a skeleton shaped like the page: header bars, a select-card block, three StatCard blocks, table block; reuse Skeleton from ds/Skeleton.tsx if it fits.
  2. Keep role='status' and aria-label.
- **Acceptance:**
  - Visual check with slow network: skeleton has three stat placeholders and table placeholder.
  - a11y: single role=status region.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/payments  —  `finance/payments.html`

- **Source:** `apps/web/src/app/(app)/finance/payments/page.tsx`
- **Design reference:** `redesign/finance/payments.html`

### GAP-FINANCE-PAYMENTS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** "+ New Payment" POSTs only { action: "release", reason } (FinanceActions.tsx:88) and is styled danger: an irreversible outward disbursement is triggered from a one-line free-text reason with no beneficiary, amount, mode or bill.
- **Verified evidence:** FinanceActions.tsx:78-91 '+ New Payment' is danger-styled ActionButton with requireReason ('Authorising officer & reason'), POSTing /api/proxy/v1/finance/payments/eft {action:'release', reason}. No beneficiary, amount, mode or bill fields; the dialog copy claims 'maker prepares, a distinct checker must authorise' but nothing on the client enforces or shows a checker. The endpoint's server behaviour cannot be seen (finance-service absent). Note the reason is free text naming the 'authorising officer', not a structured id.
- **Files to change:** `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`, `apps/web/src/app/(app)/finance/payments/NewPaymentForm.tsx (new)`, `services/finance-service payments routes (backend)`
- **Fix steps:**
  1. Replace the one-line release with a NewPaymentForm (beneficiary picker, amount in paise via shared parser, mode, linked passed bill) validated with zod.
  2. Create the payment as 'Pending Approval' (maker) and require a different user to approve/release (checker) via a separate action on the detail page.
  3. Backend: reject release when actor == maker; emit audit event including reason.
  4. Keep ConfirmDialog with reason for the release step; drop the generic 'release' action from the list page.
- **Acceptance:**
  - Cannot submit without beneficiary, amount, mode.
  - Same user cannot release own payment (403 and UI hides the button).
  - Audit event emitted with actor, amount, reason.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Disbursement of public funds; must be gated by backend maker-checker, not UI alone.
- **Depends on:** GAP-FINANCE-OPENING-BALANCES-05

### GAP-FINANCE-PAYMENTS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was MONEY)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** mapPayments returns null when no row has all of referenceId, beneficiary, amountDisplay and one of four exact statuses (loaders.ts:507-510), and fetchJson turns null into source:"error" (apiClient.ts:163-166): a tenant with zero payments, or whose rows carry another status such as "Approved", is shown "Couldn't load — showing nothing" instead of an empty register.
- **Verified evidence:** loaders.ts:494-511 mapPayments skips rows lacking referenceId/beneficiary/amountDisplay or with status outside Queued|Released|Pending Approval|Failed and ends with `return mapped.length > 0 ? mapped : null`. fetchJson (apiClient.ts, mapped===null branch) then returns source:'error'. So an empty tenant, or rows with status like 'Approved'/'released' (case-sensitive), shows the error badge with nothing. getPayments also feeds getFinanceEPayments. The theme MONEY is wrong; this is a failure-vs-empty confusion.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/finance/payments/page.tsx`
- **Fix steps:**
  1. In mapPayments return mapped (possibly []) when the payload was a valid array; return null only if getArrayPayload fails.
  2. Normalise status case/underscores before matching and add an 'Approved'/'Other' passthrough instead of dropping rows.
  3. Log skipped-row count via telemetry.
  4. Add tests: [] -> [] ; unknown status row retained.
- **Acceptance:**
  - Unit: mapPayments({data:[]}) returns [] and page shows empty register, not error badge.
  - Row with status 'Approved' is displayed.
  - Malformed payload still yields source 'error'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Showing previously hidden rows could surface unexpected statuses; intended.
- **Depends on:** GAP-FINANCE-PAYMENTS-03

### GAP-FINANCE-PAYMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** StatusPill has no mapping for "Released", "Pending Approval" or "Queued" (StatusPill.tsx:6-38), so all three render the neutral info variant; only "Failed" is coloured. Released and pending look identical.
- **Verified evidence:** StatusPill.tsx STATUS_MAP has no 'released', 'pending approval' or 'queued'; register uses cellType 'status' (PaymentsTable.tsx:124) so those render 'info'; only 'Failed' -> bad. Page filters rely on exact strings (page.tsx:9-11). Same root cause as PAYMENTS-DETAIL-07.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add released:'good', 'pending approval':'warn', queued:'mut' to STATUS_MAP.
  2. Normalise underscores as in DETAIL-07.
  3. Add unit tests.
- **Acceptance:**
  - Register shows Released green, Pending Approval amber, Queued grey, Failed red.
  - StatusPill unit test covers each.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component tone change.
- **Depends on:** GAP-FINANCE-PAYMENTS-DETAIL-07

### GAP-FINANCE-PAYMENTS-05  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** amountDisplay is a pre-formatted string sorted as text (PaymentsTable.tsx:84), so sorting Amount orders "₹12,00,000.00" before "₹3,15,000.00"; the money is not held as paise here.
- **Verified evidence:** PaymentsTable.tsx:84 (offset 123) Amount column key amountDisplay is a preformatted string; DataTable compareValues (DataTable.tsx:160-171) falls to String.localeCompare with numeric:true, which compares digit runs numerically, so the cited example '₹12,00,000.00' vs '₹3,15,000.00' actually orders correctly (3 < 12). It still breaks with Indian grouping across magnitudes (e.g. '₹1,00,00,000.00' sorts before '₹99,99,999.00') and it ignores paise-level ordering; money is not held as paise in the row model (mapPayments passes amountDisplay/amount text).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/finance/payments/PaymentsTable.tsx`
- **Fix steps:**
  1. Add amountMinor (string) to PaymentSummary in mapPayments when the API supplies it (check payload field).
  2. In PaymentsTable render Amount with render: row => formatMoney(row.amountMinor) and sort on the numeric key (use bigint or Number since compareValues handles numeric strings).
  3. Fall back to amountDisplay only when amountMinor missing.
- **Acceptance:**
  - Unit: sorting rows 1,00,00,000 and 99,99,999 ascending puts 99,99,999 first.
  - Amount column right-aligned and formatted via formatMoney.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Requires API to expose minor units; if not, backend change.

### GAP-FINANCE-PAYMENTS-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** Title "Payment Gateway" but the finance home tile for this route reads "Payments" and the detail page "Payment Detail"; the three names do not agree (page.tsx:16).
- **Verified evidence:** payments/page.tsx:16 title 'Payment Gateway'; detail page title is paymentNo with breadcrumb 'Payments' and not-found title 'Payment Detail' (payments/[id]/page.tsx offset 174). The finance home tile label was not opened; I did not verify it reads 'Payments'.
- **Files to change:** `apps/web/src/app/(app)/finance/payments/page.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Pick 'Payments' as the canonical name (matches breadcrumb).
  2. Update PageHeader title on the list page; check finance/page.tsx tile and Sidebar label.
  3. Keep 'Payment Detail' only as not-found title or rename 'Payment'.
- **Acceptance:**
  - Tile, page title and breadcrumb read the same.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-PAYMENTS-07  ·  LOW  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** PFMS Sync confirm button is not danger-styled although its own copy says it may move funds (FinanceActions.tsx:66-77).
- **Verified evidence:** FinanceActions.tsx:65-77 PFMS Sync ActionButton has className 'btn ghost' and no `danger` prop, while its confirmDescription says it 'may move funds for queued instructions and cannot be reversed'. It does require a reason. The '+ New Payment' button next to it has danger.
- **Files to change:** `apps/web/src/app/(app)/finance/_components/FinanceActions.tsx`
- **Fix steps:**
  1. Add `danger` to the PFMS Sync ActionButton.
  2. Consider clarifying the copy: either it only reconciles (drop 'move funds') or it disburses (then it needs the maker-checker treatment); confirm actual behaviour with the finance owner.
- **Acceptance:**
  - Confirm dialog for PFMS Sync renders danger styling.
  - Reason still required.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Copy vs behaviour mismatch may hide a real disbursement path.


---
## /finance/payments/[id]  —  `finance/payments-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/payments/[id]/page.tsx`
- **Design reference:** `redesign/finance/payments-detail.html`

### GAP-FINANCE-PAYMENTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** A failed fetch is shown as "Payment not found": the loader returns { data: null, source: "error" } (apiClient.ts:117-172), so the page takes the !payment branch (page.tsx:30-40); the DataSourceBadge in the filled branch (page.tsx:66) can never render. An officer with a network blip is told the payment "may have been removed".
- **Verified evidence:** payments/[id]/page.tsx:30-40 (file offset 167-177): if(!payment) renders EmptyState 'Payment not found ... may have been removed or the ID is invalid'. getFinancePaymentById (loaders.ts:777) returns {data:null, source:'error', status?} for network, 401, 5xx and schema failure, all reaching that branch. The DataSourceBadge at :66 renders only when source==='error' in the branch reached only when payment is non-null, so it is dead code. LoaderResult carries status (apiClient.ts), so a real 404 is distinguishable.
- **Files to change:** `apps/web/src/app/(app)/finance/payments/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status from the loader result.
  2. If source==='error' and status!==404, render <RefreshErrorState error={toHumanError('load',{area:'payment'})} backHref='/finance/payments'/> with the breadcrumb.
  3. Only when status===404 (or source api and null) render the current not-found EmptyState, or call notFound().
  4. Remove the dead DataSourceBadge line.
- **Acceptance:**
  - Test with loader returning {source:'error', status:500}: error state with Retry, no 'Payment not found'.
  - Test with status 404: not-found copy.
  - 401 shows the sign-in path or error state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-PAYMENTS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** Raising an eOffice file asks the officer to paste two employee UUIDs (RaiseEOfficeNote.tsx: placeholders "employee UUID" and "approver UUID", validated only against a UUID regex), a raw-id entry no clerk can complete without a lookup.
- **Verified evidence:** RaiseEOfficeNote.tsx:~168-176 renders two plain inputs with placeholders 'employee UUID' / 'approver UUID'; submit() at :102-103 validates only UUID_RE. The component is shared by ~10 detail pages (grants, hr/disciplinary, assets, bills, sanctions, legal, procurement, payments). No EntityPicker exists in the repo. An identity users loader exists (getTenantUsers, /api/identity/users); the current user id could default initiatedBy from the session (not verified where the id is exposed).
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/app/_components/EmployeePicker.tsx (new)`
- **Fix steps:**
  1. Create EmployeePicker (searchable combobox, name + designation label, returns UUID) backed by an existing employee/user listing endpoint via /api/proxy (confirm which endpoint estab uses).
  2. Default initiatedBy to the signed-in user's employee id and make it read-only or pre-selected.
  3. Replace both raw inputs in RaiseEOfficeNote with the picker; keep UUID validation as a guard.
  4. Show names in the success message.
- **Acceptance:**
  - Component test: selecting a name posts the UUID in initiatedBy/currentWith.
  - Officer can complete raise without typing any UUID.
  - Picker error state offers retry.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared component across many modules; regressions affect all eOffice raises.

### GAP-FINANCE-PAYMENTS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** "Raise for approval" is rendered for every payment regardless of status (page.tsx:89-97), including already Released or Failed payments; the button has no status gate.
- **Verified evidence:** page.tsx:89-97 (offset 226-234) always renders <RaiseEOfficeNote> with no status gate, so it appears for Released/Failed payments. Mitigation: RaiseEOfficeNote.tsx:146-152 swaps the button for the linked file no/status/Open file when a file exists, so already-raised payments do not show the button; but a released or failed payment with no linked file still offers 'Raise for approval'. notifyPath submit-approval would then be called on a released payment (server behaviour not visible).
- **Files to change:** `apps/web/src/app/(app)/finance/payments/[id]/page.tsx`
- **Fix steps:**
  1. Compute canRaise from status (e.g. draft/queued/pending only; confirm allowed statuses with finance).
  2. Render <RaiseEOfficeNote> only when canRaise; otherwise omit or show a read-only status line.
  3. Backend should also reject submit-approval on terminal statuses.
- **Acceptance:**
  - Released and Failed payments do not show 'Raise for approval'.
  - Queued payment shows it.
  - Backend rejects submit-approval on Released (400/409).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Need agreed status set; too strict hides legitimate flow.

### GAP-FINANCE-PAYMENTS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** Status appears three times (header pill, Status stat card, Status field, page.tsx:65,73,85) while no timeline, approver, beneficiary or bill is shown; the page carries little decision information.
- **Verified evidence:** StatusPill appears in header (page.tsx:65), StatCard 'Status' (:73) and 'Status' field (:85, offsets 202,210,222). Displayed fields are only ref, amount, mode, currency, UTR, status (Amount, Mode, Currency also duplicated in stat cards and field list). No beneficiary, bill, approver or timeline is rendered; whether the API returns them cannot be seen (FinancePaymentDetailSchema not inspected for those fields).
- **Files to change:** `apps/web/src/app/(app)/finance/payments/[id]/page.tsx`, `packages/*/FinancePaymentDetailSchema (check which fields the API returns)`
- **Fix steps:**
  1. Check FinancePaymentDetailSchema and the API for beneficiary, billId, approver, createdAt/updatedAt.
  2. Drop the Status stat card and the duplicate Status field; keep the header pill.
  3. Add Beneficiary, linked Bill (link to /finance/expenditure/bills/[id]) and dates to the details card when present.
  4. Add a simple status timeline if the API exposes history (backend otherwise).
- **Acceptance:**
  - Status shown once per screen.
  - Beneficiary and bill link render when API supplies them.
  - Missing fields show '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; depends on API fields.

### GAP-FINANCE-PAYMENTS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme LOADING

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** No loading.tsx or error.tsx in payments/[id] (directory holds page.tsx only): the list skeleton (four stat cards plus a 384px table block) shows while a detail record loads.
- **Verified evidence:** Directory payments/[id] holds page.tsx only, true. But Next.js inherits payments/loading.tsx (list skeleton: header, four cards, 384px block) and payments/error.tsx (RouteError), and finance/error.tsx exists, so an error boundary does apply. The real gap is the mismatched loading skeleton and no route-level not-found (uses inline EmptyState).
- **Files to change:** `apps/web/src/app/(app)/finance/payments/[id]/loading.tsx (new)`, `apps/web/src/app/(app)/finance/payments/[id]/page.tsx`
- **Fix steps:**
  1. Add payments/[id]/loading.tsx with breadcrumb bar, four stat blocks and one details card block.
  2. Use notFound() for real 404s and rely on finance/not-found.tsx.
  3. Optionally add [id]/error.tsx with backHref '/finance/payments' (parent already covers it).
- **Acceptance:**
  - Navigating from the register shows a detail-shaped skeleton.
  - Unknown id triggers the finance not-found page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-PAYMENTS-DETAIL-01

### GAP-FINANCE-PAYMENTS-DETAIL-06  ·  LOW  ·  partly  ·  theme UUID

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** The page title falls back to "PAY-" + the last 6 characters of the record id when no reference exists (page.tsx:43-45), an id fragment the register also uses (PaymentsTable.tsx:26-31) but which is not stored anywhere searchable.
- **Verified evidence:** page.tsx:43-45 (offset 180-182) falls back to `PAY-${params.id.slice(-6).toUpperCase()}` when eftRef/referenceId/utr are all missing; PaymentsTable.tsx:26-31 formatReference gives the same PAY-xxxxxx for UUID references. It is a display-only fragment of the UUID; the claim that it is 'not stored anywhere searchable' cannot be verified from web code (register filter searches the displayed string, so it is searchable there). Collision risk with 6 hex chars is small but real.
- **Files to change:** `apps/web/src/app/(app)/finance/payments/[id]/page.tsx`, `apps/web/src/app/(app)/finance/payments/PaymentsTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Extract one shared formatPaymentRef(ref|id) into formatters.ts and use it in both files.
  2. Prefer a backend-issued human reference number (backend) and show the fragment only as a labelled fallback ('Ref pending').
  3. Show full id in a copyable secondary line if needed.
- **Acceptance:**
  - Both list and detail show identical reference for the same payment.
  - Payment with a real referenceId shows it unchanged.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; reference display only.

### GAP-FINANCE-PAYMENTS-DETAIL-07  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** StatusPill has no mapping for "pending_approval" or "released" (StatusPill.tsx:6-38), so the header pill is the neutral info variant.
- **Verified evidence:** StatusPill.tsx:5-38 STATUS_MAP has no 'released', 'pending_approval', 'pending approval' or 'queued'; lookup is status.toLowerCase() so 'pending_approval' misses ('pending' key only matches exactly) and falls to 'info'. Only 'failed' is red. Detail page passes the raw API status (page.tsx:65,85).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add to STATUS_MAP: released:'good', 'pending approval':'warn', pending_approval:'warn', queued:'mut' (confirm tone).
  2. Normalise underscores to spaces before lookup: status.toLowerCase().replace(/_/g,' ').
  3. Add unit tests for the new keys.
- **Acceptance:**
  - Unit: StatusPill status='pending_approval' has class warn; 'Released' good.
  - Existing mappings unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component: tone change affects every screen using these words; review usages.


---
## /finance/period-close  —  `finance/period-close.html`

- **Source:** `apps/web/src/app/(app)/finance/period-close/page.tsx`
- **Design reference:** `redesign/finance/period-close.html`

### GAP-FINANCE-PERIOD-CLOSE-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Soft-close and hard-close POST with no reason and no approving authority (PeriodsTable.tsx:66 sends a body only for reopen), so the two transitions that lock the books leave no stated justification, while only the reverse (reopen) asks for one; and any FINANCE_ROLES member sees the buttons, only reopen is gated (page.tsx:50).
- **Verified evidence:** PeriodsTable.tsx:64-66 sends a JSON body only for action==='reopen'; close and hard-close POST with no body. ConfirmDialog requireReason is only true for reopen (:264-265, offset). Both ClosePeriodForm.tsx (soft-close, no reason) and hard-close are visible to any FINANCE_ROLES user; only reopen is filtered via canReopen (page.tsx:50). Server role guards and audit for close/hard-close cannot be verified (finance-service absent); the comment in PeriodsTable claims a state machine at services/finance-service/.../period-close/routes.ts.
- **Files to change:** `apps/web/src/app/(app)/finance/period-close/PeriodsTable.tsx`, `apps/web/src/app/(app)/finance/period-close/ClosePeriodForm.tsx`, `apps/web/src/app/(app)/finance/period-close/page.tsx`, `apps/web/src/lib/auth/workRoles.ts`, `services/finance-service period-close routes (backend)`
- **Fix steps:**
  1. Set requireReason on the ConfirmDialog for all three actions in PeriodsTable and ClosePeriodForm; send {reason} in every POST body.
  2. Backend: accept and persist reason for close/hard-close and emit audit events.
  3. Add canClose (roles confirmed from service) in page.tsx and pass to PeriodsTable/ClosePeriodForm; hide close and hard-close for roles the server rejects.
  4. Decision: whether hard-close needs a second approver.
- **Acceptance:**
  - Dialog confirm disabled until reason entered for all three actions; POST body contains reason.
  - audit_officer sees no Close buttons.
  - Backend returns 400 without reason.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Locks the books; backend contract must match or closes will 400.

### GAP-FINANCE-PERIOD-CLOSE-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1787 (merged)
- **First-pass claim:** Hard-close warns that unposted vouchers "will be left stranded" (PeriodsTable.tsx:136-143) but the page offers no way to see them: no count of unposted vouchers, unreconciled bank items or open recurring entries beside the action, so the officer must leave the screen to check before an action the dialog says cannot be undone here.
- **Verified evidence:** PeriodsTable.tsx dialogCopy for hard-close (offset 221-229, lines ~133-141) warns that unposted vouchers 'will be left stranded' but no count or link is shown anywhere; page.tsx has only four period-status stat cards and no readiness data. Whether the API exposes unposted-voucher/unreconciled counts per period cannot be verified (journal-entry, reconciliation and recurring-entries routes exist under finance/ but were not read).
- **Files to change:** `apps/web/src/app/(app)/finance/period-close/page.tsx`, `apps/web/src/app/(app)/finance/period-close/PeriodsTable.tsx`, `services/finance-service (period readiness endpoint, backend)`
- **Fix steps:**
  1. Backend: add GET /v1/finance/periods/{period}/readiness returning counts of unposted vouchers, unreconciled bank items, due recurring entries.
  2. In PeriodsTable, when hard-close is clicked fetch readiness and render counts with links to /finance/journal-entry?status=draft, /finance/reconciliation, /finance/recurring-entries in the dialog description.
  3. Disable the confirm (or require an extra acknowledgement checkbox) when counts > 0.
  4. Show a loading/error state for the readiness fetch.
- **Acceptance:**
  - Hard-close dialog for period with 3 draft vouchers shows '3 unposted vouchers' with link and requires acknowledgement.
  - Readiness fetch failure shows an error and blocks confirm.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Business rule choice (block vs warn) needed; wrong counts may falsely block close.
- **Depends on:** GAP-FINANCE-PERIOD-CLOSE-01

### GAP-FINANCE-PERIOD-CLOSE-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** Soft-close of a period never seen before needs a typed "YYYY-MM" text field (ClosePeriodForm.tsx:80-116) instead of a month picker or the current open month; a typo such as 2062-04 passes the regex.
- **Verified evidence:** ClosePeriodForm.tsx:86 (offset 361) is a free text input maxLength 7 placeholder '2026-04'; validate uses PERIOD_PATTERN /^\d{4}-(0[1-9]|1[0-2])$/ (:22), so 2062-04 passes as the finding says, but malformed months are rejected. No fiscal-year or plausibility check.
- **Files to change:** `apps/web/src/app/(app)/finance/period-close/ClosePeriodForm.tsx`
- **Fix steps:**
  1. Replace the text input with <input type='month'> (value YYYY-MM natively) or a select built from the current fiscal year's months.
  2. Default to the earliest still-open period from the periods list (pass as prop).
  3. Reject periods more than one fiscal year from now in validate().
  4. Keep PERIOD_PATTERN as guard.
- **Acceptance:**
  - Picker offers only real months; 2062-04 not selectable or rejected with message.
  - Default suggests earliest open period.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** type=month is unsupported in some desktop browsers (older Safari/Firefox); use a select fallback.

### GAP-FINANCE-PERIOD-CLOSE-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** On error the header badge and a second badge in the table card both show, and the four stat cards read 0 (page.tsx:62,80-83); for a cockpit whose numbers mean "how many periods are locked", a silent zero reads as "nothing closed".
- **Verified evidence:** page.tsx:62 header badge on error; :65-70 four StatCards show openCount/softClosed/hardClosed/periods.length computed from [] (0); :80-82 card body shows a second DataSourceBadge when source==='error' && periods.length===0. Form ClosePeriodForm still renders. So a failed fetch shows Open 0 / Hard-Closed 0 and Tracked Periods 0.
- **Files to change:** `apps/web/src/app/(app)/finance/period-close/page.tsx`
- **Fix steps:**
  1. When source==='error', render <RefreshErrorState error={toHumanError('load',{area:'periods'})} backHref='/finance'/> in place of StatGrid and table card.
  2. Pass '—' to StatCards if keeping them.
  3. Remove the duplicate badge (keep one indicator).
  4. Consider disabling ClosePeriodForm on error.
- **Acceptance:**
  - Mock source:'error': stat cards show '—' (or are replaced), a single error state with Retry.
  - Success path unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-PERIOD-CLOSE-05  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** Status pills for soft_close and hard_close fall to the neutral info variant (StatusPill.tsx:6-38), so a hard-closed (locked) period is not visually distinct from a soft-closed one; only "open" is green.
- **Verified evidence:** StatusPill STATUS_MAP has no 'soft_close' or 'hard_close' (lookup uses status.toLowerCase(), underscores retained) so both fall to 'info'; 'open' is 'good'. The Status column uses cellType 'status' (PeriodsTable.tsx:87 offset 175). Label is humanized by humanizeStatus. Not colour-distinct from each other.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add soft_close:'warn' and hard_close:'bad' (or 'mut' with lock icon) to STATUS_MAP.
  2. Prefer normalising underscores to spaces and keys 'soft close'/'hard close'.
  3. Unit-test both.
- **Acceptance:**
  - Soft-closed pill amber, hard-closed pill distinct (red/grey).
  - Existing statuses unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component.
- **Depends on:** GAP-FINANCE-PAYMENTS-DETAIL-07

### GAP-FINANCE-PERIOD-CLOSE-06  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Closed By is printed verbatim from the payload (PeriodsTable.tsx:88); whether it is a name or a user id cannot be told from the code, and Closed At shows a date without a time (formatIndianDate).
- **Verified evidence:** PeriodsTable.tsx:88 renders row.closedBy ?? '—' verbatim (payload string; mapPeriods page.tsx:30 takes raw.closedBy string), so it may be a user id; cannot verify what the API returns. Closed At uses formatIndianDate (formatters.ts:2) which is toLocaleDateString('en-IN', dd/mm/yyyy) with no time and no explicit Asia/Kolkata timeZone, so the date can shift by locale of the server/browser. No formatIndianDateTime helper was found in formatters.ts.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/finance/period-close/PeriodsTable.tsx`, `services/finance-service period list (backend, if only id is returned)`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) using timeZone 'Asia/Kolkata' in formatters.ts.
  2. Use it for Closed At.
  3. If closedBy is a UUID, have the API return closedByName or resolve via the identity users loader and show the name.
- **Acceptance:**
  - Closed At shows '04 Jul 2026, 17:30 IST' form for a fixed ISO input regardless of runtime TZ.
  - Closed By shows a name, not a UUID.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-FINANCE-PERIOD-CLOSE-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** loading.tsx is a bare skeleton div, not a cockpit-shaped skeleton (loading.tsx).
- **Verified evidence:** period-close/loading.tsx is one <div className='skeleton'> (3 lines), same as opening-balances/loading.tsx. Page shape is header, four stat cards, note, form card, table card. error.tsx exists.
- **Files to change:** `apps/web/src/app/(app)/finance/period-close/loading.tsx`
- **Fix steps:**
  1. Build a skeleton with header bars, four stat blocks, a form card block and a table block; share one helper with opening-balances/loading.tsx (e.g. PageSkeleton with props stats, blocks).
- **Acceptance:**
  - Loading state shows four stat placeholders and table placeholder without layout shift.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-OPENING-BALANCES-07


---
## /finance/pfms  —  `finance/pfms.html`

- **Source:** `apps/web/src/app/(app)/finance/pfms/page.tsx`
- **Design reference:** `redesign/finance/pfms.html`

### GAP-FINANCE-PFMS-01  ·  HIGH  ·  confirmed  ·  theme DSC-SIGNING (was UUID)

- [x] **Status** — PR #1855 (merged): DSC-signed PFMS batches + release hardening via #1853/#1856 in #1855
- **First-pass claim:** Sign asks the officer to paste a "Signature payload" (up to 8,192 characters) and a certificate reference by hand (SignBatchAction.tsx:51-56, textarea), i.e. the digital signature is produced outside the app and pasted in; there is no DSC / eSign integration on screen, so the "signed" state is only as trustworthy as the paste.
- **Verified evidence:** apps/web/src/app/(app)/finance/pfms/SignBatchAction.tsx:96-106 (certificateRef text input, maxLength 256) and :117-128 (signaturePayload textarea, maxLength 8192); POST v1/finance/pfms/${batchId}/sign at :51-57 sends both strings verbatim after trim(). Nothing on screen calls a DSC token, eMudhra/emSigner or eSign; the signature is produced elsewhere and pasted. Whether finance-service cryptographically verifies the payload cannot be seen (services/finance-service is absent from the snapshot). The suggested fix text (EntityPicker) does not apply; that component does not exist and this is not an id-picker problem.
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/SignBatchAction.tsx`, `apps/web/src/messages/en.json`, `(backend) services/finance-service/src/modules/pfms/routes.ts`
- **Fix steps:**
  1. Decision first: choose the signing channel (local DSC signer/emSigner client, or eSign gateway). Do not build UI until chosen.
  2. Backend: confirm sign route verifies signature over the batch digest against the certificate and stores signer, certificate serial, signedAt; add GET digest-to-sign endpoint if missing.
  3. Web: in SignBatchAction replace the payload textarea with a 'Sign with DSC' step that fetches the digest, calls the local signer, and posts the result automatically; keep certificateRef read-only from the signer response.
  4. Keep manual paste only behind a feature flag / admin role for sandbox use, labelled 'testing only'.
  5. Show signer name and certificate serial in the batch row after success (BatchesPanel) so signed state is attributable.
- **Acceptance:**
  - With signer available, clicking Sign on a pending batch signs without any pasted text and the row shows signed with signer name.
  - Backend rejects a payload that does not verify against the digest (400) and the dialog shows the error.
  - Without the flag, no textarea for signature is rendered.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Irreversible government payment signing; a wrong or forgeable signature path is a compliance risk. Integration choice is external to the repo.

### GAP-FINANCE-PFMS-02  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** Amounts on Submit Payment, Generate Salary Bill and Generate Payment Advice are typed in paise ("e.g. 1500000 for ₹15,000.00", en.json pfmsSubmitPaymentForm.amountPlaceholder); a clerk who types rupees releases a payment 100x too small (or, typing 15000000 for ₹1.5 lakh, 100x too large) into a real gateway, and the confirm copy for the Submit form does not restate the amount in rupees.
- **Verified evidence:** Paise entry is real for SubmitPaymentForm only in its risky form: label 'Amount, in paise', placeholder 'e.g. 1500000 for ₹15,000.00' (en.json ~3652-3653), regex ^\d+$ at SubmitPaymentForm.tsx:83, amount posted as string :104. Its confirm text (en.json ~3664 confirmDescription) shows only referenceId and beneficiaryCode, and there is no live rupee preview, so the 100x error is invisible. Overstated for the other two forms: SalaryBillForm.tsx:142,224,321 and PaymentAdviceForm.tsx:154,265-273,325 both show a formatMoney(...) preview under the field and restate the amount in the confirm dialog. (Also PaymentAdviceForm.tsx:130 and SalaryBillForm.tsx:117 use Number() on the paise string, which loses precision above 2^53 paise.) Whether the gateway is live or sandbox is a separate issue (PFMS-05).
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/SubmitPaymentForm.tsx`, `apps/web/src/app/(app)/finance/pfms/SalaryBillForm.tsx`, `apps/web/src/app/(app)/finance/pfms/PaymentAdviceForm.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add parseRupeesToPaise(input): string|null in lib/formatters.ts (string-based, strips Indian commas, accepts up to 2 decimals, returns digit string; no float math). Also used by RECURRING-ENTRIES-05.
  2. SubmitPaymentForm: add a live formatMoney(amount) preview span under the input (copy PaymentAdviceForm.tsx:265) and pass amount into t.rich('confirmDescription') with the rupee figure; update en.json confirmDescription.
  3. Change all three forms to accept rupees (label 'Amount (₹)') and convert with parseRupeesToPaise before POST, keeping the API contract in paise; if product prefers paise entry, keep it but make the preview mandatory in confirm.
  4. Stop Number()-ing the paise string in PaymentAdviceForm/SalaryBillForm; send as string if the backend schema allows, else guard with Number.isSafeInteger.
- **Acceptance:**
  - Unit test parseRupeesToPaise: '15,000' -> '1500000', '1,20,000.50' -> '12000050', '12.345' -> null, '' -> null.
  - Component test: typing 1500000 in SubmitPaymentForm shows '₹15,000.00' under the field and in the confirm dialog.
  - Submitting a payment posts amount '1500000' for input '15000' (rupee mode).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: switching unit from paise to rupees changes clerk habits; ship with preview and release note, and test the conversion thoroughly.
- **Depends on:** GAP-FINANCE-RECURRING-ENTRIES-05

### GAP-FINANCE-PFMS-03  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** The bank file contains beneficiary account numbers, IFSC and amounts and is downloaded to the local machine after a single confirm (BankFileAction.tsx:28-37; en.json pfmsBankFileAction) with only a "handle per policy" sentence: no reason, no audit prompt, no role gate beyond FINANCE_ROLES, no masking or expiry (DPDP).
- **Verified evidence:** BankFileAction.tsx:26-40: after one ConfirmDialog it does GET v1/finance/pfms/${batchId}/bank-file, builds a blob and auto-downloads pfms_${pfmsId}.csv; en.json pfmsBankFileAction.description (~3541) says only 'Handle the downloaded file per your department's data-handling policy'. No reason field, no client-side audit call, no expiry. Access is only the /finance layout gate (FINANCE_ROLES in lib/auth/workRoles.ts:32 includes audit_officer, procurement_officer, budget_officer) plus server checks that cannot be seen. Whether finance-service emits an audit event on the GET is cannot-verify (service absent); CLAUDE.md rule 8 requires it for mutations, and a bank-file generation is a sensitive read. The suggested <Masked> fix does not fit: the NEFT file must contain full account numbers, so masking would break its purpose.
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/BankFileAction.tsx`, `apps/web/src/app/(app)/finance/pfms/BatchesPanel.tsx`, `apps/web/src/app/(app)/finance/pfms/page.tsx`, `apps/web/src/messages/en.json`, `(backend) services/finance-service/src/modules/pfms/routes.ts`
- **Fix steps:**
  1. Backend: verify bank-file route requires a narrow role set (e.g. finance_officer, finance_admin, payroll_admin) and emits an audit event with actor, batchId and IP; add a required 'reason' query/header if decision says so.
  2. Web: compute canDownloadBankFile from getSessionRoles() in page.tsx (same pattern as period-close/page.tsx:50) and pass to BatchesPanel -> BankFileAction; hide/disable otherwise.
  3. BankFileAction: add a required reason text field inside the ConfirmDialog description (like SignBatchAction's fields) and send it to the endpoint.
  4. Update en.json description to state that the download is logged and that the file must be deleted after upload to the bank/SFTP.
  5. Consider Content-Disposition + short-lived signed URL instead of client blob if backend supports it.
- **Acceptance:**
  - A user with role audit_officer sees no enabled Bank File button (component test with roles).
  - Confirming without a reason shows a field error and does not call the API.
  - Backend test: each successful GET writes one audit event containing batchId and actor.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII (beneficiary bank accounts) and DPDP exposure; narrowing roles may block a legitimate payroll_admin workflow, so confirm the role list with Finance.

### GAP-FINANCE-PFMS-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was LOADING)

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** page.tsx:60 does BigInt(b.amountMinor || "0") over the API string; a single non-integer amountMinor makes the whole server page throw into error.tsx instead of degrading (BigInt("12.50") throws).
- **Verified evidence:** pfms/page.tsx:60 does batches.reduce((sum, b) => sum + BigInt(b.amountMinor || "0"), 0n). BigInt('12.50') or BigInt('abc') throws a SyntaxError in the server component, which falls to pfms/error.tsx (RouteError with reset, backHref /finance), so the whole page is lost for one bad row. types.ts:20 documents amountMinor as an exact decimal string, so a fractional value would be a backend contract break; risk is low but real. formatMoney (lib/formatters.ts:90) already wraps parsing in try/catch and returns a dash, so the table cell degrades safely while the stat card does not. Theme LOADING is wrong; this is input robustness.
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a small helper sumMinor(values: (string|null|undefined)[]): { total: bigint; invalid: number } in lib/formatters.ts using /^-?\d+$/ before BigInt.
  2. In page.tsx replace the reduce at :60 with the helper; render StatCard value as '—' when invalid > 0 and show a DataSourceBadge/note 'N batches have unreadable amounts'.
  3. Add a unit test for the helper.
- **Acceptance:**
  - sumMinor(['100','abc','250']) returns total 350n and invalid 1.
  - Page renders with a batch whose amountMinor is '12.50' (no error boundary) and the Total stat shows a dash with a note.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only changes a stat card.

### GAP-FINANCE-PFMS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** The sandbox / live mode is only learnt after a submit or status response (PaymentsPanel.tsx:37-44, onModeObserved); before that the Submit button looks identical whether it reaches the government gateway or simulates.
- **Verified evidence:** PaymentsPanel.tsx:33 mode state starts null; the sandbox banner renders only when mode is set and not 'live' (:37-44), and mode is set only via onModeObserved after a submit/lookup response (SubmitPaymentForm.tsx:113). The header comment (:23-29) states there is no status endpoint to read upfront, and types.ts:33-41 says the backend does not emit mode yet, so today the banner may never appear even after submitting. Before that the Submit button is identical for sandbox and live; only the danger-styled confirm copy says 'initiates a real payment submission' (en.json ~3664), which is wrong in sandbox. Backend endpoint cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/page.tsx`, `apps/web/src/app/(app)/finance/pfms/PaymentsPanel.tsx`, `apps/web/src/app/(app)/finance/pfms/types.ts`, `apps/web/src/app/(app)/finance/pfms/SubmitPaymentForm.tsx`, `(backend) services/finance-service/src/modules/pfms/routes.ts`
- **Fix steps:**
  1. Backend: add mode ('sandbox'|'live') to GET /v1/finance/pfms/config (or a new /status) derived from PFMS_ENABLED and credentials.
  2. types.ts: add mode?: PfmsMode to PfmsConfig.
  3. page.tsx: pass config.mode to PfmsConsole -> PaymentsPanel as initialMode; seed useState with it.
  4. PaymentsPanel: render a persistent badge 'Sandbox - not sent to PFMS' or 'LIVE' at the top of the Payments tab, and treat unknown mode as 'Mode unknown' (never assume live).
  5. SubmitPaymentForm: make confirm copy and submit button label depend on mode (Submit to PFMS vs Simulate).
- **Acceptance:**
  - Opening Payments tab with config.mode='sandbox' shows the sandbox banner before any submit.
  - With mode missing the UI shows 'Mode unknown' and the confirm copy does not claim a real payment.
  - Component test covers live, sandbox and unknown.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Payments: users may currently believe sandbox submissions are real (or vice versa); low regression risk on the UI itself.

### GAP-FINANCE-PFMS-06  ·  MEDIUM  ·  partly  ·  theme NAVUX

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** All six operations (batches, config, four forms) live under one page and one Tabs control, and Payments stacks four unrelated forms in a single scroll; an officer looking for advice status must scroll past three forms.
- **Verified evidence:** Mis-described: PfmsConsole.tsx:24-38 has three tabs (Batches, Config, Payments), not six. The valid part is PaymentsPanel.tsx:45-48, which stacks SubmitPaymentForm, PaymentStatusLookup, SalaryBillForm and PaymentAdviceForm (with AdviceStatusLookup rendered last, PaymentAdviceForm.tsx ~330) in one scroll, so payment-advice status is below three forms. Tabs (ds/Tabs) uses the label string as identity, so labels must stay unique. Mobile table transform does not exist: DataTable only wraps in .tbl-wrap with overflow-x:auto (civitas-ds.css:132).
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/PaymentsPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. In PaymentsPanel, add a second Tabs level with labels Submit Payment, Payment Status, Salary Bill, Payment Advice (add keys to pfmsPaymentsPanel in en.json).
  2. Render only the active form; keep each form's state by lifting nothing (accept reset on tab switch) or keep all mounted and hide with the hidden attribute to preserve typed input.
  3. Keep onModeObserved wired to every form so the mode banner stays above the tabs.
- **Acceptance:**
  - Payments tab shows four sub-tabs; selecting Payment Advice shows only that form and its status lookup.
  - Typing in Salary Bill, switching sub-tab and back keeps the typed values (if kept mounted).
  - Keyboard: sub-tabs reachable and labelled.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; unmounting forms would silently drop half-typed payment data, so prefer keeping them mounted.

### GAP-FINANCE-PFMS-07  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Payee Account No. and Payee IFSC are entered in plain text and echoed with no masking in the advice flow (PaymentAdviceForm.tsx), and Bill ID is a raw UUID the clerk must copy from elsewhere.
- **Verified evidence:** True in part: PaymentAdviceForm.tsx:205-217 payee account is a plain text input (maxLength 32), IFSC :232-245, and billId is a raw UUID field validated by uuidRe at :95-101 that the clerk must copy from elsewhere. Overstated: the value is not echoed anywhere; the confirm text shows only payeeName and amount (en.json pfmsPaymentAdviceForm.confirmDescription ~3588) and submit clears the fields (:141). Masking a typed field would hinder verification and no shared <Masked> component exists (grep found none in apps/web or packages/ui-kit). A bills list loader exists: getFinanceBills in app/_data/loaders.ts:1891 (GET /api/v1/finance/bills).
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/PaymentAdviceForm.tsx`, `apps/web/src/app/(app)/finance/pfms/page.tsx`, `apps/web/src/app/(app)/finance/pfms/PaymentsPanel.tsx`
- **Fix steps:**
  1. Load approved/payable bills in page.tsx via getFinanceBills and pass as bills prop through PfmsConsole and PaymentsPanel.
  2. Replace the Bill ID text input with a <select> or SmartCombobox (app/_components/SmartCombobox.tsx) showing bill number, vendor and amount; store the id internally.
  3. Prefill payeeName, amount and payee bank details from the bill where the API exposes them (verify BillSummary fields first).
  4. Set autoComplete='off' on account/IFSC inputs and add an 'Confirm account number' re-entry field instead of masking.
  5. Do not build <Masked> for this form.
- **Acceptance:**
  - Selecting a bill fills billId, payeeName and amount without any UUID being typed or shown.
  - Account number is entered twice; mismatch blocks submit with an inline error.
  - Browser autofill does not offer stored values for the account field.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Payments: prefilled values must still be editable/verified; depends on BillSummary carrying payee and bank data (not confirmed).

### GAP-FINANCE-PFMS-08  ·  LOW  ·  partly  ·  theme DEADROUTE

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Route duplicates /finance/treasury/pfms (read-only list of the same batches); the finance home has two PFMS tiles pointing at near-identical descriptions (finance/page.tsx tiles).
- **Verified evidence:** treasury/pfms/page.tsx (getFinancePFMSScrolls, loaders.ts:1948) reads the same /api/v1/finance/pfms/batches endpoint as pfms/page.tsx:10, as a read-only table with Total/Signed/Pending/Submitted stats. finance/page.tsx has two tiles: :29 'PFMS Integration' (Treasury & Banking, /finance/treasury/pfms) and :59 'PFMS Operations' (Statutory, /finance/pfms). Their descriptions differ ('scroll tracking and beneficiary verification' vs 'batches, salary bills, payment advice, bank file and e-sign') and sit in different sections, so 'near-identical descriptions' is overstated; the real problem is two overlapping routes over one dataset and a misleading 'beneficiary verification' claim on the read-only page.
- **Files to change:** `apps/web/src/app/(app)/finance/page.tsx`, `apps/web/src/app/(app)/finance/treasury/pfms/page.tsx`
- **Fix steps:**
  1. Decision: keep both or merge. Recommended: keep /finance/pfms as the only PFMS route.
  2. Make treasury/pfms/page.tsx redirect() to /finance/pfms and delete PFMSTable.tsx if unused elsewhere.
  3. Remove the :29 tile from finance/page.tsx (or repoint it to /finance/pfms) and rename the remaining tile 'PFMS Payments and Batches'.
  4. Update any sidebar/nav manifest entries (app/_components/navRouteManifest.ts) that point to the old route.
- **Acceptance:**
  - GET /finance/treasury/pfms returns a redirect to /finance/pfms.
  - Finance home shows exactly one PFMS tile.
  - No broken links in navRouteManifest.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; users with bookmarks are covered by the redirect.

### GAP-FINANCE-PFMS-09  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** loading.tsx is a bare skeleton div (loading.tsx).
- **Verified evidence:** pfms/loading.tsx (6 lines) renders a single <div className='skeleton'> inside page-main wrap; page has PageHeader, four StatCards and a tabbed Card. It does use t('msg.loading') for the label, so i18n is fine.
- **Files to change:** `apps/web/src/app/(app)/finance/pfms/loading.tsx`
- **Fix steps:**
  1. Build a shared FinancePageSkeleton (PageHeader placeholder, StatGrid of 4 skeleton cards, table skeleton) using ds/Skeleton.tsx and reuse it in the four loading.tsx files of this chunk.
  2. Keep role='status' and aria-label from t('loading').
  3. Replace the body of pfms/loading.tsx with the shared skeleton.
- **Acceptance:**
  - Throttled navigation to /finance/pfms shows header and four card placeholders before content.
  - Screen reader announces loading once.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** shared FinancePageSkeleton


---
## /finance/reconciliation  —  `finance/reconciliation.html`

- **Source:** `apps/web/src/app/(app)/finance/reconciliation/page.tsx`
- **Design reference:** `redesign/finance/reconciliation.html`

### GAP-FINANCE-RECONCILIATION-01  ·  HIGH  ·  partly  ·  theme AUDIT (was MONEY)

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Resolve and Write off send only { action } (ExceptionsPanel.tsx:74-76) although the row type carries resolutionNote, resolvedBy and resolvedAt (:24-26): no reason or note is captured, and a write-off of any size (₹30 or ₹45,000) is one confirm with no second approver, breaching the audited maker-checker rule in CLAUDE.md.
- **Verified evidence:** ExceptionsPanel.tsx:72-75 POSTs { action } only; resolutionNote/resolvedBy/resolvedAt exist on ExceptionRow (:26-28) but no UI captures or displays them. Write off of any amount is one ConfirmDialog (:178-196). Mis-cited rule: CLAUDE.md contains no maker-checker rule (grep of CLAUDE.md, docs, .claude); it requires audit events on every mutation (rule 8), enforced server-side (cannot verify: finance recon route absent). Theme MONEY is off; this is a control/audit gap.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/ExceptionsPanel.tsx`, `(backend) reconciliation exception action route`
- **Fix steps:**
  1. Add required Reason textarea to the ConfirmDialog for resolve and write_off (see DETAIL-01) and send it as note.
  2. Show resolutionNote, resolvedBy and resolvedAt in an expandable row or extra 'Resolution' column for resolved/written_off rows.
  3. Product/finance decision on a write-off threshold requiring a second approver; if yes, backend needs an approval state.
  4. Verify backend emits the audit event for exception actions.
- **Acceptance:**
  - Write off cannot be confirmed without a reason of min length.
  - A written-off row displays reason, who and when.
  - Backend test asserts audit event on action.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Financial write-offs: control gap, but adding maker-checker is a process change beyond UI.

### GAP-FINANCE-RECONCILIATION-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Unlike sibling finance actions, the dialog description does not show the amount or delta at stake: it names only break key, type, field and provider (ExceptionsPanel.tsx:178-197), so the officer confirms a financial write-off without seeing the figure.
- **Verified evidence:** ExceptionsPanel.tsx:185-193 description contains action label, breakKey, breakType, field and provider only; row.deltaMinor (:23) and source/target values (:20-21) are available but not shown, so the officer confirms a write-off blind. Delta is shown in the table (:109-114) but the modal covers the table on mobile. The claim 'unlike sibling finance actions' was not checked here; SalaryBillForm/PaymentAdviceForm do restate the amount.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/ExceptionsPanel.tsx`
- **Fix steps:**
  1. In the ConfirmDialog description add a definition list: Source value, Target value, Delta using the same formatting as the columns (formatMoney when fieldType === 'amount', else raw).
  2. Make Delta bold and, for write_off, prefix 'You are writing off'.
  3. Extract a small formatBreakValue(row, value) helper reused by the columns to avoid duplication.
- **Acceptance:**
  - Opening Write off on a row with deltaMinor 4500000 shows '₹45,000.00' in the dialog.
  - Non-amount breaks show raw source/target values.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-RECONCILIATION-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Actions render for every FINANCE_ROLES member (ExceptionsPanel.tsx:132-160, no role prop, unlike period-close canReopen); an audit_officer sees Write off buttons a backend guard must reject.
- **Verified evidence:** ExceptionsPanel.tsx:131-156 shows actions purely by row status (AVAILABLE_ACTIONS :41-46), with no role input; period-close/page.tsx:50 by contrast computes canReopen from getSessionRoles() and passes it to PeriodsTable (:83, filter at PeriodsTable.tsx:95). audit_officer is in FINANCE_ROLES (lib/auth/workRoles.ts:32) so it sees Write off. Backend guard cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/ExceptionsPanel.tsx`, `apps/web/src/app/(app)/finance/reconciliation/page.tsx`, `apps/web/src/app/(app)/finance/reconciliation/[id]/page.tsx`
- **Fix steps:**
  1. Add props canInvestigate/canResolve/canWriteOff (booleans) to ExceptionsPanel and filter AVAILABLE_ACTIONS accordingly.
  2. Compute them in both pages from getSessionRoles(); confirm role lists with the recon route guards (e.g. write_off: finance_admin, super_admin).
  3. Optionally a shared lib/auth helper hasAnyRole(roles, list) reused by period-close.
  4. Show a read-only hint when the user can see but not act.
- **Acceptance:**
  - Component test: with canWriteOff=false the Write off button is absent.
  - audit_officer session sees no action buttons; finance_admin sees all.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong role list would hide actions from legitimate users, so confirm with Finance.

### GAP-FINANCE-RECONCILIATION-04  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Status pills: "open" maps to green (StatusPill.tsx:6-38) although an open break is the item needing attention, while "resolved", "investigating" and "written_off" are unmapped neutral; open exceptions look healthiest.
- **Verified evidence:** ui/StatusPill.tsx:12 maps 'open' to 'good' (green) confirmed. 'investigating', 'resolved' and 'written_off' are absent from STATUS_MAP (:5-39) and fall back to 'info' (blue), not neutral grey; label comes from humanizeStatus ('Written Off'). ExceptionsPanel renders status with cellType 'status' (:125 -> DataTable.tsx:127). Changing the global 'open' tone is risky: 'open' is also used as a status elsewhere (crm service-requests, grants schemes, field visits) where green may be intended.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/ExceptionsPanel.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. In ExceptionsPanel replace the status column with a render using StatusPill with an explicit status mapping: open -> 'overdue' (bad), investigating -> 'pending' (warn), resolved -> 'closed' or 'cleared', written_off -> 'closed' (mut), keeping label via humanize.
  2. Alternatively add a `tone` prop to StatusPill so callers override without changing the global map.
  3. Do not change STATUS_MAP.open unless all other 'open' consumers are reviewed.
  4. Add a test asserting tone per status.
- **Acceptance:**
  - Open exception renders a red/warn pill, not green.
  - Resolved renders green/neutral, written off neutral, investigating amber.
  - Other pages using 'open' are unchanged (snapshot).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Global StatusPill change could recolour unrelated modules; use a local mapping.

### GAP-FINANCE-RECONCILIATION-05  ·  MEDIUM  ·  partly  ·  theme NAVUX

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Exceptions table has 11 columns with nested money, severity and status (ExceptionsPanel.tsx:90-130); it relies on the DataTable mobile transform and is the densest table in the module.
- **Verified evidence:** ExceptionsPanel.tsx:90-157 defines 11 columns (break key, provider, type, field, source, target, delta, severity, status, detected, actions), so the density claim is true. But there is no DataTable mobile transform: DataTable.tsx:322-323 wraps the table in .tbl-wrap (overflow-x:auto, civitas-ds.css:132) and nothing else, so on phones the table scrolls horizontally with actions off screen.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/ExceptionsPanel.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Short term: hide low-value columns (provider, type, detected) below a breakpoint via a column `hideBelow` option, or merge Source/Target/Delta into one 'Values' cell.
  2. Long term: add a stacked-card mobile mode to DataTable (data-label attributes plus CSS at max-width 640px) used by all tables.
  3. Keep the Actions column first or sticky on small screens.
- **Acceptance:**
  - At 375px width the row's action buttons are reachable without horizontal scroll.
  - Desktop layout unchanged.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing shared DataTable affects every table; ship behind an opt-in prop.

### GAP-FINANCE-RECONCILIATION-06  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Stat cards show "—" per failed section, but all badges use the same generic text with no retry; five parallel requests mean one slow provider endpoint delays the whole page (page.tsx:61-67).
- **Verified evidence:** reconciliation/page.tsx:92-95 stat cards show '—' when their own source is 'error' (true); the Runs/Exceptions cards swap to DataSourceBadge when errored and empty (:99-101, :107-109) and Providers likewise (:167-168). All badges are the generic DataSourceBadge; no retry control (RefreshErrorState exists in ds and is used for this purpose). Requests are five parallel fetches awaited together with Promise.all (:61-67), so the slowest endpoint blocks the whole render; there is no per-section Suspense. A partial error with data present (runs.length > 0) shows only the header badge (:88).
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/page.tsx`
- **Fix steps:**
  1. Replace per-card DataSourceBadge with <RefreshErrorState error={...} backHref='/finance'/> (or a compact variant) so each failed section has Retry.
  2. Split sections into async server components wrapped in <Suspense fallback={skeleton}> so the runs table renders without waiting for subledger calls.
  3. Keep '—' on stat cards for failed sources.
  4. Add fetch timeout in fetchJson options if slow providers are a real issue (verify).
- **Acceptance:**
  - Killing the /recon/providers endpoint leaves the rest of the page rendered and shows a Retry in the Providers card.
  - Slow subledger endpoint no longer delays the runs table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; streaming changes render order only.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-RECONCILIATION-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** The Runs table is not filtered to unbalanced runs and has no run-trigger action; "Last run started" is taken from runs[0] and assumes the API returns newest first (page.tsx:184-187).
- **Verified evidence:** reconciliation/page.tsx:80 counts unbalanced runs for a stat, but RunsTable (RunsTable.tsx:31-59) lists all runs with a text filter only and has no run-trigger action; the trigger endpoint cannot be verified. Footer :182-186 uses runs[0]?.startedAt as 'Last run started' with no sort, so if the API is not newest-first it shows the wrong date.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/page.tsx`, `apps/web/src/app/(app)/finance/reconciliation/RunsTable.tsx`
- **Fix steps:**
  1. Compute lastRun as the max startedAt across runs (Date.parse) instead of runs[0].
  2. Add an 'Unbalanced only' Segmented filter to RunsTable using components in ds/Segmented.
  3. Only add a Run now button if a trigger route exists (ask backend); otherwise leave it out.
- **Acceptance:**
  - Unsorted API response still shows the latest date in the footer.
  - Toggle 'Unbalanced only' shows only balanced=false runs.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-RECONCILIATION-08  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** loading.tsx is a bare skeleton div (loading.tsx).
- **Verified evidence:** reconciliation/loading.tsx is 3 lines: a single .skeleton div with hard-coded 'Loading…'. Page has header, four stat cards, three cards with tables.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/loading.tsx`
- **Fix steps:**
  1. Use the shared FinancePageSkeleton with stat grid and two table blocks.
  2. Localise the aria-label via t('msg.loading') as pfms/loading.tsx does.
- **Acceptance:**
  - Loading state shows header and stat and table placeholders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** shared FinancePageSkeleton


---
## /finance/reconciliation/[id]  —  `finance/reconciliation-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/reconciliation/[id]/page.tsx`
- **Design reference:** `redesign/finance/reconciliation-detail.html`

### GAP-FINANCE-RECONCILIATION-DETAIL-01  ·  HIGH  ·  partly  ·  theme AUDIT (was CONFIRM)

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Resolve and Write off from this page reuse ExceptionsPanel, so they carry the same defect as the workbench: only { action } is posted, no reason or note, and no second approver on a write-off (ExceptionsPanel.tsx:74-76).
- **Verified evidence:** [id]/page.tsx:50 renders the same ExceptionsPanel; its runAction (ExceptionsPanel.tsx:67-88) POSTs v1/finance/recon/exceptions/${id}/action with body { action } only (:72-75, obs said 74-76). ExceptionRow carries resolutionNote/resolvedBy/resolvedAt (:26-28) but the UI never sends a note, and write_off shows one confirm (:178-196). Overstated: 'no second approver' is not a CLAUDE.md rule; grep of CLAUDE.md, docs/ and .claude finds no maker-checker requirement. CLAUDE.md rule 8 (every mutation emits an audit event) is the applicable rule and is server-side (cannot verify; recon service absent). Whether the action endpoint accepts a note is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/ExceptionsPanel.tsx`, `(backend) reconciliation action route in finance-service`
- **Fix steps:**
  1. Backend: confirm the action schema accepts a note (resolutionNote) and requires it for resolve and write_off; emit audit event with actor, action and delta.
  2. ExceptionsPanel: add a required textarea 'Reason' (min 10 chars) inside the ConfirmDialog description for resolve and write_off, with inline error and focus handling like SignBatchAction.
  3. Send { action, note } from runAction; clear note on cancel/success.
  4. Product decision: does write-off above a threshold need a second approver? If yes, add a pending_approval status and a separate approve action (needs backend).
- **Acceptance:**
  - Confirming Write off with empty reason is blocked with an inline error and no request is sent.
  - Request body contains action and note; the row later shows resolutionNote.
  - Component test covers both run pages via the shared component.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Financial write-off without justification; adding a mandatory field changes the operator flow.
- **Depends on:** GAP-FINANCE-RECONCILIATION-01

### GAP-FINANCE-RECONCILIATION-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** The run's own status, completedAt and balanced state are fetched (RunRow) but only balanced is shown, as a delta on the Breaks card (page.tsx:46); a run still "running" looks identical to a finished one.
- **Verified evidence:** RunRow (RunsTable.tsx:6-19) includes status and completedAt, and the workbench table shows a 'Run Status' column (:47). [id]/page.tsx:33-35 header shows only provider, systems and started date, and :43-46 stat cards show counts plus a Balanced/Unbalanced delta on Breaks; run.status and run.completedAt are never rendered, so a running run (counts still moving, balanced false) looks like a finished unbalanced one.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/[id]/page.tsx`
- **Fix steps:**
  1. Add a StatusPill status={run.status} next to the subtitle (PageHeader actions) and 'completed {formatIndianDate(run.completedAt)}' in the subtitle when present.
  2. When status is not completed/success show an info note 'Run still in progress; counts may change' and skip the Unbalanced red delta.
  3. Optionally add a Refresh button using router.refresh().
- **Acceptance:**
  - Run with status 'running' shows a pill 'Running' and the in-progress note.
  - Completed run shows completed date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Actual status enum values cannot be verified (recon library absent); StatusPill falls back to info tone.

### GAP-FINANCE-RECONCILIATION-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme FAILMASK (was LOADING)

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** A missing run calls notFound() and lands on finance/not-found.tsx, a bare EmptyState without breadcrumb, back link or the Finance header (not-found.tsx:1-10), while the sibling detail pages render their own "not found" inside the page chrome.
- **Verified evidence:** Different from the description: getRunDetail (page.tsx:11-20) uses fetchJson, which returns source 'error' for any non-OK response including 404 (apiClient.ts:139-143) and for a payload without data (mapResponse returns null -> 'invalid_payload', :154-158). notFound() at :26-28 fires only when source !== 'error' and data is null, which mapResponse makes unreachable, so a missing run actually renders the 'Reconciliation Run' card with the generic DataSourceBadge error (:53-57). finance/not-found.tsx (10 lines) is a bare EmptyState and, if reached, would show inside finance/layout.tsx (permission gate only) with no PageHeader, breadcrumb or back link, whereas vendors/[id], payments/[id], audit-paras/[id] and budget/sanctions/[id] render their own not-found in page chrome.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/[id]/page.tsx`, `apps/web/src/app/(app)/finance/not-found.tsx`
- **Fix steps:**
  1. In page.tsx read the LoaderResult status: if status === 404 render PageHeader (back='/finance/reconciliation') plus EmptyState 'Run not found' inline, like vendors/[id]/page.tsx.
  2. For other errors render <RefreshErrorState> with backHref instead of the bare badge.
  3. Remove the dead notFound() branch and the unused import (or keep only if a real 404 path is wired).
  4. Give finance/not-found.tsx a back link to /finance (LinkButton) so other finance 404s have navigation.
- **Acceptance:**
  - GET /finance/reconciliation/<unknown-uuid> (API 404) shows 'Run not found' with header and back link, HTTP page not blank.
  - API 500 shows RefreshErrorState with retry, not the not-found page.
  - Unit test on the page with mocked fetchJson results.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-FINANCE-RECONCILIATION-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme UX (was WIRING)

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Stat cards Source Count / Target Count / Matched are three raw counts; the difference between them (unmatched on each side) is never shown, and the "Breaks" figure does not link to the table below (page.tsx:42-47).
- **Verified evidence:** [id]/page.tsx:43-46 shows Source Count, Target Count, Matched (raw run fields) and Breaks with delta 'Balanced'/'Unbalanced' only. No unmatched-per-side figure and the Breaks card does not link to the Exceptions card below (no anchor id at :49). Semantics of matchedCount vs counts are defined in the reconciliation library, which is not in the snapshot, so 'unmatched = count - matched' must be verified before display. Theme WIRING is wrong; nothing is mis-mapped.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/[id]/page.tsx`
- **Fix steps:**
  1. Verify with the recon engine owner how matchedCount relates to sourceCount and targetCount.
  2. Add sub-labels/delta on Source and Target cards: '{count - matchedCount} unmatched'.
  3. Give the Exceptions Card an id='exceptions' and wrap the Breaks StatCard value in an anchor (or add a 'View breaks' link) to #exceptions.
  4. Add aria labels for the link.
- **Acceptance:**
  - Run with 100 source, 98 target, 95 matched shows 5 and 3 unmatched.
  - Clicking Breaks scrolls to the exceptions table.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Showing a wrong derived number is worse than none; confirm semantics first.

### GAP-FINANCE-RECONCILIATION-DETAIL-05  ·  LOW  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Actions render for every FINANCE_ROLES member as on the workbench (no role gate in ExceptionsPanel).
- **Verified evidence:** ExceptionsPanel.tsx:131-156 renders actions for every row from AVAILABLE_ACTIONS by status only; the component takes no role prop. [id]/page.tsx:50 and reconciliation/page.tsx:110 pass only exceptions. The /finance layout admits all FINANCE_ROLES (audit_officer, procurement_officer, etc.; lib/auth/workRoles.ts:32). Server enforcement cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/ExceptionsPanel.tsx`, `apps/web/src/app/(app)/finance/reconciliation/[id]/page.tsx`, `apps/web/src/app/(app)/finance/reconciliation/page.tsx`
- **Fix steps:**
  1. Same change as GAP-FINANCE-RECONCILIATION-03: add canAct/canWriteOff props to ExceptionsPanel and compute them in both pages with getSessionRoles() (pattern: period-close/page.tsx:50).
  2. Hide or disable buttons with a title explaining the missing role.
  3. Confirm real role list with backend route guards.
- **Acceptance:**
  - audit_officer sees exceptions read-only with no action buttons on the detail page.
  - finance_admin still sees all actions.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; UI-only, server remains authority.
- **Depends on:** GAP-FINANCE-RECONCILIATION-03

### GAP-FINANCE-RECONCILIATION-DETAIL-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** loading.tsx is the shared bare skeleton div (loading.tsx).
- **Verified evidence:** reconciliation/[id]/loading.tsx is 3 lines: one .skeleton div with hard-coded English aria-label 'Loading…' (no i18n, unlike pfms/loading.tsx). Page has header, four stat cards and an exceptions table.
- **Files to change:** `apps/web/src/app/(app)/finance/reconciliation/[id]/loading.tsx`
- **Fix steps:**
  1. Use the shared FinancePageSkeleton (header, 4 stat placeholders, table placeholder).
  2. Keep role='status' aria-live and an accessible label.
- **Acceptance:**
  - Throttled load shows header and four placeholders, then swaps without layout jump.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** shared FinancePageSkeleton


---
## /finance/recurring-entries  —  `finance/recurring-entries.html`

- **Source:** `apps/web/src/app/(app)/finance/recurring-entries/page.tsx`
- **Design reference:** `redesign/finance/recurring-entries.html`

### GAP-FINANCE-RECURRING-ENTRIES-01  ·  HIGH  ·  partly  ·  theme LIFECYCLE (was MONEY)

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** Templates are create-only: the table has no row link and no action, so a wrong standing instruction (say ₹1,20,000 rent) cannot be paused, edited or ended from the UI, and it keeps posting journals on schedule; the only status shown is active / inactive with no way to change it (page.tsx:128-141).
- **Verified evidence:** recurring-entries/page.tsx:102-139: the DataTable has no rowLinkKey, no actions column and no edit/pause control; status column is a read-only StatusPill of active/inactive (statusLabel :54). The only web calls to the endpoint are the list GET (page.tsx:81) and create POST (RecurringEntryForm.tsx:100-104); grep finds no PATCH/DELETE in apps/web. Whether the backend offers update/pause routes, and that active templates auto-post, cannot be verified (finance-service absent). Theme MONEY is wrong; this is a missing lifecycle capability.
- **Files to change:** `apps/web/src/app/(app)/finance/recurring-entries/page.tsx`, `apps/web/src/app/(app)/finance/recurring-entries/RecurringEntryActions.tsx`, `(backend) services/finance-service recurring-entries routes`
- **Fix steps:**
  1. Backend check: confirm or add PATCH /v1/finance/recurring-entries/:id (is_active, end_date) and audit events.
  2. Add a new client component RecurringEntryActions with Pause/Resume and End now buttons using ConfirmDialog (show name, amount via formatMoney, next run) and a required reason.
  3. Add an Actions column to the DataTable in page.tsx (pattern: PeriodsTable/ExceptionsPanel), and pass amount and nextRun fields already in RecurringEntryRow.
  4. Call router.refresh() on success; show toast.
  5. Optionally a detail page /finance/recurring-entries/[id] for editing.
- **Acceptance:**
  - Pause on an active template sets it to inactive and the Active stat decrements after refresh.
  - Confirm dialog states name, amount in rupees and next run date.
  - Inactive template can be resumed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money: a wrong standing instruction keeps posting until stopped; pause/end must be audited and role-gated.
- **Depends on:** GAP-FINANCE-RECURRING-ENTRIES-02

### GAP-FINANCE-RECURRING-ENTRIES-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** No reason, approving authority or maker-checker on a standing journal that will auto-post on a schedule (RecurringEntryForm.tsx:100-118 posts the template directly), against the "every mutation audited" rule in CLAUDE.md; the confirm dialog also omits amount and next run date from what it asks to confirm (:300-316).
- **Verified evidence:** RecurringEntryForm.tsx:96-116 posts the template straight to v1/finance/recurring-entries with no reason or approver field; the ConfirmDialog (:300-315) states frequency, name, debit and credit accounts but not the amount or first/next run date, both of which are in local state (amount, nextRunDate). Overstated: maker-checker is not a CLAUDE.md rule (only 'every mutation emits an audit event', server-side and cannot be verified here). Creating a template is not itself a posting; approval is more meaningful at post time or for high amounts.
- **Files to change:** `apps/web/src/app/(app)/finance/recurring-entries/RecurringEntryForm.tsx`, `(backend) recurring-entries create route`
- **Fix steps:**
  1. ConfirmDialog description: add amount (formatMoney of parsed paise), next run date (formatIndianDate), end date or 'no end', and narration.
  2. Add an optional-or-required Reason/authority reference field if Finance requires it and send it as `reason` (needs backend field).
  3. Decide whether templates above a threshold need approval (backend state pending_approval) before any journal is generated.
  4. Confirm backend emits audit event on create.
- **Acceptance:**
  - Confirm dialog for 1,20,000 monthly rent shows '₹1,20,000.00' and next run 01 Nov 2026.
  - If reason is required, empty reason blocks submit.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money: recurring journals compound errors; the approval workflow is a business decision.
- **Depends on:** GAP-FINANCE-RECURRING-ENTRIES-05

### GAP-FINANCE-RECURRING-ENTRIES-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** mapAccountOptions returns null for an empty list (page.tsx:77), which fetchJson turns into a silent error, and the page discards that source (page.tsx:95-98): with no accounts the two selects are empty and nothing explains why.
- **Verified evidence:** page.tsx:77 returns null when the mapped list is empty; fetchJson treats null as invalid_payload (apiClient.ts:163-167) and returns source 'error' with empty data. Page destructures only { data: accounts } (:95-98), dropping the source, so both an empty chart of accounts and a failed/403 fetch look identical: the two selects (RecurringEntryForm.tsx:173,195) show only 'Select account…' with no explanation. It also logs a false error telemetry event for an empty list.
- **Files to change:** `apps/web/src/app/(app)/finance/recurring-entries/page.tsx`, `apps/web/src/app/(app)/finance/recurring-entries/RecurringEntryForm.tsx`
- **Fix steps:**
  1. Change line 77 to return mapped (empty array is valid).
  2. Capture source: `const { data: accounts, source: accountsSource }` and pass accountsError to the form.
  3. In RecurringEntryForm, when accountsError show an alert with RefreshErrorState/retry, and when accounts.length === 0 show 'No accounts defined. Create accounts in Chart of Accounts' with a link to /finance/chart-of-accounts; disable the submit button in both cases.
- **Acceptance:**
  - Empty accounts list shows the guidance message and a disabled Create button.
  - API failure shows an error state with Retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-RECURRING-ENTRIES-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Voucher Type is a free-text input capped at 20 characters, default "journal" (RecurringEntryForm.tsx:265-272) rather than the closed set of voucher types; a typo creates an unpostable template.
- **Verified evidence:** RecurringEntryForm.tsx:264-273 is a free-text input (maxLength 20, default 'journal' at :31); page.tsx:49 also defaults to 'journal'. Confirmed free-text. The allowed voucher type set and whether an unknown value makes the template unpostable cannot be verified (no voucher-type list or backend schema in the snapshot; only apiMappers.ts:974 mentions voucherType elsewhere).
- **Files to change:** `apps/web/src/app/(app)/finance/recurring-entries/RecurringEntryForm.tsx`
- **Fix steps:**
  1. Get the voucher type enum from the finance-service schema (or a GET voucher-types endpoint).
  2. Define VOUCHER_TYPES const and render a <select> like the Frequency field (:252-261).
  3. Send the value as before; validate with a zod enum at the form boundary.
- **Acceptance:**
  - Voucher Type shows a dropdown of allowed types with 'Journal' selected by default.
  - Cannot submit an arbitrary string.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low, but the enum must match the backend exactly.

### GAP-FINANCE-RECURRING-ENTRIES-05  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Amount is converted with parseFloat and Math.round(n*100) (RecurringEntryForm.tsx:14-17), so a lakh-formatted "1,20,000" parses to 1 and is saved as ₹1.00; the table then shows Amount with no per-row currency context.
- **Verified evidence:** RecurringEntryForm.tsx:14-17 rupeesToPaise uses parseFloat and Math.round(n*100): parseFloat('1,20,000') is 1 so the template is saved with amountMinor 100 (₹1.00); '12abc' parses to 12; float artefacts like 1.005 -> 100 are possible. Validation (:75-76) only rejects <=0/NaN. The result is sent as a JSON number (:110). No shared rupee parser exists (grep of lib finds none). Table shows Amount via cellType 'amount' (page.tsx:106, formatMoney), so a currency symbol is rendered; the 'no currency context' remark is overstated. Violates CLAUDE.md paise rule (no float math).
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/finance/recurring-entries/RecurringEntryForm.tsx`
- **Fix steps:**
  1. Create parseRupeesToPaise(input: string): string | null in lib/formatters.ts: trim, strip commas and spaces, require /^\d+(\.\d{1,2})?$/, build paise from integer and fractional parts with BigInt, no floats.
  2. Use it in validate() (error 'Enter a valid amount like 1,20,000.50') and in createEntry; send amountMinor as digit string if the backend schema allows, else Number after Number.isSafeInteger check.
  3. Show a live formatMoney preview under the field and in the confirm dialog.
  4. Add unit tests.
- **Acceptance:**
  - parseRupeesToPaise('1,20,000') === '12000000'; '1.005' -> null; '12abc' -> null.
  - Typing 1,20,000 posts amountMinor 12000000.
  - Preview under the field reads ₹1,20,000.00.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: high impact fix, low regression risk; check backend accepts string vs number.

### GAP-FINANCE-RECURRING-ENTRIES-06  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** Next Run and End Date are date inputs with no min: a Next Run in the past, or an End Date before Next Run, passes validation (RecurringEntryForm.tsx:67-90).
- **Verified evidence:** RecurringEntryForm.tsx validate() (:67-86) only requires nextRunDate to be non-empty; the date inputs (:225-235 next run, :241-247 end date) have no min/max, and no comparison of endDate against nextRunDate or nextRunDate against today. A past next run date or end before next run passes and is posted (:112-113). What the backend does with a past next run (immediate catch-up posting?) cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/recurring-entries/RecurringEntryForm.tsx`
- **Fix steps:**
  1. In validate() add: nextRunDate < today -> error 'Next run date cannot be in the past'; endDate && endDate < nextRunDate -> endDate error.
  2. Add endDate to FieldErrors and error id/aria wiring like other fields.
  3. Set min={today} on next run and min={nextRunDate} on end date inputs (compute today in local IST-safe format).
  4. Ideally define a zod schema for the form (per CLAUDE.md zod-at-boundary) and use it in validate().
- **Acceptance:**
  - Next run yesterday shows an inline error and focus moves to the field.
  - End date earlier than next run is rejected.
  - Valid dates submit.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; confirm whether back-dated templates are intentionally allowed for catch-up.

### GAP-FINANCE-RECURRING-ENTRIES-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1811 (merged)
- **First-pass claim:** loading.tsx is a bare skeleton div (loading.tsx).
- **Verified evidence:** recurring-entries/loading.tsx is 3 lines: one .skeleton div with hard-coded 'Loading…' aria-label; page has header, two stat cards, a form card and a table card.
- **Files to change:** `apps/web/src/app/(app)/finance/recurring-entries/loading.tsx`
- **Fix steps:**
  1. Use shared FinancePageSkeleton (header, 2 stat placeholders, form block, table block).
  2. Localise the label via t('msg.loading').
- **Acceptance:**
  - Throttled load shows placeholder header, stats, form and table blocks.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** shared FinancePageSkeleton


---
## /finance/revenue/challans  —  `finance/revenue-challans.html`

- **Source:** `apps/web/src/app/(app)/finance/revenue/challans/page.tsx`
- **Design reference:** `redesign/finance/revenue-challans.html`

### GAP-FINANCE-REVENUE-CHALLANS-01  ·  HIGH  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** The "Date" column prints createdAt with no formatter (ChallansTable.tsx:17 has no render/cellType for it), so the register shows a raw ISO timestamp such as 2026-09-26T09:40:00.000Z, while the detail page formats the same field with formatIndianDate (challans/[id]/page.tsx:42).
- **Verified evidence:** CT:12 column { key:'createdAt', label:'Date' } has no render or date cellType; DataTable cellValue (DT:124-139) falls to String(row[key]), so an ISO timestamp is shown raw. Detail page formats it with formatIndianDate (CD:42). Note formatIndianDate (lib/formatters.ts:2-7) emits dd/mm/yyyy in the runtime's timezone, not 'dd Mon yyyy' IST as the fix text says.
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/ChallansTable.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add a col.render for createdAt in ChallansTable: (r)=>formatIndianDate(r.createdAt).
  2. Preferably add cellType:'date' to DataTable Column (DT:47) and cellValue/export path (DT:268-270) calling formatIndianDate, then reuse across the finance tables.
  3. Pass timeZone:'Asia/Kolkata' in formatIndianDate so SSR (UTC) and browser agree.
  4. Ensure CSV export uses the same formatted value.
- **Acceptance:**
  - Row with createdAt 2026-09-26T09:40:00.000Z shows '26/09/2026'.
  - Null createdAt shows '—'.
  - Sorting by Date still orders chronologically (sort on raw value).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; sort must keep using the raw ISO value.
- **Depends on:** DataTable cellType:'date'

### GAP-FINANCE-REVENUE-CHALLANS-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** "Receipt Head" prints receiptHeadId, an internal id, not the head code or name a treasury clerk recognises (ChallansTable.tsx:17; challans/[id]/page.tsx:53).
- **Verified evidence:** Same as DETAIL-03: CT:12 prints receiptHeadId raw. Whether it is a code or a UUID cannot be confirmed (types/finance-service absent); no lookup exists in apps/web.
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/ChallansTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. See DETAIL-03: add receipt head code/name to payload or join via a receipt-heads loader.
  2. Replace the column with a render prop showing 'CODE - Name'; keep search working by including the display text in the filter (check DataTable filter uses raw keys).
- **Acceptance:**
  - List shows head code and name; filtering by head name matches.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-DETAIL-03

### GAP-FINANCE-REVENUE-CHALLANS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** "Pending" is computed as total minus verified (page.tsx:15), so any other status (rejected, cancelled, reconciled) is counted as pending and the two cards can mislead.
- **Verified evidence:** challans/page.tsx:6 verified = count of status==='verified'; :12 Pending = challans.length - verified. Any other status (rejected, cancelled, etc.) lands in Pending. The status enum is not visible (types absent), but the arithmetic is unconditional.
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/page.tsx`
- **Fix steps:**
  1. Compute pending explicitly: filter status in ['pending','submitted'] (confirm enum with finance-service).
  2. Optionally add an 'Other' or 'Rejected' card, or make cards sum to total.
  3. Extract a small countByStatus helper so cards and table pills agree.
- **Acceptance:**
  - Given statuses [verified, pending, rejected] cards show Verified 1, Pending 1 (not 2).
  - Cards' sum equals total or an 'Other' card accounts for the rest.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; misleading KPI for treasury clerks.

### GAP-FINANCE-REVENUE-CHALLANS-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** StatusPill has no mapping for "verified" (StatusPill.tsx:6-38), so the one status the page treats as success renders the neutral info variant.
- **Verified evidence:** STATUS_MAP (StatusPill.tsx:6-38) has no 'verified'; the ChallansTable status column uses cellType:'status' (CT:12), so the pill falls to 'info' (neutral). The page treats 'verified' as its success state (page.tsx:6).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add verified:'good' to STATUS_MAP; add reconciled:'good', cancelled:'mut' once enum confirmed.
  2. Add test in StatusPill tests.
- **Acceptance:**
  - 'verified' pill renders 'pill good'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; global change, intended.

### GAP-FINANCE-REVENUE-CHALLANS-05  ·  MEDIUM  ·  partly  ·  theme WIRING (was DEADROUTE)

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Subtitle promises "bank reconciliation" but no reconciliation state, bank or deposit-verification detail is shown; challans/[id]/page.tsx:6-14 says the backend GET route does not exist yet, so the row link from this list currently lands on the "Challan detail not available" empty state.
- **Verified evidence:** Subtitle (page.tsx:10) says 'deposit verification and bank reconciliation' but the table has no bank/reconciliation column (page.tsx:14 comment admits no bank column). Row links go to /finance/revenue/challans/<id> (rowLinkPrefix, CT:12); the detail header comment (CD:6-14) states the backend GET :id route does not exist yet and docs/DESIGN-GAP-REVIEW-LATEST.md:60 lists 'Challans (list + detail): Not built'. So the link likely lands on the not-available empty state, but this cannot be verified without finance-service. It is not a dead route in the web app (the route exists).
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/page.tsx`, `apps/web/src/app/(app)/finance/revenue/challans/[id]/page.tsx`
- **Fix steps:**
  1. Reword subtitle to what is shown, e.g. 'Government challans and deposit status.', until reconciliation exists.
  2. Either hide rowLinkPrefix in ChallansTable until finance-service ships GET /v1/finance/challans/:id, or keep and rely on the fixed error/not-found state (DETAIL-02).
  3. Track backend route as a dependency.
- **Acceptance:**
  - Subtitle matches visible columns.
  - No row click leads to a misleading 'may not exist' page.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-DETAIL-02

### GAP-FINANCE-REVENUE-CHALLANS-06  ·  LOW  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** No create/record-challan action although this is the receipts register; rows are read-only (page.tsx:11-23).
- **Verified evidence:** Page and table are read-only (no action buttons; page.tsx:8-22, CT:12). True. Whether creating challans belongs here is a product decision; no create route or POST exists in apps/web for finance challans (grep of 'challan' hits only hr/payroll/statutory challans, which has its own IngestChallanForm). Not a dead link.
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/page.tsx`
- **Fix steps:**
  1. Decide whether challans are entered in this app or ingested from GRN/bank; if entered, add a 'Record challan' PageHeader action and zod-validated form posting to finance-service, emitting an audit event.
- **Acceptance:**
  - If in scope: form posts amount in paise, appears in register, audit event emitted.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Money write path; needs backend endpoint, paise handling and audit.


---
## /finance/revenue/challans/[id]  —  `finance/revenue-challans-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/revenue/challans/[id]/page.tsx`
- **Design reference:** `redesign/finance/revenue-challans-detail.html`

### GAP-FINANCE-REVENUE-CHALLANS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** A failed fetch is shown as "Challan detail not available": the loader returns null with source "error" (apiClient.ts:117-172), so the !challan branch (page.tsx:18-28) runs and the DataSourceBadge in the filled branch (page.tsx:37) is unreachable.
- **Verified evidence:** getFinanceChallanById (apps/web/src/app/_data/loaders.ts:2017-2024) uses fetchJson, which returns {data: null, source:'error', status, errorMessage} on non-2xx, missing auth, network or schema failure (apiClient.ts:117-172). page.tsx:15 only tests !challan, so every failure (401/403/5xx/network) shows the 'Challan detail not available' EmptyState (CD:18-28). The filled branch's DataSourceBadge (CD:37, source==='error') is dead because source==='error' always implies challan===null. The 'show — instead of 0' part of the fix does not apply (nothing is coerced to 0 here).
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/[id]/page.tsx`
- **Fix steps:**
  1. In ChallanDetailPage destructure the full result (const result = await getFinanceChallanById(id)) and branch on result.source==='error' first.
  2. If result.status===404 call notFound() (or keep the current EmptyState); for any other error render <LoadErrorState result={result} area='challan' backHref='/finance/revenue/challans' /> (from @/app/_components/ds, already handles 403 vs retry).
  3. Only treat data===null with source==='api' as 'not found'.
  4. Delete the unreachable actions={source==='error' ? <DataSourceBadge/> : null} prop and the DataSourceBadge import.
  5. Update the file header comment (currently says it honestly falls to empty state).
- **Acceptance:**
  - Unit/RTL: mock loader {data:null,source:'error',status:500} -> renders error state with Retry, not 'Challan detail not available'.
  - Mock status 403 -> PermissionDenied copy, no retry.
  - Mock status 404 -> not-found/empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; read-only page, no money mutation.
- **Depends on:** LoadErrorState

### GAP-FINANCE-REVENUE-CHALLANS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Receipt Head prints receiptHeadId, an internal id, not the head code and name (page.tsx:53).
- **Verified evidence:** CD:53 renders {challan.receiptHeadId} in a mono span, and the list column does the same (CT:12). True that it is the raw field. Whether it is an opaque UUID or a human code cannot be seen: FinanceChallanSummary is in @civitasone/types and finance-service, neither in the snapshot. No receipt-head loader or lookup exists in apps/web (grep for receiptHead outside challans found nothing).
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/[id]/page.tsx`, `apps/web/src/app/(app)/finance/revenue/challans/ChallansTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with finance-service whether the challan payload can include receiptHeadCode/receiptHeadName (or a receipt-heads list endpoint to join client-side).
  2. Extend FinanceChallanSummary + zod schema in @civitasone/types with the code/name fields.
  3. Render 'CODE - Name' at CD:53 and in the CT column via a render prop, falling back to '—' when absent (not the raw id).
  4. Keep the id only as a hidden/secondary title attribute if needed.
- **Acceptance:**
  - With payload {receiptHeadCode:'0040', receiptHeadName:'Tax Revenue'} detail shows '0040 - Tax Revenue'.
  - When only id is available the cell shows '—', not a UUID.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; display-only. Depends on backend exposing the head.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-02

### GAP-FINANCE-REVENUE-CHALLANS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme OTHER (was WIRING)

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** The subtitle of the register promises "deposit verification and bank reconciliation", but this record shows no verifier, verification date, bank, or reconciliation link, only a status (page.tsx:39-58).
- **Verified evidence:** Detail page (CD:39-58) shows challanNo, depositor, amount, currency, GRN, receipt head, created/updated and status only; no verifier, verification date, bank or reconciliation link. The page itself never promises verification/reconciliation: that promise is the list subtitle (challans/page.tsx:10). Whether the backend has these fields cannot be verified (finance-service and types absent), and the code comment says the detail GET route does not exist yet.
- **Files to change:** `apps/web/src/app/(app)/finance/revenue/challans/[id]/page.tsx`, `apps/web/src/app/(app)/finance/revenue/challans/page.tsx`
- **Fix steps:**
  1. Decide with finance whether verification/reconciliation is in scope (decision).
  2. If yes: add verifiedBy, verifiedAt, bankName/depositRef, reconciliationId to the challan type and render them in a 'Verification' Card with a link to /finance/reconciliation.
  3. If no: reword the subtitle in challans/page.tsx (see -CHALLANS-05) and leave detail as is.
- **Acceptance:**
  - Detail page for a verified challan shows verifier name and date.
  - Unverified shows 'Not yet verified'.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; scope creep risk if backend lacks fields.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-05

### GAP-FINANCE-REVENUE-CHALLANS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Status appears in a stat card and again as a pill in the field grid (page.tsx:43,56); "verified" has no StatusPill mapping (StatusPill.tsx:6-38) so both render neutral.
- **Verified evidence:** CD:43 (StatCard value={challan.status}) prints the raw lowercase status, and CD:56 uses <StatusPill status=...>. STATUS_MAP in StatusPill.tsx:6-38 has no 'verified' key, so lookup falls to 'info' (StatusPill.tsx:~63). The stat card is plain text, not a pill, so it is not 'both render neutral'; the card shows raw status text unformatted. Real duplication of status is confirmed. The challan status enum itself cannot be verified (types absent).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/finance/revenue/challans/[id]/page.tsx`
- **Fix steps:**
  1. Add verified:'good' (and reconciled:'good', cancelled:'mut') to STATUS_MAP in StatusPill.tsx once the enum is confirmed with finance-service.
  2. Change the stat card value at CD:43 to humanizeStatus(challan.status) or drop the duplicate pill.
  3. Add a StatusPill unit test for the new keys.
- **Acceptance:**
  - <StatusPill status='verified'/> has class 'pill good'.
  - Detail page shows status once as a pill, humanized.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared pill change affects every page using 'verified' (currently neutral) - intended.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-04


---
## /finance/statutory/tds-returns  —  `finance/statutory-tds-returns.html`

- **Source:** `apps/web/src/app/(app)/finance/statutory/tds-returns/page.tsx`
- **Design reference:** `redesign/finance/statutory-tds-returns.html`

### GAP-FINANCE-STATUTORY-TDS-RETURNS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** The page is titled "TDS Returns" but reads the per-deduction ledger (/vendor-tds), one row per vendor deduction, not returns (loaders.ts:2157-2166): "Total Returns 5, Filed 3" counts deductions, so a Form 26Q filing status per quarter cannot be read from it.
- **Verified evidence:** getFinanceTDSReturns (loaders.ts:2166-2172) fetches /api/v1/finance/vendor-tds typed VendorTdsEntry[]; the columns (TDSReturnsTable.tsx:20-26: vendor_name, section, quarter, fy, tds_amount_minor, deduction_date, status) are per-deduction. page.tsx:8-20 counts rows as 'Total Returns', 'Filed', 'Pending', so the numbers are deduction counts. Subtitle (page.tsx:15) does say 'deduction register', which partly discloses it, but title and card labels say Returns. Line refs in the observation (2157-2166) were off by a few lines.
- **Files to change:** `apps/web/src/app/(app)/finance/statutory/tds-returns/page.tsx`, `apps/web/src/app/(app)/finance/statutory/tds-returns/TDSReturnsTable.tsx`
- **Fix steps:**
  1. Decide: rename to 'TDS Deductions' (title, cards 'Total Deductions', tab/nav label) or add a real returns source (Form 26Q per FY+quarter with ack no, filed date).
  2. If renaming, update PageHeader title, Card title, exportFilename, emptyTitle/message and sidebar label.
  3. If adding returns, group rows by fy+quarter+section client-side only as an interim, clearly labelled.
- **Acceptance:**
  - Page no longer calls per-deduction rows 'returns'.
  - Filed/Pending cards labelled as deduction status.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low for rename; large if a returns model is needed.
- **Depends on:** GAP-FINANCE-STATUTORY-TDS-RETURNS-04

### GAP-FINANCE-STATUTORY-TDS-RETURNS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** "Quarters" is new Set(quarter) (page.tsx:21), so Q2 of FY 2025-26 and Q2 of FY 2026-27 collapse into one; it should key on fy + quarter.
- **Verified evidence:** page.tsx:14 Quarters = new Set(returns.map(r=>String(r.quarter ?? ''))).size; rows carry a separate fy (TDSReturnsTable.tsx:23), so Q2 of two FYs collapse and null quarters count as one '' bucket.
- **Files to change:** `apps/web/src/app/(app)/finance/statutory/tds-returns/page.tsx`
- **Fix steps:**
  1. Key on `${r.fy}|${r.quarter}` and skip rows where quarter is null/empty.
  2. Label the card 'FY-Quarters' or show the latest as text.
- **Acceptance:**
  - Rows FY 2025-26 Q2 and FY 2026-27 Q2 give 2.
  - Null quarters not counted.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-STATUTORY-TDS-RETURNS-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Deduction Date is printed without a formatter (TDSReturnsTable.tsx:24), and rows with a null date render a blank cell.
- **Verified evidence:** TDSReturnsTable.tsx:24 deduction_date has no render/date cellType; DataTable cellValue (DT:124-139) does String(row[key] ?? ''), so raw value and blank when null (no '—').
- **Files to change:** `apps/web/src/app/(app)/finance/statutory/tds-returns/TDSReturnsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Use the shared date cellType/render (formatIndianDate) as in CHALLANS-01; null shows '—'.
- **Acceptance:**
  - Date renders dd/mm/yyyy; null shows '—'; CSV export matches.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-01

### GAP-FINANCE-STATUTORY-TDS-RETURNS-04  ·  MEDIUM  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** No filing workflow: no acknowledgement number, BSR code, challan link or due date, and no action to file or mark filed; the page is read-only although two of five stat cards are about filing status (page.tsx:7-8).
- **Verified evidence:** True that the page is read-only with no ack number, BSR code, challan link, due date or file action (TDSReturnsTable.tsx:20-26; page.tsx). But the observation's claim of filing cards at page.tsx:7-8 is really page.tsx:8-9. Backend support for such fields/actions cannot be verified (finance-service and types absent). Missing feature, not a broken link.
- **Files to change:** `apps/web/src/app/(app)/finance/statutory/tds-returns/page.tsx`, `apps/web/src/app/(app)/finance/statutory/tds-returns/TDSReturnsTable.tsx`
- **Fix steps:**
  1. Decision first: is filing in-app or via TRACES? If in-app, define returns entity (fy, quarter, form, ackNo, filedOn, dueDate) in finance-service.
  2. Add columns and a 'Mark filed' action with audit event and role gate.
  3. Until then remove or relabel Filed/Pending cards.
- **Acceptance:**
  - Marking filed records ack number, user and time, and emits audit event.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Statutory filing status; wrong data has compliance impact.
- **Depends on:** GAP-FINANCE-STATUTORY-TDS-RETURNS-01

### GAP-FINANCE-STATUTORY-TDS-RETURNS-05  ·  LOW  ·  partly  ·  theme OTHER (was PII)

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Vendor is shown by name only; the PAN needed to reconcile with Form 26AS is not shown (TDSReturnsTable.tsx:19). PAN is a DPDP-adjacent field, so any addition should be masked.
- **Verified evidence:** TDSReturnsTable.tsx:20 shows vendor_name only, no PAN. True. But this is a missing-field enhancement, not a PII leak; no <Masked> component exists in apps/web (grep found none), and whether VendorTdsEntry contains a PAN cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/statutory/tds-returns/TDSReturnsTable.tsx`, `apps/web/src/app/_components/Masked.tsx`
- **Fix steps:**
  1. Confirm vendor-tds payload includes pan; if so create <Masked value reveal> in _components with role-based reveal that calls an audited reveal endpoint.
  2. Show masked PAN (ABCDE****F) column; exclude or mask it in the CSV export (DataTable exportable).
- **Acceptance:**
  - PAN displays masked by default; reveal creates an audit event; CSV never contains full PAN unless authorised.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII: full PAN in export or DOM would be a DPDP issue.

### GAP-FINANCE-STATUTORY-TDS-RETURNS-06  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Only statuses "filed" and "pending" get stat cards; StatusPill has no mapping for "filed" (StatusPill.tsx:6-38) so it renders the neutral info variant.
- **Verified evidence:** Cards count only 'filed' and 'pending' (page.tsx:9-10). STATUS_MAP has 'pending' (warn) but no 'filed', so filed rows render the neutral info pill via cellType 'status' (TDSReturnsTable.tsx:25).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add filed:'good' (and deposited/paid if used) to STATUS_MAP; confirm enum values with finance-service.
- **Acceptance:**
  - 'filed' pill has class 'pill good'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-04


---
## /finance/travel  —  `finance/travel.html`

- **Source:** `apps/web/src/app/(app)/finance/travel/page.tsx`
- **Design reference:** `redesign/finance/travel.html`

### GAP-FINANCE-TRAVEL-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** finance/layout.tsx:29-36 wraps every /finance/* child in a FINANCE_ROLES gate, so an employee or manager (no finance role) who follows an old /finance/travel bookmark sees PermissionDenied instead of being redirected to /hr/travel, which serves them.
- **Verified evidence:** travel/page.tsx:9-11 only calls redirect('/hr/travel'). But finance/layout.tsx:20-31 renders <PermissionDenied> instead of children when the session has roles and none is in FINANCE_ROLES, so the page (and its redirect) never runs for those users. Fails open only for empty roles.
- **Files to change:** `apps/web/next.config.js`, `apps/web/src/app/(app)/finance/layout.tsx`
- **Fix steps:**
  1. Add a permanent redirect in apps/web next.config (redirects(): source '/finance/travel', destination '/hr/travel') - runs before layouts. The config file is not in the snapshot; edit the existing one.
  2. Or move redirect logic into middleware.ts for /finance/travel.
  3. Keep travel/page.tsx as fallback.
- **Acceptance:**
  - Logged in as employee (no finance role), GET /finance/travel lands on /hr/travel.
  - Finance role still redirected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ensure /hr/travel has its own role gate.

### GAP-FINANCE-TRAVEL-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** TravelClaimCard hard-codes the CCS(TA) 7th CPC fare entitlement table by pay level (TravelClaimCard.tsx:43-62) and its own header comment disagrees with it on Level 1-5 ("AC-III approved cases") vs the map (Sleeper only); rules that change by Government order are frozen in a client file.
- **Verified evidence:** TravelClaimCard.tsx:9-17 header comment says Level 1-5 'Sleeper Class (AC-III approved cases...)' while FARE_CLASS_ENTITLEMENT (:43-62) maps 1-5 to 'Sleeper' only, and busRoadNote applies to 1-4 (comment says 1-5). Client-side hardcoding confirmed. But the component is not imported anywhere (see TRAVEL-03), so no user sees it; impact is latent.
- **Files to change:** `apps/web/src/app/(app)/finance/travel/TravelClaimCard.tsx`
- **Fix steps:**
  1. Delete the component (see TRAVEL-03) or, if reused, move entitlements to a backend policy/config endpoint and fix the comment.
- **Acceptance:**
  - No client file contains CCS(TA) entitlement table.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None while orphaned.
- **Depends on:** GAP-FINANCE-TRAVEL-03

### GAP-FINANCE-TRAVEL-03  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Orphaned component: TravelClaimCard.tsx is not imported by anything under finance/ after the page became a redirect; its formatINR divides paise by 100 and drops decimals (TravelClaimCard.tsx:102-104), unlike formatMoney.
- **Verified evidence:** Orphan confirmed: grep shows TravelClaimCard referenced only in its own file. formatINR (TravelClaimCard.tsx:102-104) does (minor/100).toLocaleString('en-IN') - float division, but it does not drop decimals (toLocaleString keeps up to 3 fraction digits, so 1234.5 prints '1,234.5', inconsistent, not truncated). Props use number for fareAmount/daAmount/hotelAmount/totalAmount (:29-32), also a paise-rule violation.
- **Files to change:** `apps/web/src/app/(app)/finance/travel/TravelClaimCard.tsx`
- **Fix steps:**
  1. Delete TravelClaimCard.tsx (dead code).
  2. If revived, use formatMoney from lib/formatters and bigint/string minor props.
- **Acceptance:**
  - Build passes with file removed; grep finds no reference.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; unused.


---
## /finance/treasury/cash-bank  —  `finance/treasury-cash-bank.html`

- **Source:** `apps/web/src/app/(app)/finance/treasury/cash-bank/page.tsx`
- **Design reference:** `redesign/finance/treasury-cash-bank.html`

### GAP-FINANCE-TREASURY-CASH-BANK-01  ·  HIGH  ·  confirmed  ·  theme OTHER (was PII)

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Despite the title "Cash & Bank Book" there is no way to choose cash vs a specific bank account, or a date range: one flat list, so the running Balance column cannot be tied to an account, and the empty copy says "for this period" although no period is selectable (CashBankTable.tsx:27-45).
- **Verified evidence:** theme_corrected: not PII. page.tsx and CashBankTable.tsx:28-33 render one flat list from getFinanceCashBook (/api/v1/finance/cash-book, loaders.ts:1957-1964) with no account, cash/bank, or date-range controls; CashBankTable.tsx:44 empty text says 'for this period' though no period exists. Whether the endpoint accepts account/date query params cannot be verified (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cash-bank/page.tsx`, `apps/web/src/app/(app)/finance/treasury/cash-bank/CashBankTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm query params (account, from, to) on finance-service cash-book.
  2. Extend getFinanceCashBook(params) and page to read searchParams; add a selector (cash / bank account) and date range controls.
  3. Pass params to fetchJson URL with encodeURIComponent; key useSeededResource cache by params.
  4. Change empty copy to reference the selected period.
- **Acceptance:**
  - Choosing an account and range changes the rows and the URL.
  - Empty state names the period.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; wrong scope makes running balance meaningless.
- **Depends on:** GAP-FINANCE-TREASURY-CASH-BANK-02

### GAP-FINANCE-TREASURY-CASH-BANK-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** No opening or closing balance: the first row is not anchored, and sorting or filtering the table re-orders rows away from the ledger sequence the running Balance depends on (sortable, CashBankTable.tsx:36).
- **Verified evidence:** Columns include balance_minor (CashBankTable.tsx:33) with sortable and filterable enabled (:37-40) and no opening/closing row anywhere in page.tsx. Sorting/filtering by another column shows Balance out of ledger order. Sorting is user-driven, but the balance stays a stored server value so figures remain correct per row; it is the sequence and anchor that is lost.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cash-bank/CashBankTable.tsx`, `apps/web/src/app/(app)/finance/treasury/cash-bank/page.tsx`
- **Fix steps:**
  1. Add opening/closing balance StatCards from the API (or derive opening = first.balance - receipt + payment when ordered).
  2. Set sortable={false} or default sort by entry_date+sequence with a 'Reset order' control.
  3. Show a note that Balance is running only in ledger order.
- **Acceptance:**
  - Sorting by Payment does not hide the opening balance.
  - Opening and closing shown for selected range.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; accounting readers may mis-read a re-sorted balance.
- **Depends on:** GAP-FINANCE-TREASURY-CASH-BANK-01

### GAP-FINANCE-TREASURY-CASH-BANK-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Date is printed raw (entry_date has no formatter, CashBankTable.tsx:28) and the Today stat compares that raw string with an en-CA date (page.tsx:27); it only works if the backend emits plain YYYY-MM-DD.
- **Verified evidence:** CashBankTable.tsx:28 entry_date has no formatter (DT cellValue String()). page.tsx:26 compares String(e.entry_date) === new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}), so it only matches for a plain YYYY-MM-DD; an ISO timestamp yields Today = 0.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cash-bank/CashBankTable.tsx`, `apps/web/src/app/(app)/finance/treasury/cash-bank/page.tsx`
- **Fix steps:**
  1. Add date render (formatIndianDate) for entry_date.
  2. In page.tsx compare String(e.entry_date).slice(0,10) to the IST date, or add a shared isSameISTDate helper.
- **Acceptance:**
  - entry_date '2026-09-26' shows '26/09/2026'.
  - Today counts entries with date-only and full-ISO values.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Date-only strings parsed as UTC midnight; use timeZone UTC for those.
- **Depends on:** GAP-FINANCE-REVENUE-CHALLANS-01

### GAP-FINANCE-TREASURY-CASH-BANK-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Receipts and Payments stat cards count entries, not money; a treasury officer expects the day's total receipts and payments in rupees (page.tsx:10-11,22-23).
- **Verified evidence:** page.tsx:10-11 receipts/payments = entries.filter(receipt_minor>0).length: counts of entries, labelled 'Receipts'/'Payments' (page.tsx:22-23). No totals in rupees.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cash-bank/page.tsx`
- **Fix steps:**
  1. Sum receipt_minor and payment_minor with BigInt (BigInt(e.receipt_minor ?? 0)) and show formatMoney(total); keep counts as StatCard secondary text.
  2. Add a Today receipts/payments total similarly.
- **Acceptance:**
  - Two entries of 100.50 and 50 rupees show ₹150.50 receipts.
  - No float arithmetic.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money display: use BigInt, not Number, to keep paise exact.

### GAP-FINANCE-TREASURY-CASH-BANK-05  ·  LOW  ·  partly  ·  theme WIRING (was DEADROUTE)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Voucher No is plain text with no link to the voucher or general-ledger entry (CashBankTable.tsx:30).
- **Verified evidence:** CashBankTable.tsx:30 voucher_no is plain text (no render, no rowLink). True, but no voucher or ledger detail route is visible under app/(app)/finance (accounting and journal-entry exist, but their detail routes and the voucher id field on CashBookEntry cannot be verified), so a link target is unknown.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cash-bank/CashBankTable.tsx`
- **Fix steps:**
  1. Identify the voucher/JE detail route and whether the cash-book row carries a voucher id.
  2. Add a render prop linking voucher_no via next/link when both exist; otherwise leave as text.
- **Acceptance:**
  - Click on voucher_no opens the voucher detail.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-FINANCE-TREASURY-CASH-BANK-06  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Amount cells show "₹0.00" for the empty side of each row (formatMoney of 0), which doubles the visual noise in a two-column receipt/payment layout.
- **Verified evidence:** DataTable amount cell (DT:128-134) formatMoney(value): null renders '—', but 0 renders '₹0.00'. So the noise appears only if the API sends 0 for the empty side; the payload shape cannot be verified (finance-service absent). The page comment says raw snake_case columns, likely bigint strings/0.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cash-bank/CashBankTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add col.render for receipt_minor/payment_minor: show '' or '—' when Number(v)===0 (BigInt(v)===0n), else formatMoney(v).
  2. Keep balance column showing ₹0.00 for real zero.
- **Acceptance:**
  - Row with receipt 500, payment 0 shows ₹5.00 and an empty payment cell.
  - Balance 0 still shows ₹0.00.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; do not hide a genuine zero in Balance.


---
## /finance/treasury/cheques  —  `finance/treasury-cheques.html`

- **Source:** `apps/web/src/app/(app)/finance/treasury/cheques/page.tsx`
- **Design reference:** `redesign/finance/treasury-cheques.html`

### GAP-FINANCE-TREASURY-CHEQUES-01  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** A "Bounced" instrument is the exception the register exists to surface, but StatusPill has no mapping for "bounced" or "presented" (StatusPill.tsx:6-38), so a bounced cheque renders the same neutral info pill as a presented one, and the row gets no emphasis.
- **Verified evidence:** StatusPill STATUS_MAP (ds/StatusPill.tsx:6-38) has no keys 'bounced', 'presented', 'cancelled', 'issued' or 'stale'; lookup falls back to 'info' (line ~55). ChequesTable.tsx:34 uses cellType:'status' so bounced and presented both render as neutral pills. No row emphasis exists in DataTable for status. Same gap affects deposits (matured/refunded) and e-payments (released/pending approval).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/finance/treasury/cheques/ChequesTable.tsx`
- **Fix steps:**
  1. Add to STATUS_MAP: bounced:'bad', cancelled:'mut', stale:'bad', presented:'warn', issued:'info' (explicit).
  2. Add matured:'warn', refunded:'mut', released:'good', 'pending approval':'warn', queued:'mut' (covers DEPOSITS-04, E-PAYMENTS-05).
  3. Confirm actual backend status enum spellings (types package absent) and add snake_case variants if needed.
  4. Add a unit test iterating the map keys.
- **Acceptance:**
  - StatusPill status='bounced' has class 'pill bad'; 'presented' 'pill warn'.
  - Cheque list shows bounced row with red pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is global; adding keys recolours other screens that use these words (check 'released', 'queued', 'presented').
- **Depends on:** GAP-FINANCE-TREASURY-DEPOSITS-04, GAP-FINANCE-TREASURY-E-PAYMENTS-05

### GAP-FINANCE-TREASURY-CHEQUES-02  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Issued and Cleared dates are printed raw (ChequesTable.tsx:32-33); an uncleared cheque leaves a blank cell rather than a dash or an ageing hint.
- **Verified evidence:** ChequesTable.tsx:32-33 declares issueDate and clearedAt as plain columns; DataTable.cellValue returns String(row[key] ?? '') (ds/DataTable.tsx:141) so ISO timestamps print raw and a null clearedAt yields an empty cell, not a dash. No ageing hint exists.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/finance/treasury/cheques/ChequesTable.tsx`
- **Fix steps:**
  1. Add cellType:'date' to DataTable (shared with CHEQUES-DETAIL-05) returning formatIndianDate(value), '—' for null.
  2. Apply to issueDate and clearedAt.
  3. Optionally add a render on clearedAt showing 'Uncleared, N days' when status is presented and issueDate is over 90 days (cheque validity).
- **Acceptance:**
  - Row with clearedAt null shows '—'.
  - Row with ISO date shows formatted date; CSV export uses same format.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-TREASURY-CHEQUES-DETAIL-05

### GAP-FINANCE-TREASURY-CHEQUES-03  ·  MEDIUM  ·  partly  ·  theme MISSING-ACTION (was DEADROUTE)

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Register is read-only: no action to issue, present, clear, stop or cancel an instrument although the detail timeline models presented, cleared, bounced and cancelled (cheques/[id]/page.tsx:29-45).
- **Verified evidence:** True: the register (cheques/page.tsx + ChequesTable.tsx) has no create/present/clear/stop/cancel controls, only rowLink to the detail (which is also read-only, page.tsx:29-45 models the states). But this is missing functionality, not a dead route: the detail route exists (cheques/[id]/page.tsx). Backend transition endpoints cannot be verified (finance-service absent; no mutation loader in loaders.ts).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/page.tsx`, `apps/web/src/app/(app)/finance/treasury/cheques/ChequesTable.tsx`
- **Fix steps:**
  1. Confirm backend endpoints for issue and status transitions with finance-service.
  2. Add an 'Issue cheque' page/route with zod-validated form (amount in paise via existing money input) only when POST exists.
  3. Put transition actions on the detail page (see CHEQUES-DETAIL-04) rather than on list rows.
  4. Gate by finance write roles.
- **Acceptance:**
  - Finance officer sees Issue action; audit_officer does not.
  - Issued cheque appears in list after submit.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Money and approval workflow; needs maker-checker.
- **Depends on:** GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04

### GAP-FINANCE-TREASURY-CHEQUES-04  ·  MEDIUM  ·  confirmed  ·  theme STATS (was OTHER)

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Stat cards cover Cleared, Presented and Bounced only; Issued, Cancelled and Stale cheques fall outside them, so the three do not add up to Total Instruments.
- **Verified evidence:** cheques/page.tsx:5-7 computes cleared, presented, bounced only; StatCards at lines 21-24 show Total, Cleared, Presented, Bounced, so issued/cancelled/stale (and any other status) are uncounted and the three do not sum to Total. Also on fetch error all counts show 0 rather than '—'.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/page.tsx`
- **Fix steps:**
  1. Add an 'Issued / Outstanding' count (status issued) and 'Cancelled/Stale' or an 'Other' card computed as total minus the rest.
  2. Alternatively replace the 4th card with Outstanding value (sum of amountMinor for issued+presented) using BigInt-safe formatMoney.
  3. Show '—' instead of 0 when source==='error'.
- **Acceptance:**
  - Statuses cleared+presented+bounced+other equals Total on a mixed fixture.
  - Error state shows '—' in cards.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Verify actual status enum values before hard-coding.

### GAP-FINANCE-TREASURY-CHEQUES-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** Drawn On shows the bank name only, with no account, so two accounts at the same bank are indistinguishable (ChequesTable.tsx:31).
- **Verified evidence:** ChequesTable.tsx:31 uses key 'bankName' with label 'Drawn On'; no branch/account column. The detail page reads accountNo (page.tsx:88), so the data likely exists on the record, but whether the list endpoint returns it cannot be verified (types package absent). Any account shown must be masked (see DETAIL-01).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/ChequesTable.tsx`
- **Fix steps:**
  1. Verify FinanceInstrumentSummary includes accountNo/branch.
  2. Add a render for 'Drawn On' showing bankName plus masked last 4 digits via maskAccountNo.
  3. Include the value in filter/search.
- **Acceptance:**
  - Two cheques on same bank different accounts show different last-4.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Do not show full account numbers in the list.
- **Depends on:** GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01


---
## /finance/treasury/cheques/[id]  —  `finance/treasury-cheques-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/treasury/cheques/[id]/page.tsx`
- **Design reference:** `redesign/finance/treasury-cheques-detail.html`

### GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** The full bank Account No is printed in clear (page.tsx:88) to every FINANCE_ROLES member, including audit_officer and budget_officer whose need is unrelated; financial identifiers are DPDP-adjacent and should be masked with a role-gated reveal.
- **Verified evidence:** cheques/[id]/page.tsx:88 renders field(cheque,'accountNo','bankAccountNumber') in a .mono span with no masking or role check. finance/layout.tsx admits every role in FINANCE_ROLES (lib/auth/workRoles.ts:32-43) incl. audit_officer, budget_officer, procurement_officer. No shared <Masked>/maskAccount helper exists in apps/web/src (grep finds only integrations secretMasked). Same clear-text pattern at finance/vendors/[id]/page.tsx:101 and finance/config/page.tsx:71. Whether the API already masks the value cannot be verified (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/[id]/page.tsx`, `apps/web/src/app/_components/Masked.tsx`, `apps/web/src/lib/auth/workRoles.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add maskAccountNo(v) to lib/formatters.ts (keep last 4, e.g. XXXXXXXX9012; '—' for empty).
  2. Create client component <Masked value canReveal> in app/_components/Masked.tsx: masked by default, Reveal button (aria-pressed) only when canReveal.
  3. Add BANK_ACCOUNT_REVEAL_ROLES (finance_officer, finance_admin, accounts_officer, super_admin) to lib/auth/workRoles.ts; compute canReveal in the page from getSessionRoles().
  4. Replace the Account No span at page.tsx:88 with <Masked>.
  5. If reveal is offered, have the backend emit an audit event (e.g. finance.instrument.account_revealed with instrument id + actor) on reveal; do not reveal purely client-side.
  6. Reuse <Masked> on vendors/[id] and finance/config account columns.
- **Acceptance:**
  - Unit: maskAccountNo('123456789012') === 'XXXXXXXX9012'; empty -> '—'.
  - Render as audit_officer: DOM contains no full account number and no Reveal button.
  - As finance_officer click Reveal: full number shown and one audit call fired.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Over-masking could block reconcilers if role list is wrong; reveal without server audit leaves a DPDP gap.
- **Depends on:** SHARED:Masked

### GAP-FINANCE-TREASURY-CHEQUES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** A failed fetch is shown as "Cheque not found" (loader returns null on error, apiClient.ts:117-172); the DataSourceBadge at page.tsx:73 is unreachable. The source even carries a comment acknowledging the null-on-error contract (page.tsx:97).
- **Verified evidence:** getFinanceChequeById (app/_data/loaders.ts:1984-1991) calls fetchJson with empty=null; fetchJson returns {data:null, source:'error', status} on non-OK, network error, missing auth or invalid payload (apiClient.ts:117-172). page.tsx:50 `if (!cheque)` shows EmptyState 'Cheque not found' for 404, 403, 500 and network failure alike. The DataSourceBadge at page.tsx:73 is only reached with a non-null cheque, so source==='error' is dead there. Comment at page.tsx:97 acknowledges the contract. LoaderResult.status (apiClient.ts:35) can distinguish 404.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/[id]/page.tsx`
- **Fix steps:**
  1. Destructure { data: cheque, source, status } from getFinanceChequeById.
  2. Before `if (!cheque)` add: if (source==='error' && status!==404) return the page shell with <RefreshErrorState error={toHumanError('load',{area:'cheque'})} backHref='/finance/treasury/cheques'/> (pattern: metadata/records/page.tsx:23); for 403 use PermissionDenied.
  3. Keep 'Cheque not found' only for status===404.
  4. Remove the dead actions={<DataSourceBadge>} at line 73 and the ux-001-ok comment at line 97.
- **Acceptance:**
  - Mock 500 -> retry error state, not 'Cheque not found'.
  - Mock 404 -> 'Cheque not found'.
  - Retry button calls router.refresh() and re-fetches.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** SHARED:RefreshErrorState

### GAP-FINANCE-TREASURY-CHEQUES-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme AUDIT (was CONFIRM)

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** Every timeline row shows actor "—" (page.tsx:32-43), so the "Clearance Timeline" cannot say who issued, presented or cleared; the maker-checker trail is missing from a cheque record.
- **Verified evidence:** timelineOf (page.tsx:32-43) hardcodes actor:'—' on every row and line 105 renders it, so the timeline never names who issued/presented/cleared. True, but the theme is not CONFIRM: no confirm dialog is involved, and the details card already shows 'Issued By' from cheque.issuedBy (line 90). Whether the API returns presentedBy/clearedBy fields cannot be verified (@civitasone/types and finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/[id]/page.tsx`
- **Fix steps:**
  1. Confirm with finance-service which actor fields GET /v1/finance/instruments/:id returns (issuedBy, presentedBy, clearedBy, cancelledBy, or an events array).
  2. In timelineOf read actor via field() from those fields; use issuedBy for the issued row.
  3. Hide the actor column when no row has an actor rather than showing a column of dashes.
  4. If backend lacks it, raise a ticket to emit lifecycle events with actor from the audit log.
- **Acceptance:**
  - Cheque with issuedBy='A' shows 'A' on the Instrument issued row.
  - Cheque with no actor fields shows no empty actor column.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Only map explicit fields; a wrong actor in a financial trail is worse than a dash.

### GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** No actions on the record: a bounced cheque (as here) cannot be re-presented, cancelled or marked stale from the UI (page.tsx:67-110).
- **Verified evidence:** True that page.tsx:67-110 has no action buttons: it is a read-only page (no client component, no mutation calls). The timeline models presented/cleared/bounced/cancelled so the states exist. Which transitions the backend supports (represent, cancel, mark stale) cannot be verified: finance-service and @civitasone/types are absent, and no instrument mutation loader exists in loaders.ts. Also note the observation's 'stale' is not a state the UI models.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/[id]/page.tsx`, `apps/web/src/app/(app)/finance/treasury/cheques/[id]/InstrumentActions.tsx`
- **Fix steps:**
  1. Confirm which instrument transition endpoints exist (cancel, re-present, mark stale) and their allowed source statuses; if none, file backend work first.
  2. Create client component InstrumentActions (ActionButton + ConfirmDialog with mandatory reason) receiving id and status.
  3. Show Cancel only for issued/presented, Re-present only for bounced; disable otherwise.
  4. Gate by a role constant (finance_officer/accounts_officer) and hide for audit/budget roles.
  5. router.refresh() after success; show toast; errors via the standard humanized error.
- **Acceptance:**
  - Bounced cheque shows Re-present, not Cancel-cleared.
  - Cancel requires a reason and refreshes the timeline with a Cancelled row.
  - audit_officer sees no action buttons.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Money-movement state changes need maker-checker and audit; do not ship UI before backend guards.
- **Depends on:** GAP-FINANCE-TREASURY-CHEQUES-03

### GAP-FINANCE-TREASURY-CHEQUES-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Dates go through formatIndianDate, which prints dd/mm/yyyy (formatters.ts:2-7), while the list shows the same fields raw; two formats for one field.
- **Verified evidence:** formatIndianDate (lib/formatters.ts:2-7) uses toLocaleDateString('en-IN',{2-digit day,2-digit month,numeric year}) i.e. dd/mm/yyyy and its comment cites the GFR/PFMS dd/MM/yyyy mandate. Detail page applies it at page.tsx:32-43,81,91. The list (cheques/ChequesTable.tsx:32-33) passes issueDate/clearedAt as plain columns and DataTable.cellValue (ds/DataTable.tsx:127-141) prints String(value), so ISO strings appear raw. Two formats confirmed. Note the suggested 'dd Mon yyyy' conflicts with the documented dd/MM/yyyy mandate, so pick one.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/finance/treasury/cheques/ChequesTable.tsx`
- **Fix steps:**
  1. Decide canonical display (keep dd/MM/yyyy per GFR comment, or move to dd Mon yyyy) and record it in formatters.ts.
  2. Add cellType:'date' to DataTable Column and cellValue (line 47/127) calling formatIndianDate; mirror it in the CSV export branch (line ~268).
  3. Set cellType:'date' on issueDate and clearedAt in ChequesTable.
  4. Leave detail page on the same helper.
- **Acceptance:**
  - Unit: DataTable with cellType 'date' renders 2025-03-01T00:00:00Z as the chosen format; null renders '—'.
  - List and detail show identical text for the same cheque.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Global DataTable change touches ~80 consumers only if opt-in; keep it opt-in.
- **Depends on:** SHARED:DataTable-date-cell

### GAP-FINANCE-TREASURY-CHEQUES-DETAIL-06  ·  LOW  ·  partly  ·  theme STATUS (was DATEFMT)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** "Cleared Date" prints "—" for a bounced or presented cheque; the stat card labelled Status uses a check icon regardless of state (page.tsx:79).
- **Verified evidence:** Two claims. (1) Cleared Date '—' for a bounced/presented cheque (page.tsx:91) is correct behaviour, since no clearedAt exists; not a defect (could show 'Not cleared' but low value). (2) True: the Status StatCard at page.tsx:79 hardcodes icon '✅' regardless of status, and passes raw status (not humanized) as value. Theme is not DATEFMT.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/cheques/[id]/page.tsx`
- **Fix steps:**
  1. Map status to icon (cleared ✅, presented ⏳, bounced ❌, cancelled ⛔, default 📝) in a small helper.
  2. Pass humanizeStatus(status) as the StatCard value (or drop the card since StatusPill is shown below).
  3. Optionally render 'Not cleared' instead of '—' for Cleared Date when status is bounced/presented.
- **Acceptance:**
  - Bounced cheque shows ❌ icon and 'Bounced'.
  - Cleared cheque still shows ✅.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/treasury/deposits  —  `finance/treasury-deposits.html`

- **Source:** `apps/web/src/app/(app)/finance/treasury/deposits/page.tsx`
- **Design reference:** `redesign/finance/treasury-deposits.html`

### GAP-FINANCE-TREASURY-DEPOSITS-01  ·  HIGH  ·  confirmed  ·  theme COPY (was DATEFMT)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Copy and data disagree: the page is "Fixed Deposits ... across treasury banks with maturity tracking" (page.tsx:14-15) but the columns are PD No, Type, Administrator and Balance (DepositsTable.tsx:28-32); "PD" is the Government Personal Deposit account, which is not a bank FD. There is no bank, rate, principal, start or maturity date, so maturity cannot be tracked.
- **Verified evidence:** deposits/page.tsx:14 subtitle and finance/page.tsx:32 promise 'Fixed and term deposits across treasury banks with maturity tracking', title 'Fixed Deposits'. DepositsTable.tsx:28-32 columns are pdNo, type, administrator, balanceMinor, status; no bank, rate, principal, start or maturity date. Data is FinanceDepositSummary from /api/v1/finance/deposits; whether the domain object is a PD account and what other fields the API returns cannot be verified (types package and finance-service absent). Table-vs-copy mismatch is real. Theme is copy/wiring not DATEFMT.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/deposits/page.tsx`, `apps/web/src/app/(app)/finance/treasury/deposits/DepositsTable.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Confirm with finance-service whether /finance/deposits is Personal Deposit (PD) accounts or bank FDs.
  2. If PD: retitle page and tile to 'Personal Deposit Accounts' and rewrite subtitle to 'PD accounts with administrator and balance'.
  3. If FDs are wanted: extend API with bank, rate, principal, startDate, maturityDate and add columns with cellType date/amount.
  4. Update navigation/tile copy consistently.
- **Acceptance:**
  - Title, subtitle and columns describe the same thing.
  - If FD fields added, Maturity column sorts by date.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Domain mislabel can misinform treasury reviewers.

### GAP-FINANCE-TREASURY-DEPOSITS-02  ·  MEDIUM  ·  confirmed  ·  theme STATS (was I18N)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** "Refunded" is computed as total - active - matured (page.tsx:21), so every other status (closed, lapsed, disputed) is mislabelled as refunded.
- **Verified evidence:** deposits/page.tsx:21 renders 'Refunded' as deposits.length - active - matured; any other status (closed, lapsed, etc.) is counted as refunded. Actual status enum values cannot be verified (types absent).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/deposits/page.tsx`
- **Fix steps:**
  1. Filter by status==='refunded' explicitly (lowercase compare like lines 6-7).
  2. Add an 'Other' or 'Closed' card if other statuses exist, or drop the fourth card.
  3. Show '—' when source==='error'.
- **Acceptance:**
  - Fixture with active, matured, closed, refunded: Refunded card counts only refunded.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FINANCE-TREASURY-DEPOSITS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1843 (merged)
- **First-pass claim:** Rows are not clickable and there is no detail route, so a deposit cannot be opened for its ledger or instrument history (DepositsTable.tsx:34-44 has no rowLink).
- **Verified evidence:** DepositsTable.tsx:34-44 DataTable has no rowLinkKey/rowHref; folder has no [id] route (directory listing: DepositsTable, error, loading, page only). Whether GET /finance/deposits/:id or a ledger endpoint exists cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/deposits/DepositsTable.tsx`, `apps/web/src/app/(app)/finance/treasury/deposits/[id]/page.tsx`
- **Fix steps:**
  1. Confirm a deposit detail/ledger endpoint exists; if not, request it.
  2. Create deposits/[id]/page.tsx (loader + RefreshErrorState per DETAIL-02 pattern) showing ledger and instrument history.
  3. Add rowLinkKey:'id' rowLinkPrefix:'/finance/treasury/deposits/' in DepositsTable only for rows with an id.
- **Acceptance:**
  - Clicking a row opens detail; rows without id are not links.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-FINANCE-TREASURY-DEPOSITS-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** StatusPill has no mapping for "matured" or "refunded" (StatusPill.tsx:6-38); both render the neutral info variant, so a matured deposit needing action looks like a settled one.
- **Verified evidence:** StatusPill STATUS_MAP (ds/StatusPill.tsx:6-38) lacks 'matured' and 'refunded'; fallback is 'info' (neutral). DepositsTable.tsx:32 uses cellType:'status'.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add matured:'warn' (action needed), refunded:'mut' in STATUS_MAP.
  2. Add test.
- **Acceptance:**
  - StatusPill 'matured' -> 'pill warn'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Global component; shared change with CHEQUES-01.
- **Depends on:** GAP-FINANCE-TREASURY-CHEQUES-01

### GAP-FINANCE-TREASURY-DEPOSITS-05  ·  LOW  ·  confirmed  ·  theme STATS (was OTHER)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Balance is the only money column; the stat row has no total balance card, the figure a treasury reviewer looks for first (page.tsx:17-22).
- **Verified evidence:** deposits/page.tsx:17-22 has cards Total, Active, Matured, Refunded (counts only); balanceMinor is only in the table (DepositsTable.tsx:31). No total balance. balanceMinor type (number vs string) cannot be verified; pfms uses string minor units, so sum with BigInt.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/deposits/page.tsx`
- **Fix steps:**
  1. Compute total = sum of BigInt(d.balanceMinor ?? 0) over active deposits.
  2. Replace or add StatCard 'Total Balance' with formatMoney(total) (accepts bigint).
  3. Show '—' on error.
- **Acceptance:**
  - Two deposits 100 paise + 250 paise show ₹3.50.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money: use BigInt/paise, never float.


---
## /finance/treasury/e-payments  —  `finance/treasury-e-payments.html`

- **Source:** `apps/web/src/app/(app)/finance/treasury/e-payments/page.tsx`
- **Design reference:** `redesign/finance/treasury-e-payments.html`

### GAP-FINANCE-TREASURY-E-PAYMENTS-01  ·  HIGH  ·  partly  ·  theme DUPLICATE (was I18N)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** This route is a second copy of the Payments register: it calls the same endpoint with the same loader contract (loaders.ts:1993-2005) and shows the same four columns minus the tabs, actions and row link (EPaymentsTable.tsx:36-41 vs payments/PaymentsTable.tsx:81-95). Two sidebar tiles lead to one dataset.
- **Verified evidence:** getFinanceEPayments (loaders.ts:1997-2005) and getPayments (loaders.ts:769-772) both hit /api/v1/finance/payments with paymentsListSchema and mapPayments. EPaymentsTable.tsx has the same four columns (referenceId, beneficiary, amountDisplay, status) as payments/PaymentsTable.tsx:81-95 minus Segmented tabs, reference formatting and rowHref. Tiles: finance/page.tsx:30 (e-Payment Orders) and :46 (Payments). The 'actions' claim is overstated: PaymentsTable has tabs and a row link but no action buttons.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/e-payments/page.tsx`, `apps/web/src/app/(app)/finance/treasury/e-payments/EPaymentsTable.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Decide: merge (redirect /finance/treasury/e-payments to /finance/payments and remove tile) or differentiate.
  2. If merged, add redirect() in e-payments/page.tsx and delete EPaymentsTable.tsx; update tile at finance/page.tsx:30 and any nav manifest entry.
  3. If kept, extract the shared table into payments/PaymentsTable and reuse.
- **Acceptance:**
  - Only one Payments tile leads to the dataset, or both render identical rows with links.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Bookmarks to old route need the redirect.
- **Depends on:** GAP-FINANCE-TREASURY-E-PAYMENTS-03

### GAP-FINANCE-TREASURY-E-PAYMENTS-02  ·  HIGH  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Subtitle promises "bank references" (page.tsx:17) but the table has none; the code comment concedes the endpoint returns no bank, bankRef or date fields (EPaymentsTable.tsx:33-34). No date column at all on a payment order list.
- **Verified evidence:** e-payments/page.tsx:17 subtitle (and finance/page.tsx:30 tile) say 'with bank references'; EPaymentsTable.tsx:33-34 comment states no bank/bankRef/date fields exist on the endpoint response, columns are referenceId/beneficiary/amountDisplay/status. No date column. Whether the API could supply date/UTR cannot be verified (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/e-payments/page.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Change subtitle and tile description to 'Electronic payment orders with status tracking'.
  2. If backend exposes createdAt/utr, add Date and UTR columns; otherwise leave off.
- **Acceptance:**
  - Subtitle mentions only fields shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-TREASURY-E-PAYMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme LINK (was DEADROUTE)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Rows do not link to /finance/payments/{id} although the same rows do there (EPaymentsTable.tsx:42-49 has no rowLink), so UTR and submit-for-approval are unreachable from here.
- **Verified evidence:** EPaymentsTable.tsx:42-49 DataTable has no rowHref, while PaymentsTable.tsx passes rowHref to /finance/payments/${id} (rows carry optional id via mapPayments). Payments detail route exists (finance/payments/[id]).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/e-payments/EPaymentsTable.tsx`
- **Fix steps:**
  1. Add rowHref={(row)=> row.id ? `/finance/payments/${row.id}` : ''} as in PaymentsTable.
  2. Or resolve via the merge decision in E-PAYMENTS-01.
- **Acceptance:**
  - Clicking a row with id opens payment detail; id-less rows are not links.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-TREASURY-E-PAYMENTS-01

### GAP-FINANCE-TREASURY-E-PAYMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Same mapPayments null-on-empty behaviour as the Payments page (loaders.ts:507-510): a tenant with no orders sees the load-failure badge, not "No payment orders".
- **Verified evidence:** mapPayments (loaders.ts:494-511) ends with `return mapped.length > 0 ? mapped : null`, and skips rows with unknown statuses or missing fields. fetchJson treats null as invalid_payload -> {source:'error'} (apiClient.ts:~160). So an empty tenant, or a payload where every row is filtered, yields the load-failure badge. Contrast the ticket mapper comment (~line 486) which fixed the same bug. paymentsListSchema may also reject empty arrays (cannot verify, schemas package absent). Affects getPayments too (loaders.ts:769).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Change the last line of mapPayments to `return mapped`.
  2. But if rows exist and all were dropped (rows.length>0 && mapped.length===0) return null so real mapping failures still surface.
  3. Add loader unit tests: [] -> source 'api' and data []; all-invalid -> 'error'.
- **Acceptance:**
  - Empty array response shows 'No payment orders', no failure badge.
  - Payload of only unknown statuses still shows the error state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Silently dropping unknown statuses (e.g. new backend status) hides payments; the all-dropped guard limits this.

### GAP-FINANCE-TREASURY-E-PAYMENTS-05  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** "Released" and "Pending Approval" render as neutral info pills (StatusPill.tsx:6-38); Queued and Released look alike.
- **Verified evidence:** StatusPill STATUS_MAP (ds/StatusPill.tsx:6-38) has no 'released', 'queued' or 'pending approval' (lowercased lookup), only 'pending'; only 'failed' is mapped ('bad'). All three fall to 'info'. Statuses come from mapPayments' closed union Queued/Released/Pending Approval/Failed (loaders.ts:~505).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add released:'good', 'pending approval':'warn', queued:'mut' to STATUS_MAP.
  2. Add test.
- **Acceptance:**
  - Released renders 'pill good', Pending Approval 'pill warn'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Global component; also recolours Payments register.
- **Depends on:** GAP-FINANCE-TREASURY-CHEQUES-01


---
## /finance/treasury/pfms  —  `finance/treasury-pfms.html`

- **Source:** `apps/web/src/app/(app)/finance/treasury/pfms/page.tsx`
- **Design reference:** `redesign/finance/treasury-pfms.html`

### GAP-FINANCE-TREASURY-PFMS-01  ·  HIGH  ·  confirmed  ·  theme DUPLICATE (was DEADROUTE)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Duplicate surface: /finance/treasury/pfms and /finance/pfms both list the same /pfms/batches data (pfms/page.tsx:12; loaders.ts:1948-1955), but only the second lets an officer sign a batch or download the bank file. From here a pending scroll is a dead end with no link across (PFMSTable.tsx:26-45).
- **Verified evidence:** treasury/pfms/page.tsx uses getFinancePFMSScrolls (loaders.ts:1948-1955) on /api/v1/finance/pfms/batches; finance/pfms/page.tsx:12 fetches the same path. Sign/bank-file actions exist only in finance/pfms/BatchesPanel.tsx (SignBatchAction, BankFileAction at ~lines 50-52). PFMSTable.tsx has no rowLink or link to /finance/pfms. finance/page.tsx lists both tiles (line 29 and 59).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/pfms/page.tsx`, `apps/web/src/app/(app)/finance/treasury/pfms/PFMSTable.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Preferred: redirect /finance/treasury/pfms to /finance/pfms and drop the duplicate tile (line 29).
  2. Alternative: add a prominent link 'Open PFMS Operations' in PageHeader actions of treasury/pfms/page.tsx.
  3. Delete PFMSTable.tsx if redirected.
- **Acceptance:**
  - A pending scroll can be reached in one click from the treasury page to the signing console.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Redirect breaks bookmarks only if omitted; keep redirect.

### GAP-FINANCE-TREASURY-PFMS-02  ·  HIGH  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Subtitle promises "beneficiary verification" (page.tsx:20) but no beneficiary, verification status or count exists anywhere on the page.
- **Verified evidence:** treasury/pfms/page.tsx:20 subtitle says 'payment scroll tracking and beneficiary verification' (also finance/page.tsx:29); the page shows counts by submissionStatus and PFMSTable.tsx columns pfmsId/type/amount/agency/scheme/status with no beneficiary data.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/pfms/page.tsx`, `apps/web/src/app/(app)/finance/page.tsx`
- **Fix steps:**
  1. Change subtitle and tile description to 'Public Financial Management System payment scroll tracking'.
  2. Do not add beneficiary verification unless an API exists.
- **Acceptance:**
  - Subtitle matches visible content.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-TREASURY-PFMS-01

### GAP-FINANCE-TREASURY-PFMS-03  ·  MEDIUM  ·  partly  ·  theme FORMAT (was STATUS)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Type is printed raw (for example "vendor_payment") and Status via humanizeStatus; the Type column has no formatting or label map (PFMSTable.tsx:29).
- **Verified evidence:** PFMSTable.tsx:29 prints type raw (e.g. vendor_payment); no label map (same raw type in finance/pfms/BatchesPanel.tsx:31). But the Status column is not 'via humanizeStatus' in the table: it uses cellType:'status' -> StatusPill which humanizes internally (StatusPill.tsx:~58). Status colour mapping is fine for pending/signed/submitted, so the STATUS theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/pfms/PFMSTable.tsx`, `apps/web/src/app/(app)/finance/pfms/BatchesPanel.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a render for the type column using humanizeStatus(type) (or a PFMS_TYPE_LABELS map in formatters.ts for exact wording).
  2. Reuse in BatchesPanel.
- **Acceptance:**
  - 'vendor_payment' displays as 'Vendor Payment' in both tables.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-TREASURY-PFMS-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** No DDO column here although the console has one (BatchesPanel.tsx colDdo); a scroll cannot be tied to its drawing officer on this page.
- **Verified evidence:** True that PFMSTable.tsx has no DDO column while finance/pfms/BatchesPanel.tsx:35 has { key:'ddoCode' }. Same endpoint, and PfmsBatchRow (finance/pfms/types.ts) has ddoCode, so the data very likely exists; PfmsBatchSummary type/schema is in an absent package so cannot be fully verified (the zod schema might strip the field).
- **Files to change:** `apps/web/src/app/(app)/finance/treasury/pfms/PFMSTable.tsx`
- **Fix steps:**
  1. Check PfmsBatchSummary/PfmsBatchSummaryListSchema in @civitasone/types|schemas for ddoCode and add it if missing.
  2. Add { key:'ddoCode', label:'DDO' } after Scheme in PFMSTable.
  3. Moot if PFMS-01 redirect is chosen.
- **Acceptance:**
  - DDO code column visible and searchable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-TREASURY-PFMS-01


---
## /finance/vendors  —  `finance/vendors.html`

- **Source:** `apps/web/src/app/(app)/finance/vendors/page.tsx`
- **Design reference:** `redesign/finance/vendors.html`

### GAP-FINANCE-VENDORS-01  ·  HIGH  ·  partly  ·  theme WIRING (was OTHER)

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** No way to add, approve or deactivate a vendor: a "Pending Approval" stat exists (page.tsx:24) but neither this list nor the detail page has any action, so a pending vendor cannot be progressed from the UI (VendorsTable.tsx:19-38; vendors/[id]/page.tsx:77-121).
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/page.tsx:24 shows Pending Approval, and neither VendorsTable.tsx nor vendors/[id]/page.tsx has any add/approve/deactivate control - true. But page.tsx:8-10 states no approval workflow exists (status from isActive only) so the stat is always 0; the gap is a missing backend workflow as much as UI. Backend routes cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/page.tsx`, `apps/web/src/app/(app)/finance/vendors/VendorsTable.tsx`, `apps/web/src/app/(app)/finance/vendors/new/page.tsx (new)`
- **Fix steps:**
  1. Backend: add vendor status 'pending' and approve/deactivate commands (audit events, maker!=checker).
  2. Add a 'New vendor' action in PageHeader routing to /finance/vendors/new (zod-validated form).
  3. Add approve/deactivate via VendorActions (see DETAIL-04).
  4. Until backend exists, hide or label the Pending Approval card as 'Not available' instead of a permanent 0.
- **Acceptance:**
  - Pending vendor can be approved from the detail page and Pending count decrements.
  - With no workflow, the card shows '—' not 0.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Vendor onboarding is a fraud control point.
- **Depends on:** GAP-FINANCE-VENDORS-DETAIL-04

### GAP-FINANCE-VENDORS-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** PAN is shown in full for every vendor row and exported to CSV (VendorsTable.tsx:22,34-35). PAN and bank details are identifiers the DPDP rules ask to be minimised; there is no masking or role gate on the export.
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/VendorsTable.tsx:22 lists PAN in full and :34 exportable (DataTable.downloadCsv, ds/DataTable.tsx:274-290) writes all columns incl. PAN with no role check or audit. Bank details are NOT in the list/CSV (columns are name, pan, gstin, category, status), so that part is overstated. Layer tag 'copy' is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/VendorsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/lib/mask.ts (new)`
- **Fix steps:**
  1. Add a render for the PAN column using maskPan (shared with DETAIL-01) - DataTable column.render is client-side here.
  2. Add a per-column csv transform (e.g. Column.csvValue) so the export writes the masked value, or drop the PAN column from export.
  3. Gate the CSV button: only pass exportable when the session role is in a reveal-role list; emit an audit event on export via BFF.
- **Acceptance:**
  - Rendered PAN cell shows ABCDE****F; CSV contains the masked value.
  - User without export role sees no CSV button.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Users who rely on full PAN in CSV for TDS work lose it; agree role list with Finance.
- **Depends on:** GAP-FINANCE-VENDORS-DETAIL-01

### GAP-FINANCE-VENDORS-03  ·  MEDIUM  ·  partly  ·  theme WIRING (was LOADING)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** page.tsx:7,10 call v.status.toLowerCase() directly (not String(...)), so a single row with a null status makes the whole server page throw into error.tsx instead of degrading, unlike the sibling registers that wrap in String() (cheques/page.tsx:7).
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/page.tsx:7 and :10 call v.status.toLowerCase() without String(); sibling pages use String(x.status).toLowerCase() (e.g. finance/debt/page.tsx:7, revenue/challans/page.tsx:7; the cited cheques/page.tsx does not exist). A null status would throw into vendors/error.tsx. Whether null can reach here depends on FinanceVendorSummaryListSchema/type in @civitasone/types, absent from the snapshot, so likelihood is cannot-verify. Theme LOADING is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/page.tsx`
- **Fix steps:**
  1. Change to String(v.status ?? '').toLowerCase() at both lines.
  2. Also guard v.category in the Set at :25 (see VENDORS-05).
- **Acceptance:**
  - Unit/render: vendors list containing {status:null} renders without throwing and counts it as neither active nor pending.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-VENDORS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Missing GSTIN (unregistered vendor) renders as a blank cell with no "Unregistered" cue (VendorsTable.tsx:23), although GST applicability drives TDS and ITC handling.
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/VendorsTable.tsx:23 GSTIN column has no render; ds/DataTable.tsx cellValue (line ~126-141) returns String(row[key] ?? '') so a missing GSTIN is an empty cell with no 'Unregistered' cue. Whether backend sends null vs '' does not matter.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/VendorsTable.tsx`
- **Fix steps:**
  1. Add render to the gstin column: row.gstin ? mono text : <span class='muted'>Unregistered</span>.
  2. Add a text fallback for CSV export via the same csv transform used in VENDORS-02.
- **Acceptance:**
  - Vendor without GSTIN shows 'Unregistered'.
  - Vendor with GSTIN unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-FINANCE-VENDORS-02

### GAP-FINANCE-VENDORS-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** "Categories" counts distinct raw category strings (page.tsx:25), so "Supplier" and "supplier" count twice, and it is the least decision-useful of the four cards.
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/page.tsx:25 uses new Set(vendors.map(v => v.category)).size, case- and whitespace-sensitive, so 'Supplier' and 'supplier' count twice; also undefined counted as one category. Usefulness comment is opinion.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/page.tsx`
- **Fix steps:**
  1. Normalise: new Set(vendors.map(v => (v.category ?? '').trim().toLowerCase()).filter(Boolean)).size.
  2. Optionally replace the card with 'Unregistered (no GSTIN)' count, which is decision-relevant.
- **Acceptance:**
  - Vendors with categories ['Supplier','supplier'] count as 1.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /finance/vendors/[id]  —  `finance/vendors-detail.html`

- **Source:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`
- **Design reference:** `redesign/finance/vendors-detail.html`

### GAP-FINANCE-VENDORS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** PAN, GSTIN, phone, email and the full bank Account number are printed in clear (page.tsx:93-101) for every FINANCE_ROLES member, with no masking, reveal-on-demand or access log; vendor bank accounts are the classic payment-diversion target and PAN is a DPDP identifier.
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/[id]/page.tsx:93-101 renders pan, gstin, email, phone, bankName/ifsc and full bankAccount/accountNumber via field() with no masking or reveal; the only gate is finance/layout.tsx (FINANCE_ROLES, broad: audit_officer, budget_officer, procurement_officer, payroll_admin etc., and fails open when roles are empty). No <Masked> component or mask helper exists in apps/web (grep). Server-side access logging cannot be verified (finance-service absent).
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/lib/mask.ts (new)`, `apps/web/src/lib/auth/workRoles.ts`
- **Fix steps:**
  1. Create lib/mask.ts with maskPan (ABCDE****F), maskAccount (last 4 only) and maskPhone/maskEmail.
  2. Create ds/Masked.tsx (client): shows masked text; a Reveal button visible only to a new VENDOR_PII_ROLES list (e.g. finance_officer, finance_admin, accounts_officer) in workRoles.ts.
  3. On reveal, POST an audit event through the BFF (browserFetch) before showing clear text; auto re-mask after ~30s. Needs a backend endpoint/audit hook.
  4. Replace the PAN, Phone, Email and Account fields at page.tsx:93,98-99,101 with <Masked kind=... value=... />; keep GSTIN clear (public).
  5. Ensure the server does not send full account to roles without reveal right (defence in depth).
- **Acceptance:**
  - Unit: maskAccount('123456789012') -> '********9012'; maskPan('ABCDE1234F') -> 'ABCDE****F'.
  - Component: user without a reveal role sees no Reveal button; with role, click calls audit endpoint then shows clear value and re-masks after timeout.
  - Manual: view-source / RSC payload as auditor shows no full account number.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Payment-diversion and DPDP exposure today; risk of hiding data finance staff legitimately need, so pick reveal roles with Finance. Reveal must be audited server-side.
- **Depends on:** GAP-FINANCE-VENDORS-02

### GAP-FINANCE-VENDORS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1786 (merged)
- **First-pass claim:** A failed fetch is shown as "Vendor not found" (loader returns null on error, apiClient.ts:117-172); the DataSourceBadge at page.tsx:81 is unreachable.
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/[id]/page.tsx:37-46: on any fetchJson failure the loader (loaders.ts:2149-2156, apiClient.ts:117-172) returns data=null,source='error' (plus status/errorMessage), and `if (!vendor)` renders EmptyState 'Vendor not found' - including for 401/403/5xx/network/schema failures. The DataSourceBadge at page.tsx:81 is only reached when vendor is truthy, so it can never show error. Note the `back` link exists but no retry.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`
- **Fix steps:**
  1. Capture the full result: const res = await getFinanceVendorById(id); destructure data, source, status, errorMessage.
  2. If source==='error' && status!==404 return <LoadErrorState result={res} area='vendor' backHref='/finance/vendors' /> (ds/LoadErrorState already handles 403 -> PermissionDenied, else RefreshErrorState).
  3. Only when source==='api' or status===404 and data is null render the 'Vendor not found' EmptyState (or call notFound()).
  4. Remove the dead `actions={source==='error' ? ... }` badge at :81.
- **Acceptance:**
  - Test: loader returning {source:'error',status:500} renders the error state with a Retry button, not 'Vendor not found'.
  - Test: status 403 renders PermissionDenied; status 404 renders not-found.
  - Manual: stop gateway, open /finance/vendors/<id>, see retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only changes error rendering.
- **Depends on:** GAP-FINANCE-VENDORS-DETAIL-01

### GAP-FINANCE-VENDORS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme MONEY (was I18N)

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** "Total Paid" is the sum of every bill amount regardless of bill status (page.tsx:66-69), so pending or rejected bills inflate the figure; the label says paid. TDS Deducted sums the same way (page.tsx:70-73).
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/[id]/page.tsx:66-73 sums amountMinor/amount (and tds) over every row of rawBills with no status filter, shown in a StatCard labelled 'Total Paid' (:85); 'TDS Deducted' (:86) likewise. Pending/rejected bills are included. The bill status vocabulary is not visible (FinanceVendorDetail type/schema is in @civitasone/types, absent from the snapshot). The tagged theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`
- **Fix steps:**
  1. Decide with Finance which statuses count as paid (e.g. 'paid'/'settled'); confirm the enum from FinanceVendorDetail.
  2. In page.tsx compute totalPaid and totalTds only over rawBills whose status (lower-cased) is in PAID_STATUSES; leave undefined when none.
  3. Add a separate 'Total Billed' card (all bills) if useful, and rename labels to match the basis, e.g. 'TDS Deducted (paid bills)'.
  4. Move the statuses constant to a shared finance util so the bills list uses the same definition.
- **Acceptance:**
  - Unit: bills [paid 1000, pending 500, rejected 200] -> Total Paid ₹10.00, Total Billed ₹17.00.
  - Vendor with only pending bills shows '—' (or ₹0.00 by decision) for Total Paid, not the pending sum.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Financial misstatement shown to approvers; status enum must be confirmed before filtering.

### GAP-FINANCE-VENDORS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme WIRING (was CONFIRM)

- [x] **Status** — PR #1840 (merged)
- **First-pass claim:** No actions: a vendor cannot be edited, approved from Pending, blocked, or have bank details changed here (page.tsx:77-121); bank-detail change is the fraud-sensitive workflow that most needs maker-checker.
- **Verified evidence:** True that apps/web/src/app/(app)/finance/vendors/[id]/page.tsx:75-122 has no edit/approve/block/bank-change action; it is a read-only page. But vendors/page.tsx:8-10 comments that status is derived from isActive only and no approval workflow exists, and finance-service is absent, so whether endpoints for vendor update/approve/bank change exist cannot be verified. The maker-checker point is a valid design need, not a defect in existing code.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`, `apps/web/src/lib/finance/vendor.ts (new)`, `apps/web/src/app/(app)/finance/vendors/[id]/VendorActions.tsx (new)`
- **Fix steps:**
  1. Confirm with backend which vendor mutations exist; if none, add them (bank-detail change as a pending request with maker!=checker, audit event).
  2. Create VendorActions.tsx (client) modelled on grants ApplicationActions.tsx using ds/ConfirmDialog with requireReason and minReasonLength.
  3. Create lib/finance/vendor.ts with browserFetch PATCH wrappers; render VendorActions in page.tsx PageHeader actions gated by role.
  4. Show a 'Bank change pending approval' banner with proposer and approver enforced server-side.
- **Acceptance:**
  - Component: Approve opens ConfirmDialog, requires reason, calls PATCH then router.refresh().
  - Backend test: same user proposing and approving bank change gets 403.
  - Audit event emitted for each mutation.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Fraud-sensitive; maker-checker must be enforced server-side, UI alone is insufficient.
- **Depends on:** GAP-FINANCE-VENDORS-01

### GAP-FINANCE-VENDORS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Bank line prints "{bank} ({ifsc})" so a vendor with neither shows "— (—)" (page.tsx:100); Registered Since is raw (page.tsx:102).
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/[id]/page.tsx:100 renders `{field(bankName)} ({field(ifsc)})`, so missing values give '— (—)'. :102 'Registered Since' prints the raw field() string (ISO timestamp) without formatIndianDate, and falls back to createdAt so the label may be wrong.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`
- **Fix steps:**
  1. Build bank line from parts: join non-empty bankName and ifsc, else '—'.
  2. Wrap registeredSince/createdAt with formatIndianDate (lib/formatters.ts), same for bill dates at :60.
  3. Drop createdAt fallback or relabel as 'Created'.
- **Acceptance:**
  - Vendor with no bank data shows a single '—'.
  - Registered Since '2024-03-05T10:00:00Z' shows 05/03/2024.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-FINANCE-VENDORS-DETAIL-06  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Sums use Number() over paise (page.tsx:66-73) rather than bigint; large cumulative vendor totals can lose precision above 2^53 paise, contrary to the paise-bigint rule in CLAUDE.md.
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/[id]/page.tsx:16-24 amountMinorOf converts bigint/string to Number and :66-73 sums with Number, so it does bypass bigint. However JSON.parse already yields Number, and precision loss needs > 9.007e15 paise (~₹9e13), which is unrealistic for one vendor. It is a rule/consistency issue, not a live bug. formatMoney (lib/formatters.ts:90) already accepts bigint/string.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`
- **Fix steps:**
  1. Change amountMinorOf to return bigint|undefined (BigInt(string) for integer strings, Math.trunc for numbers).
  2. Sum with bigint and pass to formatMoney, which supports bigint.
  3. Optionally move the helper to lib/money.ts for reuse.
- **Acceptance:**
  - Unit: sum of '9007199254740993' and '1' renders exact ₹90,07,19,92,54,740.94.
  - Existing bill rows render unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Very low; downgrade severity to low.
- **Depends on:** GAP-FINANCE-VENDORS-DETAIL-03

### GAP-FINANCE-VENDORS-DETAIL-07  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1817 (merged)
- **First-pass claim:** Bill rows are not links to the bill detail, and amounts are pre-formatted strings so the Amount and TDS columns are not sortable numerically (page.tsx:55-65,108-120).
- **Verified evidence:** apps/web/src/app/(app)/finance/vendors/[id]/page.tsx:55-65 BillRow has no id and DataTable (:108-120) has no rowLinkKey, so rows are not links (a detail route exists at finance/expenditure/bills/[id]); true. But the table is not `sortable` at all (prop not passed), so the issue is not lexical sorting of formatted strings - there is no sorting. Amount/TDS are pre-formatted strings, so enabling sortable would sort them wrongly.
- **Files to change:** `apps/web/src/app/(app)/finance/vendors/[id]/page.tsx`
- **Fix steps:**
  1. Include the bill id in BillRow and set rowLinkKey='id' rowLinkPrefix='/finance/expenditure/bills/' after confirming the vendor payload's bill ids match that route.
  2. Change amount/tds columns to cellType:'amount' with raw minor numbers so DataTable formats and sorts them numerically.
  3. Add sortable and pageSize props.
- **Acceptance:**
  - Clicking a bill row opens /finance/expenditure/bills/<id>.
  - Sorting Amount descending orders ₹9.00 below ₹10,000.00.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Verify the bill id in vendor payload is the expenditure bill id (cannot verify, finance-service absent).


---
## Backend verification items (service code absent from snapshot)

### GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Per-row Print link (GLTable.tsx:132-137) opens a PDF through /api/proxy/v1/finance/journals/:id/pdf; that endpoint's role guard is undeterminable (finance-service absent from the snapshot).
- **Service:** `finance-service`  ·  **Endpoint(s):** `['GET /v1/finance/journals/:id/pdf']`
- **Question:** Does the journal PDF endpoint enforce the same reader roles as GET /v1/finance/journals and tenant scoping?
- **How to verify:** Open the pdf route in finance-service; check requireRole/READER_ROLES and tenant filter. curl as a non-finance role, expect 403.
- **Test to add:** Given role without finance read when GET journals/:id/pdf then 403; journal of another tenant returns 404.
- **Impact if wrong:** Journal PDFs downloadable by unauthorised users or cross-tenant.
- **Web change if wrong:** none

### GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** No period-close check on posting date in the client: the client never checks the period status, so a date in a closed period is only caught, if at all, by the backend (undeterminable; finance/period-close/page.tsx exists as a separate screen).
- **Service:** `finance-service`  ·  **Endpoint(s):** `['POST /v1/finance/journals']`
- **Question:** Does POST journals reject a postingDate in a closed period with a clear error code?
- **How to verify:** Open journals create handler in finance-service; check a period-status lookup. Close a period then POST with a date in it, expect 409/422.
- **Test to add:** Given period 2026-03 closed when POST journal dated 2026-03-15 then 422 PERIOD_CLOSED and nothing is posted.
- **Impact if wrong:** Postings into closed periods corrupt filed accounts.
- **Web change if wrong:** Map PERIOD_CLOSED to a friendly message in JournalEntryForm.tsx; optionally pre-check period status.

### GAP-FINANCE-AUDIT-PARAS-DETAIL-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1795 (merged)
- **First-pass claim:** Timeline dates are printed as delivered (raw, page.tsx:44-46,114), and free-text observation/reply may name officers, shown to every FINANCE_ROLES member (layout.tsx:29-34; per-endpoint guard undeterminable).
- **Service:** `finance-service`  ·  **Endpoint(s):** `['GET /v1/finance/audit-paras/:id']`
- **Question:** Is GET audit-paras/:id restricted to audit/finance roles per endpoint, and are dates ISO strings?
- **How to verify:** Open audit-paras routes in finance-service; check READER_ROLES and response date format.
- **Test to add:** Given role budget_officer when GET audit para then 403 if not permitted; dates are ISO-8601.
- **Impact if wrong:** Officer names in audit observations exposed to unrelated finance roles.
- **Web change if wrong:** Format timeline dates with formatIndianDate at audit-paras/[id]/page.tsx:44-46,114 regardless.

### GAP-FINANCE-BUDGET-SANCTIONS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1797 (merged)
- **First-pass claim:** Button "+ New Sanction" is rendered for every FINANCE_ROLES member (page.tsx:23); who may raise sanctions is enforced only by finance-service (absent, undeterminable), so audit/budget-read roles can hit a 403 after the dialog.
- **Service:** `finance-service`  ·  **Endpoint(s):** `['POST /v1/finance/sanctions']`
- **Question:** Which roles may POST sanctions and does the API return 403 with a clear code for others?
- **How to verify:** Open sanctions create handler in finance-service; read requireRole list. curl as audit_officer, expect 403.
- **Test to add:** Given audit_officer when POST sanction then 403 FORBIDDEN; given finance_officer then 201.
- **Impact if wrong:** Users fill a dialog then hit a late 403; if permissive, unauthorised sanctions.
- **Web change if wrong:** Hide/disable + New Sanction for roles outside the create list (sanctions/page.tsx:23).

### GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** "Approve sanction" is shown to every FINANCE_ROLES member on a pending sanction (page.tsx:24,41); the distinct-approver rule exists only in dialog copy (FinanceActions.tsx:106) - enforcement is server-side, undeterminable here; no proposer is shown on the page to make the check visible.
- **Service:** `finance-service`  ·  **Endpoint(s):** `['POST /v1/finance/sanctions/:id/approve', 'GET /v1/finance/sanctions/:id']`
- **Question:** Does approve reject when the approver equals the proposer (createdBy) and restrict to approver roles?
- **How to verify:** Open approve handler in finance-service; check createdBy != actor and requireRole(APPROVER_ROLES). curl as proposer expect 403/409.
- **Test to add:** Given sanction created by A when A approves then 403 SELF_APPROVAL; when approver B approves then 200 and audit event.
- **Impact if wrong:** Self-approval of sanctions defeats maker-checker.
- **Web change if wrong:** Show proposer on the detail page and hide Approve for the proposer/non-approvers.

### GAP-FINANCE-CHART-OF-ACCOUNTS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Balance is "₹" + a preformatted balanceDisplay string (AccountsTable.tsx:143): grouping, sign and paise are decided server-side (undeterminable) and a negative or lakh-grouped value depends on it; other pages format via formatMoney(paise).
- **Service:** `finance-service`  ·  **Endpoint(s):** `['GET /v1/finance/accounts']`
- **Question:** Is balanceDisplay a locale-formatted string with sign, and is a numeric balance in paise also returned?
- **How to verify:** Open the accounts list handler/schema in finance-service; inspect balanceDisplay and any balance minor field.
- **Test to add:** Given an account with balance -1234567 paise when listed then balanceMinor=-1234567 is present and balanceDisplay is '-12,345.67' lakh-grouped.
- **Impact if wrong:** Wrong/unsigned balances shown to accountants.
- **Web change if wrong:** Use formatMoney(balanceMinor) in AccountsTable.tsx:143 instead of prefixing the display string.

### GAP-FINANCE-CHART-OF-ACCOUNTS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1804 (merged)
- **First-pass claim:** Hub tile promises a "hierarchical account tree" (finance/page.tsx:9) but the screen is a flat list; "+ Add Head" is shown to every FINANCE_ROLES member (page.tsx:24) with the create authority enforced only server-side (undeterminable).
- **Service:** `finance-service`  ·  **Endpoint(s):** `['POST /v1/finance/accounts', 'GET /v1/finance/accounts']`
- **Question:** Which roles may create account heads, and does GET return parentId for building a tree?
- **How to verify:** Open accounts routes in finance-service; read requireRole for POST and the list schema for parentId.
- **Test to add:** Given non-admin when POST account then 403; list items include parentId.
- **Impact if wrong:** Unauthorised head creation; hub copy misleading.
- **Web change if wrong:** Gate + Add Head by role and either render a tree or reword the hub tile (finance/page.tsx:9).

### GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1805 (merged)
- **First-pass claim:** Both actions render for every FINANCE_ROLES member; the maker-checker rule (distinct officer) is stated in dialog copy but enforced only server-side, absent from the snapshot (FinanceActions.tsx:130,145).
- **Service:** `finance-service`  ·  **Endpoint(s):** `['POST /v1/finance/bills/:id/pass', 'POST /v1/finance/bills/:id/pay']`
- **Question:** Do pass and pay require distinct users (maker != checker) and respective roles?
- **How to verify:** Open bill pass/pay handlers in finance-service; check actor != preparer/passer. curl pay as the passer expecting 403/409.
- **Test to add:** Given bill passed by A when A pays then 409 MAKER_CHECKER; when B pays then 200.
- **Impact if wrong:** Single officer can pass and pay a bill; fraud risk.
- **Web change if wrong:** Hide or disable the action for the same officer in FinanceActions.tsx:130,145.

### GAP-FINANCE-JOURNAL-ENTRY-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1807 (merged)
- **First-pass claim:** Voucher number is typed by hand (placeholder JV-2026-001) rather than allocated by the server, risking duplicates; the backend duplicate handling is undeterminable (finance-service absent).
- **Service:** `finance-service`  ·  **Endpoint(s):** `['POST /v1/finance/journals']`
- **Question:** Does POST journals enforce a unique voucher number per tenant (409 on duplicate) or allocate it server-side when omitted?
- **How to verify:** Open the journals create handler/schema in finance-service; check unique index on (tenantId, voucherNo). POST the same voucherNo twice, expect 409 on the second.
- **Test to add:** Given voucherNo JV-2026-001 exists when POST again then 409 DUPLICATE_VOUCHER and no second journal is posted.
- **Impact if wrong:** Duplicate voucher numbers break audit trail and reconciliation.
- **Web change if wrong:** Make voucher field read-only/auto-allocated in JournalEntryForm.tsx and map 409 to a friendly message.

### GAP-FINANCE-PAYMENTS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1810 (merged)
- **First-pass claim:** PFMS Sync and + New Payment render for every FINANCE_ROLES member (page.tsx:20; layout.tsx:29-36); roles such as audit_officer or budget_officer will hit a backend 403 after typing a reason. Backend guard undeterminable.
- **Service:** `finance-service`  ·  **Endpoint(s):** `['POST /v1/finance/payments', 'POST /v1/finance/payments/pfms-sync']`
- **Question:** Which roles may create payments and trigger PFMS sync, and does the API 403 audit/budget officers before requiring a reason?
- **How to verify:** Open payments routes in finance-service; read requireRole lists. curl POST as audit_officer expecting 403.
- **Test to add:** Given audit_officer when POST payment then 403; given accounts_officer then 201.
- **Impact if wrong:** Unauthorised payment creation, or wasted user effort on a late 403.
- **Web change if wrong:** Gate PaymentActions by role in finance/_components/FinanceActions.

### GAP-FINANCE-REVENUE-CHALLANS-DETAIL-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1790 (merged)
- **First-pass claim:** Every row link in the Challan Register lands here, yet the source comment says the backend GET /challans/:id route does not exist (page.tsx:6-14), so the whole list-to-detail journey ends on "Challan detail not available"; the register is a dead end today. Backend absent from snapshot, so unverifiable.
- **Service:** `finance-service`  ·  **Endpoint(s):** `['GET /v1/finance/challans/:id']`
- **Question:** Does GET /v1/finance/challans/:id exist and return the challan with tenant scoping and finance read roles?
- **How to verify:** Grep finance-service revenue routes for '/v1/finance/challans/:id'; curl with a valid challan id expecting 200, unknown id 404.
- **Test to add:** Given a challan id from the list when GET challans/:id then 200 with same id; other tenant's id returns 404.
- **Impact if wrong:** Register rows lead to a dead detail page.
- **Web change if wrong:** If route missing, remove row links in the register or fall back to list data (challans/[id]/page.tsx:6-14; comment says it is now wired).

### GAP-FINANCE-TRAVEL-04  ·  LOW  ·  partly  ·  theme BACKEND

- [x] **Status** — PR #1814 (merged)
- **First-pass claim:** The old finance travel-claims routes are described as 404 (page.tsx:3-8); finance-service is absent from the snapshot so this cannot be confirmed.
- **Service:** `hrms-service`  ·  **Endpoint(s):** `['redirect /finance/travel -> /hr/travel']`
- **Question:** 
- **How to verify:** Check finance-service has no /v1/finance/travel-claims route.
- **Test to add:** Route test: GET /v1/finance/travel-claims returns 404 in finance-service.
- **Impact if wrong:** Low: stale redirect only.
- **Web change if wrong:** none
- **Finding:** finance/travel/page.tsx:10 redirects to /hr/travel so the web no longer calls finance travel-claims. Same role-gate mismatch as expenses/loans/medical applies (hr/layout.tsx HR_ROLES lacks finance roles). finance-service absent so the 404 claim cannot be confirmed.


---
## Cannot verify from the snapshot

### GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-05 · /finance/budget/sanctions/[id]
- [x] **Status** — PR #1845 (merged): REFUTED: SanctionDetailSchema defaults lineItems/approvalTrail to []
- **First-pass claim:** sanction.lineItems.length and sanction.approvalTrail.length are read without optional chaining (page.tsx:81,89) and status is .replace()d (page.tsx:49): if the endpoint omits either array the page throws and lands on the finance error boundary instead of rendering the sanction.
- **Why cannot-verify:** Line refs are right: sanction.lineItems.length (page.tsx:81), sanction.approvalTrail.length (89), sanction.status.replace (49) are unguarded. But the loader validates against SanctionDetailSchema from @civitasone/types (loaders.ts:1886), which is not in this snapshot, so whether those fields are required or optional is unknown. If required, a missing array fails the schema and the page shows the error/not-found path rather than throwing; if optional, the TypeScript type would already force guards. The stated crash is only plausible if the schema marks them optional or defaulted incorrectly.

### GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-04 · /finance/expenditure/bills/[id]
- [x] **Status** — PR #1845 (merged): REFUTED: getBillDetail always returns lineItems []
- **First-pass claim:** Line-item Unit Price is typed number and passed to formatMoney (paise) while Amount is a paise string (BillLineItemsTable.tsx:7-13): if the API returns rupees for unitPrice it displays 100x too small.
- **Why cannot-verify:** BillLineItemsTable.tsx:10,27-28 types unitPrice as number and calls formatMoney (treats as paise) while amount is a paise string (37). Whether the API sends unitPrice in paise or rupees depends on BillDetailSchema in @civitasone/types and finance-service, both absent. Code is consistent if paise; no evidence for rupees.


---
## Refuted by deep pass — do NOT implement

### GAP-FINANCE-TREASURY-PFMS-05 · /finance/treasury/pfms
- **First-pass claim:** StatusPill maps "signed" green and "pending" amber but not "submitted" (StatusPill.tsx:6-38), so the third counted status renders neutral.
- **Why refuted:** StatusPill STATUS_MAP (ds/StatusPill.tsx) contains submitted:'warn' (line 21-ish, next to pending/'in progress'), so 'submitted' renders amber, not neutral. signed:'good' and pending:'warn' also present. No defect (a 'submitted' warn tone is debatable semantically but it is mapped).
