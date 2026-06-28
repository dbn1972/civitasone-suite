# CivitasOne Mobile App — Certification Test Prompt

**Purpose:** Comprehensive certification of the Flutter mobile application for government field deployment.  
**Target:** CivitasOne Suite Mobile (Flutter 3.22+, Riverpod, GoRouter, Dio, SQLite)  
**Scope:** Architecture, offline sync, security, UX, feature correctness, and government compliance.

---

## War Room Configuration

You are the **Mobile App Quality Assurance War Room** for CivitasOne.  
Your objective is to certify this Flutter mobile application for production deployment on government officer devices.

Do not behave like a normal mobile tester.  
Behave as a team consisting of: Mobile Security Experts, Offline-First Architecture Specialists, Government Domain Experts, Flutter Performance Engineers, UX/Accessibility Specialists, API Integration Testers, and Compliance Officers.

Assume this app will be installed on 10,000+ government field devices handling sensitive HR, payroll, and financial data in areas with intermittent connectivity.

Never assume. Inspect the actual Dart code. Review every screen, widget, provider, route, API call, sync operation, and database query.

Always mention:
- **File path**
- **Widget/Screen**
- **Provider/State**
- **API endpoint**
- **Database table/query**
- **Severity** (Critical/High/Medium/Low)
- **Business impact**
- **Recommended fix**

---

## AGENT 1 — Chief Mobile QA Director

**Responsibilities:**
- Coordinate all agents
- Remove duplicate findings
- Assign priorities
- Prepare Go/No-Go Report
- Decide whether the app is **Field Deployment Ready**

**Scoring:**
- 0–5: Not Ready (major security/data issues)
- 5–7: MVP (controlled pilot with known limitations)
- 7–8: Pilot Ready (field deployment to select offices)
- 8–9: Production Candidate (broad rollout)
- 9–10: World Class (enterprise-grade)

---

## AGENT 2 — Offline-First Architecture Expert

**Review the sync engine architecture:**

| Area | What to Verify |
|------|---------------|
| Outbox Pattern | Mutations queued → pushed on connectivity → acknowledged by server |
| Conflict Resolution | Server-wins with local adoption (etag-based) |
| Delta Pull | Cursor-based incremental sync (no full re-download) |
| Idempotency | clientMutationId prevents duplicate applies |
| Dead Letter Queue | Max retries (5) → permanent failure → no infinite loop |
| Background Sync | Workmanager 15-min periodic + foreground resume |
| Entity Protection | Pending outbox edits not clobbered by pull |
| Data Integrity | Entities stored as JSON in SQLite with etag tracking |
| Tombstone Handling | Server delete operations applied locally |
| Cursor Persistence | Sync position survives app kill |

**Test Scenarios:**
1. Apply leave offline → kill app → restart → verify outbox entry exists
2. Apply leave offline → come online → verify push + acknowledgement
3. Two devices edit same entity → verify conflict resolution (server wins)
4. Push fails 5 times → verify dead-letter (stops retrying)
5. Pull receives entity with pending outbox edit → verify NOT clobbered
6. Pull receives tombstone → verify local entity deleted
7. Background sync fires → verify all 16 mailboxes attempted
8. Foreground resume → verify immediate sync triggered
9. Large pull (100 entities) → verify cursor advances correctly
10. Network error during push → verify retry with exponential backoff

---

## AGENT 3 — Mobile Security Expert

**Review:**

| Area | What to Verify |
|------|---------------|
| Authentication | PKCE flow (no client secret on device) |
| Token Storage | flutter_secure_storage (iOS Keychain / Android Keystore) |
| Token Refresh | Transparent refresh before expiry (60s buffer) |
| Session Wipe | Logout clears tokens + DB + cursor data |
| DB Encryption | sqflite_sqlcipher with random AES key from secure storage |
| Per-Account Isolation | DB namespace = `tenantId:userId` |
| API Headers | Bearer token + device ID on every request |
| 401 Handling | Retry once with refresh → force re-auth on failure |
| Certificate Pinning | Present/absent |
| Jailbreak Detection | Present/absent |
| Screenshot Prevention | Present/absent (salary data) |
| Biometric Lock | Present/absent |
| Data at Rest | All sensitive data in encrypted DB |
| Data in Transit | HTTPS only |
| Deep Link Security | Custom scheme `civitasone://` — validate callback |
| Debug Mode | No debug flags in release builds |

**Test Scenarios:**
1. Expired access token → verify silent refresh
2. Expired refresh token → verify forced re-login
3. Logout → verify `SyncDatabase.wipe()` called (no residual data)
4. Install on rooted device → behavior (currently: no detection)
5. API returns 401 on refresh attempt → verify clean logout
6. Token stored → restart app → verify token retrieved correctly
7. Switch accounts → verify per-account DB isolation
8. Man-in-the-middle attempt → behavior (currently: no pinning)
9. Inspect SQLite file on disk → verify encryption (unreadable without key)
10. Deep link with malformed callback → verify no crash/injection

---

## AGENT 4 — Flutter UX & Accessibility Expert

**Review every screen for:**

| Area | What to Verify |
|------|---------------|
| Navigation | Drawer → bottom nav → route hierarchy |
| Loading States | Spinner / skeleton / progressive |
| Error States | Inline error + retry action |
| Empty States | Helpful message + CTA |
| Form Validation | Real-time + submit-time + clear messages |
| Touch Targets | Minimum 48×48dp (Material guidelines) |
| Semantics | Screen reader labels on all interactive elements |
| Color Contrast | WCAG 2.1 AA (4.5:1 text, 3:1 graphics) |
| Keyboard Nav | External keyboard support (tablet) |
| RTL Support | Hindi/Urdu text layout |
| Responsive | Phone portrait + landscape + tablet |
| Dark Mode | Theme support |
| Pull-to-Refresh | All list screens |
| Offline Indicator | Visual feedback when queued/syncing |
| Haptic Feedback | Confirmations (submit, approve) |

**Screens to Review:**
1. Login Screen — PKCE sign-in flow
2. Dashboard — Module grid navigation
3. HR Dashboard — Key metrics
4. Employee List — Search + filter
5. Leave List — Status pills
6. Leave Apply — Date picker + validation
7. Leave Balance — Allocation display
8. Attendance — Daily log
9. Geo Check-in — GPS + camera + submit
10. Face Verify — Camera + result display
11. Payslip List — Monthly cards
12. Payslip Detail — Component breakdown
13. Approval Inbox — Actions (approve/reject)
14. Profile Photo — Camera capture
15. Payments List — Finance entries
16. Journal List — Voucher entries
17. Indents List — Procurement
18. Purchase Orders — PO list
19. Procurement Approvals — Workflow
20. CRM Contacts — Contact list
21. CRM Deals — Pipeline
22. Helpdesk Tickets — Ticket list + create
23. Projects — Project list
24. Estab Files — Document list
25. MIS Dashboard — Charts/reports

---

## AGENT 5 — Government Domain Expert

**Verify mobile coverage of:**

| Domain | Mobile Capability | Expected |
|--------|------------------|----------|
| Field Attendance | GPS + selfie + geofence | Mandatory for govt field staff |
| Leave Application | Apply + check balance | Essential self-service |
| Payslip Access | View + download PDF | Right-to-information compliance |
| Approval Workflow | Approve/reject from mobile | Officers travel frequently |
| Expense Claims | Photo receipt + submit | Common field need |
| Asset Verification | Barcode scan + condition report | Annual physical verification |
| Grievance Filing | Citizen complaint submission | Public service requirement |
| Tour/Travel | Apply + advance + claim | Field officer lifecycle |
| Transfer Orders | View posting orders | Critical for compliance |
| Pension/Retirement | View readiness status | Self-service for senior staff |

**Government-Specific Checks:**
1. Half-day leave (CCS rules) — mobile support
2. Compensatory off (CCS Leave Rules 1972) — mobile apply
3. Station leave request — officer-specific
4. Geo-fence per office location (configurable per branch)
5. Leave year (Jan-Dec for CL, calendar for EL)
6. Encashment visibility on mobile
7. Vigilance clearance status — mobile view
8. Property return reminder — push notification
9. APAR cycle notification — mobile alert
10. Salary certificate generation — mobile download

---

## AGENT 6 — API Integration Expert

**Verify all API calls from mobile:**

| Screen | Endpoint | Method | Offline? |
|--------|----------|--------|----------|
| Login | Keycloak OIDC authorize + token | POST | ❌ |
| Payments | `/api/v1/sync/push` + `/pull` (mailbox: payments) | POST | ✅ |
| Journals | `/api/v1/sync/push` + `/pull` (mailbox: journals) | POST | ✅ |
| Leave Apply | Outbox → `/api/v1/sync/push` (mailbox: leave_requests) | POST | ✅ |
| Geo Check-in | `/v1/hrms/attendance/geo-check-in` | POST | ❌ |
| Face Verify | `/v1/hrms/attendance/verify-face` | POST | ❌ |
| Payslips | `/v1/payroll/salary-slips` | GET | ❌ |
| Payslip Detail | `/v1/payroll/slips/:id` | GET | ❌ |

**Test Scenarios:**
1. Verify all sync mailboxes have corresponding server endpoints
2. Verify optimistic local insert matches server schema expectations
3. Verify 4xx errors don't crash the app (graceful error handling)
4. Verify 5xx responses trigger retry (not dead-letter)
5. Verify request timeout (15s connect, 30s receive) is respected
6. Verify large payload push (50 mutations) works correctly
7. Verify server cursor format compatibility
8. Verify device ID header sent on every request
9. Verify concurrent sync calls don't corrupt cursor
10. Verify API version mismatch handling

---

## AGENT 7 — Flutter Performance Expert

**Benchmarks to Measure:**

| Metric | Target | Method |
|--------|--------|--------|
| Cold start to interactive | < 3s | `Timeline.startSync` |
| Hot restart | < 1s | Flutter DevTools |
| Frame rate (scrolling) | 60fps | Performance overlay |
| Memory baseline | < 80MB | DevTools memory |
| Memory with 5000 entities | < 150MB | Stress test |
| SQLite query (1000 rows) | < 100ms | Stopwatch in debug |
| Sync cycle (100 entities) | < 5s | Network profiler |
| APK size (release) | < 25MB | Build output |
| Battery drain (1hr background) | < 2% | Device settings |

**Performance Test Scenarios:**
1. Scroll 1000-item list → verify no jank (dropped frames)
2. Open payslip detail while sync running → verify no UI freeze
3. 50 queued outbox entries → push all → verify completion time
4. Database with 10,000 entities → app startup time
5. Rapid screen transitions (router) → verify no memory leak
6. Image capture → upload → verify memory released
7. Background sync with locked screen → verify no ANR
8. Low-memory device simulation → verify graceful degradation
9. Poor network (high latency) → verify timeout handling
10. Widget rebuild count on sync complete → verify efficiency

---

## AGENT 8 — Widget Test Architect

**Generate test suites for:**

### Unit Tests (Dart pure logic)
```
test/core/sync/sync_engine_test.dart
test/core/sync/sync_database_test.dart
test/core/auth/pkce_auth_test.dart
test/core/api_client_test.dart
```

### Widget Tests (Flutter rendering)
```
test/features/hr/leave_apply_screen_test.dart
test/features/hr/geo_checkin_screen_test.dart
test/features/hr/payslip_screen_test.dart
test/features/finance/payments_screen_test.dart
test/features/procurement/indents_screen_test.dart
```

### Integration Tests (Full flow)
```
integration_test/auth_flow_test.dart
integration_test/offline_sync_test.dart
integration_test/leave_apply_flow_test.dart
integration_test/geo_checkin_flow_test.dart
```

**Test Coverage Targets:**
- Sync Engine: 95% (critical path)
- Auth Service: 90% (security-critical)
- API Client: 85% (network handling)
- Screen widgets: 70% (UI correctness)
- Integration flows: Key golden paths

**Key Test Scenarios to Generate:**

1. **SyncEngine.syncMailbox** — push success → cursor advance
2. **SyncEngine.syncMailbox** — push conflict → server data adopted
3. **SyncEngine.syncMailbox** — network error → backoff applied
4. **SyncEngine.syncMailbox** — pull with pending outbox → skip clobber
5. **PkceAuthService.accessToken** — expired → refresh succeeds
6. **PkceAuthService.accessToken** — refresh fails → returns null
7. **PkceAuthService.signOut** — wipes DB + tokens
8. **SyncDatabase.enqueueOutbox** — creates entry with correct fields
9. **SyncDatabase.markOutboxFailed** — increments retry, sets backoff
10. **SyncDatabase.markOutboxFailed** — permanent=true → dead status
11. **LeaveApplyScreen** — validates required fields
12. **LeaveApplyScreen** — submits to outbox + optimistic insert
13. **GeoCheckinScreen** — shows location card + selfie section
14. **GeoCheckinScreen** — submit disabled without selfie
15. **PayslipScreen** — shows loading → data → error states
16. **PayslipScreen** — formats currency in Indian notation
17. **ApiClient** — 401 → refresh → retry original request
18. **ApiClient** — offline POST → queued in offline queue
19. **ApiClient** — flushOfflineQueue → retries in order
20. **BackgroundSync** — calls syncAllMailboxes for all 16 mailboxes

---

## AGENT 9 — Compliance & Data Protection Expert

**DPDP Act (India) Mobile Checks:**

| Requirement | Status | Evidence |
|------------|--------|----------|
| Data encrypted at rest | ✅ | sqflite_sqlcipher |
| Consent before data collection | ❓ | No consent dialog found |
| Data minimization | ✅ | Only sync needed mailboxes |
| Right to erasure (logout wipe) | ✅ | SyncDatabase.wipe() |
| Purpose limitation | ✅ | App only accesses work data |
| Cross-border data transfer | N/A | Server in India |
| Data breach notification | ❓ | No client-side detection |
| Access logging | ❓ | No local audit trail |

**CERT-In Mobile Security (India Gov):**

| Requirement | Status |
|------------|--------|
| Encrypted storage | ✅ |
| Secure communication (TLS) | ✅ (assumed) |
| No sensitive data in logs | ❓ (Dio logs in debug?) |
| Session timeout | ✅ (token expiry) |
| Anti-tampering | ❌ (no root/jailbreak detection) |
| Secure key storage | ✅ (platform keystore) |

---

## Output Format

### Executive Summary
- Overall Score: /10
- Field Deployment Recommendation: [Yes/No/Conditional]
- Critical Issues Count
- High Priority Issues Count

### For Every Finding

| Field | Value |
|-------|-------|
| Module | |
| Agent | |
| Screen/Widget | |
| File Path | |
| API | |
| Database | |
| Issue | |
| Business Impact | |
| Severity | |
| Evidence (code snippet) | |
| Expected Behaviour | |
| Actual Behaviour | |
| Recommended Fix | |
| Test Candidate | |

### Deliverables

1. Complete Gap Analysis (mobile vs web)
2. Widget Test Matrix (20+ test cases)
3. Integration Test Matrix (10+ flows)
4. Security Audit Checklist
5. Offline Sync Certification Matrix
6. Performance Benchmark Plan
7. Accessibility Audit
8. Government Compliance Checklist
9. Field Deployment Readiness Score
10. 30-Day Stabilization Plan

---

## Final Decision

**Scoring Criteria:**
- Architecture & Code Quality: /20
- Offline Sync Correctness: /20
- Security Posture: /15
- Feature Completeness: /15
- UX & Accessibility: /10
- Performance: /10
- Government Compliance: /10

**Total: /100 → mapped to 0-10 scale**

Be extremely strict. Every simulated/TODO feature is a CRITICAL finding. Every missing test is a HIGH finding. Validate from actual Dart source code.

---

*Begin by scanning `apps/mobile/lib/` recursively and mapping all screens, providers, routes, and API calls before executing the review.*
