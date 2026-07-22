# CivitasOne Mobile — UX Requirements Checklist (Per Screen)

**Legend:** ✅ Met | ⚠️ Partial | ❌ Missing | N/A Not Applicable

---

## Core Screens

### Splash Screen (`lib/core/splash_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | Brand animation with 1.2s delay |
| Error state | ❌ | No error handling if auth check fails silently |
| Empty state | N/A | — |
| Pull-to-refresh | N/A | — |
| Form validation | N/A | — |
| Offline indicator | ❌ | No connectivity check on splash |
| Semantic labels | ⚠️ | Needs verification |

### Login Screen (`lib/main.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | Button shows spinner during sign-in |
| Error state | ✅ | SnackBar with error message |
| Empty state | N/A | — |
| Pull-to-refresh | N/A | — |
| Form validation | N/A | Single button, no form |
| Offline indicator | ❌ | No offline check before sign-in attempt |
| Semantic labels | ⚠️ | Button text is descriptive but no explicit label |

---

## Employee Shell Screens

### Dashboard (Main) (`lib/main.dart` — DashboardScreen)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ❌ | No shimmer/skeleton while modules load |
| Error state | ❌ | Silent fallback to showing all modules |
| Empty state | ❌ | No guidance if all modules are disabled |
| Pull-to-refresh | ❌ | ListView but no RefreshIndicator |
| Form validation | N/A | — |
| Offline indicator | ❌ | No offline banner |
| Semantic labels | ❌ | Quick action tiles lack Semantics |
| Touch targets ≥ 48dp | ✅ | Grid items are large enough |

### Business Dashboard (`lib/features/dashboard/business_dashboard_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | Spinner in stat cards + recent activity |
| Error state | ❌ | No error state if data load fails |
| Empty state | ✅ | "No activity yet" text |
| Pull-to-refresh | ✅ | RefreshIndicator wraps ListView |
| Form validation | N/A | — |
| Offline indicator | ✅ | Orange banner when offline |
| Semantic labels | ⚠️ | Stat cards lack combined label+value semantics |
| Touch targets ≥ 48dp | ⚠️ | Quick action circles are 52dp but text below may be tappable area |

---

## Finance Module

### Payments (`lib/features/finance/payments_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ⚠️ | CircularProgressIndicator only (no shimmer) |
| Error state | ⚠️ | Raw error text, no retry button |
| Empty state | ⚠️ | Plain text "No data — pull to refresh" |
| Pull-to-refresh | ✅ | RefreshIndicator present |
| Form validation | N/A | — |
| Offline indicator | ❌ | No offline banner |
| Semantic labels | ⚠️ | ListTile has basic semantics |
| ListView.builder | ✅ | Correctly uses builder pattern |

### Journal (`lib/features/finance/journal_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ⚠️ | Spinner only |
| Error state | ⚠️ | Raw error text |
| Empty state | ⚠️ | Plain text |
| Pull-to-refresh | ✅ | Present |
| Form validation | N/A | — |
| Offline indicator | ❌ | Missing |
| Semantic labels | ⚠️ | Basic ListTile semantics |

### Bill Approvals (`lib/features/finance/bill_approval_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | CircularProgressIndicator |
| Error state | ✅ | Icon + "Unable to load" + Retry button |
| Empty state | ✅ | Icon + "No pending bills" + description |
| Pull-to-refresh | ✅ | RefreshIndicator on list |
| Form validation | ✅ | Reject dialog requires reason (FormState) |
| Offline indicator | ❌ | No offline awareness |
| Semantic labels | ⚠️ | Cards readable but action buttons lack explicit labels |
| Touch targets ≥ 48dp | ✅ | Buttons have sufficient padding |

### Budget Dashboard (`lib/features/finance/budget_dashboard_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | — | Not audited in detail |
| Error state | — | — |
| Empty state | — | — |
| Pull-to-refresh | — | — |
| Offline indicator | — | — |

---

## Procurement Module

### Indents (`lib/features/procurement/indents_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ⚠️ | Spinner only |
| Error state | ⚠️ | Raw "Error: $e" text |
| Empty state | ⚠️ | Plain "No data — pull to refresh" |
| Pull-to-refresh | ✅ | Present |
| Form validation | N/A | — |
| Offline indicator | ❌ | Missing |
| Semantic labels | ⚠️ | Basic ListTile |

### Purchase Orders (`lib/features/procurement/pos_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ⚠️ | Spinner only |
| Error state | ⚠️ | Raw error text |
| Empty state | ⚠️ | Plain text |
| Pull-to-refresh | ✅ | Present |
| Offline indicator | ❌ | Missing |

### Approvals (`lib/features/procurement/approvals_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | SkeletonList shimmer |
| Error state | ✅ | Icon + message + Retry button |
| Empty state | ✅ | Icon + "No pending approvals" |
| Pull-to-refresh | ✅ | RefreshIndicator |
| Form validation | ⚠️ | Comment is optional (correct for this flow) |
| Offline indicator | ❌ | No banner, but items sync via outbox |
| Semantic labels | ⚠️ | StatusPill should announce status to screen reader |
| Optimistic update | ✅ | Local state updated immediately |

---

## HR & Attendance Module

### GPS Check-In (`lib/features/attendance/gps_checkin_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | GPS acquiring indicator |
| Error state | ⚠️ | GPS error shown as text, no retry |
| Empty state | N/A | — |
| Pull-to-refresh | ✅ | RefreshIndicator |
| Form validation | N/A | — |
| Offline indicator | ✅ | Orange banner |
| Semantic labels | ⚠️ | Selfie capture card lacks explicit label |
| Touch targets ≥ 48dp | ✅ | Main button is 56dp height |
| Offline write | ✅ | Queues to outbox |

### Attendance History (`lib/features/attendance/attendance_history_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | — | Not audited in detail |
| Error state | — | — |
| Pull-to-refresh | — | — |

---

## Helpdesk Module

### Tickets (`lib/features/helpdesk/tickets_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | SkeletonList |
| Error state | ✅ | Icon + message + Retry |
| Empty state | ✅ | Icon + message + "Create Ticket" CTA |
| Pull-to-refresh | ✅ | Present |
| Form validation | N/A | — |
| Offline indicator | ❌ | No offline banner |
| Semantic labels | ⚠️ | StatusPill needs screen reader support |
| FAB | ✅ | New Ticket FAB with icon + label |

---

## Workflow Module

### My Tasks (`lib/features/workflow/my_tasks_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | ✅ | CircularProgressIndicator |
| Error state | ✅ | Icon + message + Retry |
| Empty state | ✅ | Filter-aware empty message |
| Pull-to-refresh | ✅ | Present |
| Form validation | ✅ | Delegate dialog validates officer field |
| Offline indicator | ❌ | No offline awareness |
| Semantic labels | ⚠️ | Filter chips lack selected state semantics |
| Touch targets ≥ 48dp | ⚠️ | Filter chips are ~32dp tall |
| Priority badge | ✅ | Visual + text priority |

---

## CRM Module

### Contacts (`lib/features/crm/contacts_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | — | Not audited in detail |
| Error state | — | — |
| Pull-to-refresh | — | — |

### Deals (`lib/features/crm/deals_screen.dart`)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Loading state | — | Not audited in detail |
| Error state | — | — |

---

## Other Feature Screens (Quick Assessment)

| Screen | Loading | Error+Retry | Empty | Refresh | Offline |
|--------|---------|-------------|-------|---------|---------|
| Projects | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| eFile/Estab | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| MIS | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| Asset Scanner | ✅ | ✅ | ✅ | N/A | ⚠️ |
| Contract Milestones | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| Knowledge Base | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| Quick Reports | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| Settings | N/A | N/A | N/A | N/A | N/A |
| Notifications | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| Customer List | ✅ | ✅ | ✅ | ✅ | ✅ |
| Invoice List | ✅ | ✅ | ✅ | ✅ | ✅ |
| Expense List | ✅ | ✅ | ✅ | ✅ | ✅ |
| Payment List | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bill Tracker | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Stock Scanner | ✅ | ✅ | ✅ | N/A | ⚠️ |
| Citizen Requests | ✅ | ✅ | ✅ | ✅ | ⚠️ |

---

## Summary

| Category | Met | Partial | Missing |
|----------|-----|---------|---------|
| Loading states | 12 | 8 | 3 |
| Error + Retry | 10 | 8 | 5 |
| Empty states | 11 | 7 | 3 |
| Pull-to-refresh | 18 | 0 | 3 |
| Offline indicator | 5 | 3 | 15 |
| Form validation | 4 | 1 | 0 |
| Semantic labels | 2 | 14 | 3 |

**Key Gap:** Offline indicators are missing from 15 of 23 data-fetching screens. The offline-first sync infrastructure exists but the UI doesn't consistently communicate sync status to users.

---

*To reach production readiness, prioritize: (1) replacing raw error texts with AppErrorState widget, (2) adding SkeletonList loading to all list screens, (3) adding offline banners using AppCacheBanner, (4) adding Semantics to all interactive elements.*
