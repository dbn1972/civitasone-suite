# CivitasOne Mobile App — Production Readiness Audit Report

**Date:** 2025-01-15  
**Scope:** 176 Dart files, 26 feature modules, ~44 existing tests  
**Flutter:** 3.22+ | **Dart SDK:** ≥3.3.0  

---

## Executive Summary

The mobile app demonstrates solid architecture foundations — Riverpod for state, go_router for navigation, Dio for HTTP, and a sophisticated Gmail-style offline sync engine (SQLite + outbox). However, several screens fall short of production readiness due to missing UX states, inconsistent accessibility, and hardcoded strings that bypass the ARB localization system.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Architecture Compliance | 0 | 2 | 3 | 2 |
| Accessibility | 1 | 4 | 5 | 3 |
| UX Patterns | 0 | 5 | 8 | 4 |
| Code Quality | 1 | 3 | 6 | 4 |
| **Total** | **2** | **14** | **22** | **13** |

---

## 1. Architecture Compliance

### ✅ Compliant

| Rule | Status | Evidence |
|------|--------|----------|
| Riverpod for state | ✅ Pass | All screens use `ConsumerWidget` / `ConsumerStatefulWidget` |
| go_router for navigation | ✅ Pass | `main.dart` defines all routes via `GoRouter` |
| Dio for HTTP | ✅ Pass | `core/api_client.dart` wraps Dio with interceptors |
| Retry on 5xx | ⚠️ Partial | ApiClient retries only on 401; no general 5xx retry interceptor |
| Offline-first writes | ✅ Pass | `SyncEngine` + `SyncDatabase.enqueueOutbox()` with dead-letter |
| Auth token injection | ✅ Pass | `_onRequest` interceptor adds Bearer token |
| Timeout enforcement | ✅ Pass | `connectTimeout: 15s`, `receiveTimeout: 30s` |

### ⚠️ Issues

| # | Severity | Issue | File | Line |
|---|----------|-------|------|------|
| A1 | **High** | No retry interceptor for 5xx errors. Steering requires 3 attempts with backoff on 5xx. Only 401 is retried. | `lib/core/api_client.dart` | 68-82 |
| A2 | **High** | `BillApprovalScreen` and `MyTasksScreen` use direct `apiClientProvider` calls without offline queueing. Writes go through Dio directly (not outbox). If offline, they fail with no local persistence. | `lib/features/finance/bill_approval_screen.dart` | 87-104 |
| A3 | **Medium** | `PaymentsScreen` and `IndentsScreen` use `FutureBuilder` inside `AsyncValue.when()`. Changing state triggers full rebuild instead of granular updates. Should use Riverpod `FutureProvider` + `select`. | `lib/features/finance/payments_screen.dart` | 28-47 |
| A4 | **Medium** | `DashboardScreen` (main) uses `GridView.count` with `shrinkWrap: true` for quick actions. Not ideal for long lists but acceptable here (only 8 items). | `lib/main.dart` | 283-295 |
| A5 | **Medium** | Several screens use `setState` for local UI state (loading, error) alongside Riverpod. While acceptable for ephemeral UI state, `bill_approval_screen.dart` and `my_tasks_screen.dart` manage full data lifecycle via setState — should use `StateNotifier` or `AsyncNotifier`. | `lib/features/finance/bill_approval_screen.dart` | 22 |
| A6 | **Low** | `LoginScreen` in `main.dart` uses `setState` (acceptable — it's pre-auth, no Riverpod context needed) | `lib/main.dart` | 201 |
| A7 | **Low** | `enabledModulesProvider` is `autoDispose` which means module list re-fetches on every navigation. Consider caching. | `lib/core/module_gating.dart` | 33 |

---

## 2. Accessibility Audit

### ✅ Good Practices Found

- `SkeletonCard` has `Semantics(label: 'Loading content')` ✓
- `SkeletonList` has `Semantics(label: 'Loading list')` ✓
- `SyncStatusIndicator` has full Semantics with button role and dynamic labels ✓
- `AppCacheBanner` has proper Semantics label ✓
- Touch targets on `SyncStatusIndicator` enforce ≥ 48dp ✓

### ⚠️ Issues

| # | Severity | Issue | File | Line |
|---|----------|-------|------|------|
| AC1 | **Critical** | `DashboardScreen` quick action grid uses `InkWell` without `Semantics` widget or `semanticLabel`. Screen readers cannot identify these action tiles. | `lib/main.dart` | 279-300 |
| AC2 | **High** | `_QuickAction` in `BusinessDashboardScreen` — `InkWell` with no Semantics. Icon + label text exists but is not explicitly associated for screen readers. | `lib/features/dashboard/business_dashboard_screen.dart` | 258-278 |
| AC3 | **High** | `GpsCheckInScreen` selfie capture uses `InkWell` on Card without explicit semantic role or label. | `lib/features/attendance/gps_checkin_screen.dart` | 127-163 |
| AC4 | **High** | Icon-only `IconButton` widgets in several screens (sync button) have `tooltip` but no explicit `semanticLabel` on the icon itself (tooltip covers this for most assistive tech, but belt-and-suspenders is recommended). | Multiple screens | — |
| AC5 | **High** | `_FilterChip` in `MyTasksScreen` uses `InkWell` without Semantics — selected/unselected state not communicated to screen readers. | `lib/features/workflow/my_tasks_screen.dart` | 214-243 |
| AC6 | **Medium** | Hardcoded colors (`Colors.green`, `const Color(0xFF22C55E)`) on action buttons without ensuring WCAG 4.5:1 contrast against white text. Green (#22C55E) on white text = 2.8:1 contrast ratio (FAIL). | `lib/features/attendance/gps_checkin_screen.dart` | 177-179 |
| AC7 | **Medium** | Module list cards in DashboardScreen use decorative icons without `ExcludeSemantics`. | `lib/main.dart` | 307-322 |
| AC8 | **Medium** | `_StatCard` in BusinessDashboardScreen does not have semantic labels combining label + value for screen readers. | `lib/features/dashboard/business_dashboard_screen.dart` | 222-254 |
| AC9 | **Medium** | `_PriorityBadge` widget uses colored text without sufficient alternative for colorblind users. | `lib/features/workflow/my_tasks_screen.dart` | 319-348 |
| AC10 | **Medium** | Touch targets on filter chips appear to be < 48dp (padding is 8px horizontal, 8px vertical = ~32dp height). | `lib/features/workflow/my_tasks_screen.dart` | 229 |
| AC11 | **Low** | Missing `Tooltip` on decorative icons in list items across multiple screens. | Multiple | — |
| AC12 | **Low** | `AppSummaryRow` uses white text on gradient backgrounds — contrast depends on dynamic color scheme. | `lib/core/widgets/shared_widgets.dart` | 131-145 |
| AC13 | **Low** | No explicit `textScaleFactor` handling — very large text scales may overflow card layouts. | Multiple | — |

---

## 3. UX Pattern Audit

### Per-Screen Summary

| Screen | Loading | Error | Empty | Pull-to-Refresh | Form Validation | Offline Indicator |
|--------|---------|-------|-------|-----------------|-----------------|-------------------|
| DashboardScreen (main) | ❌ No shimmer | ❌ None | ❌ None | ❌ None | N/A | ❌ |
| BusinessDashboardScreen | ✅ Spinner | ❌ Basic | ✅ "No activity yet" | ✅ | N/A | ✅ Banner |
| PaymentsScreen | ⚠️ Spinner only | ⚠️ Raw error text | ✅ Text only | ✅ | N/A | ❌ |
| IndentsScreen | ⚠️ Spinner only | ⚠️ Raw error text | ⚠️ "No data" | ✅ | N/A | ❌ |
| PurchaseOrdersScreen | ⚠️ Spinner only | ⚠️ Raw error text | ⚠️ "No data" | ✅ | N/A | ❌ |
| ApprovalsScreen | ✅ SkeletonList | ✅ Retry button | ✅ Icon + message | ✅ | N/A | ❌ |
| BillApprovalScreen | ✅ Spinner | ✅ Retry button | ✅ Icon + message | ✅ | ✅ Inline (reject) | ❌ |
| GpsCheckInScreen | ✅ GPS acquiring | N/A | N/A | ✅ | N/A | ✅ Banner |
| AttendanceHistoryScreen | – | – | – | – | – | – |
| TicketsScreen | ✅ SkeletonList | ✅ Retry button | ✅ With CTA | ✅ | N/A | ❌ |
| MyTasksScreen | ✅ Spinner | ✅ Retry button | ✅ Filter-aware | ✅ | ✅ Inline | ❌ |
| JournalScreen | ⚠️ Spinner only | ⚠️ Raw error | ⚠️ "No data" | ✅ | N/A | ❌ |
| BudgetDashboardScreen | – | – | – | – | – | – |
| SettingsScreen | – | – | – | – | – | – |

### ⚠️ Issues

| # | Severity | Issue | File |
|---|----------|-------|------|
| UX1 | **High** | `DashboardScreen` (main — the employee home screen) has NO loading, error, or empty states. If `enabledModulesProvider` fails, the screen renders silently with defaults. | `lib/main.dart:265` |
| UX2 | **High** | `PaymentsScreen` shows raw error text (`'Error: $e'`) instead of user-friendly message + retry. | `lib/features/finance/payments_screen.dart:32` |
| UX3 | **High** | `IndentsScreen` shows raw error text with no retry button. | `lib/features/procurement/indents_screen.dart:32` |
| UX4 | **High** | 4 screens (`payments`, `indents`, `pos`, `journal`) show "No data — pull to refresh" as plain text without icon or proper styling. | Multiple |
| UX5 | **High** | `BillApprovalScreen` and `MyTasksScreen` make direct HTTP calls but show no offline indicator when requests fail due to connectivity. | `lib/features/finance/bill_approval_screen.dart` |
| UX6 | **Medium** | `PaymentsScreen` empty state doesn't guide the user or explain what payments would appear. | `lib/features/finance/payments_screen.dart:37` |
| UX7 | **Medium** | Skeleton/shimmer loading is only used in `ApprovalsScreen` and `TicketsScreen`. Other screens use plain `CircularProgressIndicator`. | Multiple |
| UX8 | **Medium** | No skeleton for `BillApprovalScreen` — shows spinner but cards appear suddenly with no transition. | `lib/features/finance/bill_approval_screen.dart:135` |
| UX9 | **Medium** | `GpsCheckInScreen` lacks error recovery if GPS acquisition fails permanently (only shows error text, no retry). | `lib/features/attendance/gps_checkin_screen.dart` |
| UX10 | **Medium** | Form validation inconsistency: `BillApprovalScreen` reject dialog uses `FormState.validate()` (good), but `MyTasksScreen` delegate dialog also uses FormState validation, while complete dialog has no validation requirement. | Various |
| UX11 | **Medium** | `BusinessDashboardScreen` has no error state — if `listEntities` throws, the loading spinner stays forever. | `lib/features/dashboard/business_dashboard_screen.dart:84-115` |
| UX12 | **Medium** | No haptic feedback on critical actions (approve/reject) in Approvals or BillApproval screens. | Multiple |
| UX13 | **Low** | Pull-to-refresh not available on `DashboardScreen` (main). | `lib/main.dart:265` |
| UX14 | **Low** | Filter chips in `MyTasksScreen` have no count badges (e.g., "Overdue (3)"). | `lib/features/workflow/my_tasks_screen.dart` |
| UX15 | **Low** | No animation or transition when items are removed from list after approve/reject. | Multiple |
| UX16 | **Low** | No confirmation feedback (e.g., checkmark animation) after successful check-in. Only a SnackBar. | `lib/features/attendance/gps_checkin_screen.dart` |

---

## 4. Missing Test Coverage

### Feature Module Test Matrix

| # | Feature Module | Has Tests? | Test Files |
|---|---------------|------------|------------|
| 1 | assets | ❌ | — |
| 2 | attendance | ✅ | 3 test files |
| 3 | bills | ✅ | Has test dir |
| 4 | citizen_requests | ✅ | Has test dir |
| 5 | contracts | ❌ | — |
| 6 | crm | ❌ | — |
| 7 | customers | ✅ | Has test dir |
| 8 | dashboard | ✅ | 1 test file (biz dashboard only) |
| 9 | directory | ✅ | Has test dir |
| 10 | estab | ❌ | — |
| 11 | expenses | ✅ | Has test dir |
| 12 | finance | ✅ (partial) | 2 files (journal + payments, missing bill_approval + budget) |
| 13 | helpdesk | ✅ | Has test dir |
| 14 | hr | ✅ | Has test dir |
| 15 | invoicing | ✅ | Has test dir |
| 16 | knowledge | ❌ | — |
| 17 | mis | ❌ | — |
| 18 | notifications | ❌ | — |
| 19 | payments | ✅ | Has test dir |
| 20 | procurement | ✅ (partial) | 2 files (indents + pos, missing approvals) |
| 21 | projects | ❌ | — |
| 22 | reports | ❌ | — |
| 23 | settings | ❌ | — |
| 24 | stock_scanner | ✅ | Has test dir |
| 25 | sync | ❌ (feature screen) | Core sync has 7 test files |
| 26 | workflow | ❌ | — |

**Untested critical features:** workflow, contracts, crm, estab, knowledge, mis, notifications, projects, reports, settings, assets

### Tests Written (5 Critical Untested Features)

New test files created in `test/features/`:
1. `test/features/dashboard/dashboard_screen_test.dart` — Main employee dashboard
2. `test/features/finance/bill_approval_test.dart` — Bill approval flow
3. `test/features/procurement/approvals_test.dart` — Procurement approvals
4. `test/features/workflow/my_tasks_test.dart` — Workflow tasks
5. `test/features/attendance/attendance_offline_test.dart` — Offline sync verification

---

## 5. Code Quality Issues

| # | Severity | Issue | File | Line |
|---|----------|-------|------|------|
| CQ1 | **Critical** | Hardcoded `'http://10.0.2.2:8080'` and `'http://10.0.2.2:8180/...'` as default values in providers. While using `String.fromEnvironment`, the defaults are emulator-specific and could leak to production builds if `--dart-define` is missed. Should fail-fast if not provided. | `lib/core/providers.dart` | 6-12 |
| CQ2 | **High** | 60+ hardcoded English strings in widget trees bypass the ARB i18n system. Examples: `'Check In'`, `'GPS Status'`, `'Offline — will sync when connected'`, `'No pending approvals'`, `'Unable to load data'`, etc. The app has ARB files but screens don't import `AppLocalizations`. | Multiple screens | — |
| CQ3 | **High** | `BillApprovalScreen` catches all exceptions with bare `catch (e)` and shows `'Failed to approve: $e'` — raw Dart exception messages shown to users. Should parse DioException for user-friendly messages. | `lib/features/finance/bill_approval_screen.dart` | 101, 146 |
| CQ4 | **High** | `MyTasksScreen` same issue — raw exception in SnackBar: `'Failed: $e'`. | `lib/features/workflow/my_tasks_screen.dart` | 114, 158 |
| CQ5 | **Medium** | Magic numbers: `const Duration(milliseconds: 1200)` splash delay, `800` for GPS, `300` for selfie, all without named constants. | `lib/main.dart`, `lib/features/attendance/gps_checkin_screen.dart` |
| CQ6 | **Medium** | `DashboardScreen._quickActions` and `_modules` use hardcoded `Color(0xFF...)` values instead of referencing theme or a named palette. | `lib/main.dart:301-322` |
| CQ7 | **Medium** | `_BillCard` widget is deeply nested (Card → Padding → Column → Row → Container → Column) — 6 levels. Should extract sub-widgets. | `lib/features/finance/bill_approval_screen.dart:184-260` |
| CQ8 | **Medium** | No `@visibleForTesting` annotation on `connectivityOverride` parameters. | `lib/features/attendance/gps_checkin_screen.dart:8` |
| CQ9 | **Medium** | `FutureBuilder` inside `AsyncValue.when(data:)` creates a double-async pattern that doesn't properly handle rebuilds. If the FutureBuilder's future is recreated on rebuild, it causes flicker. | `lib/features/finance/payments_screen.dart:30-46` |
| CQ10 | **Medium** | `_indianFormat` utility duplicated implicitly — should be in a shared `format_utils.dart`. | `lib/features/finance/bill_approval_screen.dart:47-61` |
| CQ11 | **Low** | `// ignore: discarded_futures` used 3 times in `main.dart` — fire-and-forget async is intentional but should use `unawaited()` from `dart:async` for clarity. | `lib/main.dart:95,101` |
| CQ12 | **Low** | `_QueuedRequest` in `api_client.dart` is not typed — `data` is `dynamic`. Should be `Map<String, dynamic>?`. | `lib/core/api_client.dart:143` |
| CQ13 | **Low** | `color.withOpacity(0.1)` used extensively (15+ instances). `withOpacity` creates a new Color object each build. Consider pre-computed color constants. | Multiple |
| CQ14 | **Low** | Dead import potential: `features/estab/files_screen.dart` imported in main but route points to `EFileScreen` — unclear if FilesScreen is used. | `lib/main.dart:37` |

---

## 6. Recommendations (Priority Order)

### P0 — Before Production

1. **Add 5xx retry interceptor** to Dio (3 attempts, exponential backoff) — `api_client.dart`
2. **Route all write operations through the outbox** for screens using direct API calls (`BillApprovalScreen`, `MyTasksScreen`)
3. **Fix green button contrast** — use darker green (#15803D) or white background with green text
4. **Add Semantics to DashboardScreen quick actions** — critical for GIGW accessibility compliance

### P1 — High Priority

5. Replace raw error displays (`'Error: $e'`) with `AppErrorState` widget across all screens
6. Add skeleton loading to `PaymentsScreen`, `IndentsScreen`, `JournalScreen`
7. Migrate hardcoded strings to ARB files (import `AppLocalizations.of(context)`)
8. Add empty states with icons to all list screens using `AppEmptyState` widget
9. Add offline banners to screens using direct API calls

### P2 — Medium Priority

10. Extract `FutureBuilder` patterns into dedicated Riverpod `FutureProvider`s per mailbox
11. Add `ExcludeSemantics` on decorative icons in list items
12. Ensure all touch targets meet 48dp minimum (filter chips, small InkWells)
13. Extract magic numbers into named constants
14. Create shared formatting utilities (`indianFormat`, `formatAmount`)

### P3 — Low Priority

15. Add animations for list item removal on approve/reject
16. Pre-compute Color objects instead of `withOpacity` in build methods
17. Add count badges to filter chips
18. Replace `// ignore: discarded_futures` with `unawaited()`

---

## Test Coverage Summary

- **Core (sync, auth, widgets):** 14 test files — well covered ✅
- **Feature screens:** 15/26 modules have tests (~58%)
- **Critical gaps:** workflow, notifications, settings have zero tests
- **Existing test quality:** Good patterns (mocktail, provider overrides, async pumping)

---

*Generated by automated audit. Manual testing with screen readers (TalkBack/VoiceOver) and real devices required for full accessibility certification.*
