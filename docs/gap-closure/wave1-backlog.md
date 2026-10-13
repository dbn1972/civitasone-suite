# Wave 1 backlog: shared fixes (W0-09)

Generated from `w0-shared-fixes-status.md` (W0-05). Of the 20 shared fixes, 2 are DONE (SF-04 StatusPill, SF-10 resolveEmployeeForActor), 17 are PARTIAL and 1 is MISSING (SF-13). Each row below is one Wave 1 PR. The full "still needs" detail and site counts are in the status table.

Order: shared fixes that close data-correctness or security items first, then consistency fixes. Each PR:

- ticks every ledger item it closes;
- re-confirms the PROVISIONAL ticks of any module it changes;
- adds a guard (lint, grep or contract test) so the old pattern cannot come back.

| Order | SF | PR scope (summary) | Why this order |
|---|---|---|---|
| 1 | SF-12 Paise parser | Move the remaining float-money sites to `rupeesToMinorString`, including the new revenue defects. Merge the duplicate paise formatters. Add a guard against `Number(x)*100`. | Money correctness |
| 2 | SF-05 Masked + audit | Adopt `ds/Masked` with audited reveal across the PII surfaces (143 files mention PII fields; 17 use Masked today). | PII and DPDP |
| 3 | SF-16 Self-scoping (backend) | Make the self-scope helper shared, replacing the 4 local copies. Cover the service-book routes. | Access scope (IDOR) |
| 4 | SF-20 Layout guards | Add ModuleGate and requireAnyRole layouts for admin, approvals, change, dashboard, help, notifications, settings and setup. | Access scope |
| 5 | SF-09 Role constants | Replace the inline role arrays (85 hr/payroll files) with shared constants, and shrink the matrix-test drift allowlist. | Access scope |
| 6 | SF-02 + SF-03 Error vs empty | Guard the 21 bare `notFound()` calls by status, fix 2 zero-default StatCards, fix 15 empty-to-null mappers, and add a lint guard. | Data truthfulness |
| 7 | SF-08 DataTable export | Put export permission and audit on the 10 CSV exports that bypass it. | PII and audit |
| 8 | SF-15 Async 202 UX | Use `useAsyncMutation` in place of the 25 timer-based reloads. | Correctness |
| 9 | SF-14 Form primitives | Adopt `ds/Field` and `ds/Input` plus `useFormError`, and remove the 14 raw response-text errors. | Consistency |
| 10 | SF-06 Pickers | Replace the 12 raw-UUID inputs with EntityPicker or EmployeePicker. | Usability |
| 11 | SF-01 ModuleListTable | Move the 63 bare-table list pages onto ModuleListPage, put a shared id formatter in place of 74 truncated-id sites, and add a guard. | Consistency |
| 12 | SF-19 Modal and confirm | Replace the 23 hand-rolled dialogs and 26 native confirm calls. | Accessibility |
| 13 | SF-07 IST dates | Fix the 26 UTC-today sites and remove the duplicate `todayIST`. Sweep the locale-string calls. | Correctness |
| 14 | SF-17 Thin list APIs | Add name enrichment and typed response schemas, which closes many "raw id instead of name" items. | Usability |
| 15 | SF-11 Loading skeletons | Use the shared skeleton in the remaining 390 `loading.tsx` files, and add the missing `.skeleton` CSS. | Consistency |
| 16 | SF-13 Alert and tokens (MISSING) | Create `ds/Alert`, then sweep the 337 files with inline hex. | Design system |
| 17 | SF-18 Route-existence | Measure the allowlist and cover runtime-built row links. | Dead links |

Large SFs (01, 11, 13, 14) are split into several PRs by module group, so no PR exceeds about 40 files. All Wave 1 PRs merge in bundles, per the owner bundle-merge rule.
