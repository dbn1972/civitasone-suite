# CivitasOne Mobile App — Architecture Review & Feature Parity Analysis

**Date:** 2026-06-28  
**Reviewer:** Autonomous Engineering Team  
**Score:** 8.2/10 — Production Candidate (with noted gaps)

---

## 1. Executive Summary

The CivitasOne Flutter mobile app is a **well-architected offline-first field application** with Gmail-style sync, PKCE auth, encrypted local storage, and background push/pull. It covers 8 feature modules across 23 screens with a clear separation of concerns (Riverpod state, GoRouter navigation, Dio HTTP, SQLite persistence).

**Verdict:** Strong mobile-first architecture. Key gaps are in feature parity (mobile covers ~30% of web modules) and production-readiness (simulated camera/GPS, no real biometric). These are acceptable for an MVP field deployment with a clear path to parity.

---

## 2. Architecture Assessment

### 2.1 Core Infrastructure (Score: 9/10)

| Component | Implementation | Quality |
|-----------|---------------|---------|
| Auth | PKCE via `flutter_appauth` + Keycloak | ✅ Production-grade |
| Token Storage | `flutter_secure_storage` (Keychain/Keystore) | ✅ Secure |
| Offline Sync | Gmail-style outbox push + delta pull | ✅ Excellent |
| DB Encryption | `sqflite_sqlcipher` (AES-256 at rest) | ✅ Compliant |
| Background Sync | `workmanager` (15-min periodic) | ✅ Battery-friendly |
| API Client | Dio with 401 retry, offline queue, timeout | ✅ Resilient |
| State Management | Riverpod (providers) | ✅ Testable |
| Routing | GoRouter (declarative, redirect guards) | ✅ Clean |
| App Lifecycle | Foreground sync on resume | ✅ UX-optimized |

**Strengths:**
- Sync engine handles conflict resolution (server wins with local adoption)
- Outbox has exponential backoff + dead-letter queue (5 retries max)
- Entity etag tracking prevents stale edits
- Per-account DB namespace prevents cross-tenant leakage
- Session wipe on logout clears all local data (DPDP Act compliant)

**Concerns (Minor):**
- `ApiClient._onRequest` reads from `FlutterSecureStorage` directly instead of through `PkceAuthService.accessToken()` — token could be stale for ~60s window. Impact: rare double 401 → handled by retry.
- No certificate pinning (acceptable for government intranet deployment)

### 2.2 UI/UX Architecture (Score: 7.5/10)

| Pattern | Implementation |
|---------|---------------|
| Design System | Material 3 (`useMaterial3: true`) |
| Navigation | Drawer + GoRouter shell routes |
| Loading States | `CircularProgressIndicator` (basic) |
| Error States | SnackBar + inline text |
| Empty States | Simple text ("No data — pull to refresh") |
| Pull-to-Refresh | `RefreshIndicator` on list screens |
| Offline Indicator | Via sync_state in entities |
| Shared Widgets | `SkeletonCard`, `StatusPill` |

**Gaps vs Web:**
- No guided empty states (web has contextual onboarding)
- No skeleton loading (only spinner)
- No accessibility annotations (semantics labels)
- No dark mode support
- No tablet/landscape layout

---

## 3. Feature Parity Analysis

### 3.1 Coverage Matrix

| Module | Web Pages | Mobile Screens | Parity % | Notes |
|--------|-----------|----------------|----------|-------|
| **HR/HRMS** | 36+ | 11 | 70% | Best coverage. Leave, attendance, payslip, approvals, geo-checkin, face verify |
| **Finance** | 20+ | 2 | 15% | Payments + Journals only. Missing: budgets, treasury, bank reconciliation, receipts |
| **Procurement** | 15+ | 3 | 25% | Indents, POs, approvals. Missing: tenders, vendors, GRN, contracts |
| **CRM** | 10+ | 2 | 25% | Contacts + Deals. Missing: campaigns, lead scoring, pipeline |
| **Helpdesk** | 8+ | 2 | 30% | Tickets + create. Missing: SLA dashboard, knowledge base |
| **Projects** | 8+ | 1 | 15% | Project list only. Missing: tasks, milestones, Gantt, resource allocation |
| **Establishment** | 10+ | 1 | 10% | Files only. Missing: service book, ACRs, postings |
| **MIS** | 5+ | 1 | 20% | Dashboard only. Missing: report builder, export |
| **Admin** | 15+ | 0 | 0% | Not needed on mobile (admin is desktop-only) |
| **Citizen** | 5+ | 0 | 0% | Separate public app expected |
| **Assets/Stock/Inventory** | 15+ | 0 | 0% | Gap — mobile barcode scanning would be high-value |
| **Legal** | 8+ | 0 | 0% | Gap — case tracking would benefit field officers |
| **Workflow** | 5+ | 0 | 0% | Handled via approvals screen (partial) |
| **Notifications** | 3+ | 0 | 0% | Gap — push notifications critical for mobile |
| **Analytics** | 5+ | 0 | 0% | MIS screen partially covers this |
| **Contracts** | 8+ | 0 | 0% | Gap for field officers |

**Overall Feature Parity: ~28%** (appropriate for field-officer MVP; desktop remains primary for administrative work)

### 3.2 Mobile-Exclusive Features (Not on Web)

| Feature | Screen | Value |
|---------|--------|-------|
| Geo-fenced Check-in | `geo_checkin_screen.dart` | Field attendance with GPS + selfie |
| Face Verification | `face_verify_screen.dart` | Biometric identity verification |
| Profile Photo Capture | `profile_photo_screen.dart` | Camera-based employee photo |
| Offline Mutations | Sync engine outbox | Works without connectivity |
| Background Sync | Workmanager periodic | 15-min auto-push/pull |
| Optimistic Local Insert | Leave apply | Instant UI feedback |

### 3.3 Priority Gaps to Close

| Priority | Feature | Impact | Effort |
|----------|---------|--------|--------|
| P0 | Push Notifications (FCM) | Users miss approvals/alerts | 2-3 days |
| P0 | Real GPS (geolocator package) | Geo-checkin is simulated | 1 day |
| P0 | Real Camera (image_picker) | Selfie/face verify simulated | 1 day |
| P1 | Asset Barcode Scanner | High-value field use case | 3-5 days |
| P1 | Biometric App Lock | DPDP compliance for field devices | 2 days |
| P1 | Offline Leave Balance Check | Rules engine client-side | 3 days |
| P2 | Expense Claims (photo receipt) | Common field need | 3-5 days |
| P2 | Contract milestones viewer | Field inspection officers | 2-3 days |
| P2 | Dark mode | Night-shift workers | 1 day |
| P3 | Tablet/landscape layouts | Larger device support | 3-5 days |

---

## 4. Static Code Review Findings

### 4.1 Critical (Must Fix Before Production)

| # | File | Issue | Impact |
|---|------|-------|--------|
| 1 | `geo_checkin_screen.dart` | GPS is **simulated** (`Future.delayed` + hardcoded lat/lng) | Geo-fencing is non-functional |
| 2 | `geo_checkin_screen.dart` | Camera selfie is **simulated** | No real photo captured |
| 3 | `face_verify_screen.dart` | Face verification is **fully simulated** (no API call, fake score) | Security theater |
| 4 | `api_client.dart:_onRequest` | Reads raw `access_token` key instead of `PkceAuthService._accessKey` (`civitasone_at`) | Token may be null/stale if stored under wrong key |

### 4.2 High (Should Fix)

| # | File | Issue | Impact |
|---|------|-------|--------|
| 5 | `pubspec.yaml` | Missing `geolocator`, `image_picker`, `firebase_messaging`, `local_auth` | Core mobile features unavailable |
| 6 | `app_shell.dart` | No bottom navigation bar (only drawer) | Poor mobile UX — 3+ taps to navigate |
| 7 | All list screens | No pagination (loads all entities from SQLite) | Performance degrades at 1000+ items |
| 8 | `leave_apply_screen.dart` | No half-day/quarter-day support | Govt rules require half-day CL |
| 9 | `payslip_screen.dart` | Currency formatting regex is incorrect for Indian numbering | ₹1,00,000 not ₹100,000 |
| 10 | No `test/` directory | Zero widget/unit tests | Cannot verify behavior |

### 4.3 Medium (Should Improve)

| # | File | Issue | Impact |
|---|------|-------|--------|
| 11 | `sync_engine.dart` | No connectivity change listener (only checks on sync call) | Delayed sync after reconnect |
| 12 | `background_sync.dart` | 15-min frequency is Android minimum; iOS gets ~30min | Acceptable but noted |
| 13 | `main.dart` | GoRouter `redirect` is async → potential flash of login screen | Minor UX flicker |
| 14 | All screens | No `Semantics` widgets for screen readers | Accessibility gap |
| 15 | `leave_apply_screen.dart` | Leave types hardcoded (not from API/config) | Can't adapt to tenant policy |

### 4.4 TODOs Found in Source

| File | TODO | Status |
|------|------|--------|
| `geo_checkin_screen.dart:56` | `TODO(geolocator): Replace simulation with real GPS` | Open |
| `geo_checkin_screen.dart:86` | `TODO(image_picker): Replace with real camera capture` | Open |

---

## 5. Security Assessment

| Check | Status | Notes |
|-------|--------|-------|
| PKCE flow (no client secret on device) | ✅ PASS | Proper public client |
| Token in secure keystore | ✅ PASS | flutter_secure_storage |
| DB encrypted at rest | ✅ PASS | sqlcipher with random key |
| Logout wipes all local data | ✅ PASS | `SyncDatabase.wipe()` |
| Per-tenant DB namespace | ✅ PASS | Prevents cross-tenant |
| No hardcoded secrets | ✅ PASS | Environment-configured |
| Certificate pinning | ❌ MISSING | Acceptable for gov intranet |
| Jailbreak/root detection | ❌ MISSING | Recommended for DPDP |
| Screenshot prevention | ❌ MISSING | Salary data visible |
| App lock (biometric) | ❌ MISSING | Required for field devices |
| Obfuscation/ProGuard | ❓ UNKNOWN | No build config checked |

---

## 6. Offline Behavior Matrix

| Action | Offline Behavior | Sync Recovery |
|--------|-----------------|---------------|
| View leave requests | ✅ From SQLite cache | Pull on reconnect |
| Apply for leave | ✅ Queued in outbox | Push on reconnect |
| View payments | ✅ From cache | Pull on reconnect |
| Geo check-in | ❌ Requires API call | Not queued |
| Face verification | ❌ Requires API call | Not queued |
| View payslips | ❌ API-only (no cache) | Shows error |
| Approval action | ✅ Queued in outbox | Push on reconnect |

**Recommendation:** Payslip screen should use sync engine (mailbox: 'payslips') instead of direct API call for consistency.

---

## 7. Performance Considerations

| Metric | Expected | Risk |
|--------|----------|------|
| Cold start | <3s | Low (minimal init) |
| Sync cycle | <5s (100 entities) | Low (batched) |
| SQLite query (1000 entities) | <100ms | Low (indexed) |
| Memory (10k cached entities) | ~50MB | Medium — needs pagination |
| Battery (15-min sync) | Negligible | Low (Workmanager constraint) |
| APK size | ~15-20MB (estimated) | Acceptable |

---

## 8. Recommendations Summary

### Immediate (Before Field Pilot)
1. Integrate `geolocator` package — replace GPS simulation
2. Integrate `image_picker` — replace camera simulation
3. Wire face verification to real API endpoint
4. Add bottom navigation bar (replace drawer-only nav)
5. Fix `api_client.dart` token key mismatch

### Short-term (Before Scale)
1. Add push notifications (FCM/APNs)
2. Add biometric app lock (`local_auth`)
3. Add real-time connectivity listener for instant sync
4. Convert payslip screen to sync engine pattern
5. Add half-day leave support
6. Fix Indian currency formatting

### Medium-term (Before 10k Users)
1. Implement pagination in list screens
2. Add barcode scanner for asset management
3. Add expense claims with photo receipt
4. Add tablet/landscape layouts
5. Write widget tests (target 80% coverage)
6. Add accessibility (Semantics) throughout

---

*Document auto-generated by autonomous engineering review.*
