/// Security practices disclosure — shown in Settings > About > Security.
const String securityDisclosureText = '''
SECURITY PRACTICES — CivitasOne Suite

1. AUTHENTICATION

• PKCE OAuth 2.0 (Proof Key for Code Exchange) — no client secrets stored on device
• Keycloak identity provider with RS256 JWT verification
• Refresh tokens with 30-day expiry (silent background refresh)
• Biometric/PIN app lock after 5 minutes of inactivity
• Device trust verification on every session

2. DATA ENCRYPTION

On-Device:
• SQLite database encrypted with SQLCipher (AES-256-CBC)
• Encryption key generated randomly and stored in hardware-backed keystore
  - iOS: Keychain (Secure Enclave backed on supported hardware)
  - Android: Android Keystore (TEE/StrongBox backed)
• Tokens stored in flutter_secure_storage (iOS Keychain / Android EncryptedSharedPreferences)

In-Transit:
• HTTPS/TLS 1.3 for all API communication
• No sensitive data transmitted in URL parameters
• Request correlation IDs for audit tracing

At-Rest (Server):
• PostgreSQL with disk encryption (AES-256)
• Separate database per microservice (no cross-service data access)
• Tenant isolation at row level (every query filtered by tenant_id)

3. SESSION MANAGEMENT

• Access tokens: short-lived (5 minutes)
• Refresh tokens: 30-day expiry with rotation on use
• Device binding: sessions tied to device_id (x-device-id header)
• Concurrent session limit: configurable per tenant (default: 3 devices)
• Logout wipes ALL local data (tokens + encrypted database + sync cursors)

4. DEVICE SECURITY

• Jailbreak/root detection: rooted devices auto-blocked
• Screen lock requirement: flagged if device has no passcode
• Minimum OS version enforcement: Android 12+, iOS 16+
• App version enforcement: outdated versions flagged for update
• Device compliance checked on every heartbeat (app launch + resume)

5. OFFLINE SECURITY

• Encrypted outbox: mutations queued offline are AES-encrypted at rest
• Per-account database namespace: switching users creates isolated DB
• Stale data auto-purge: sync cursors expire, forcing fresh pull
• Conflict resolution: server always wins (prevents stale-data exploits)
• Dead-letter queue: failed mutations capped at 5 retries (no infinite loop)

6. API SECURITY

• Rate limiting: 1000 req/min global, 200 req/min per tenant
• Auth rate limiting: 10 req/min per username (brute-force protection)
• Input validation: zod schemas on every endpoint
• SQL injection prevention: parameterized queries only (Drizzle ORM)
• Content-Type enforcement: rejects non-JSON bodies with 400
• CORS: fail-closed in production (explicit origin whitelist)
• CSRF: not applicable (Bearer token auth, no cookies)
• Helmet CSP headers: script-src 'self' only

7. ACCESS CONTROL

• RBAC (Role-Based Access Control) via policy-service
• Every endpoint verifies: authentication + tenant_id + role permissions
• Multi-level approval workflows (maker-checker-verifier)
• Audit trail: every mutation emits an audit event to audit-service
• Sensitive operations require step-up authentication

8. DATA PROTECTION (DPDP Act Compliance)

• Data minimization: only essential data collected
• Purpose limitation: data used only for stated employment purposes
• Storage limitation: retention periods defined per data category
• Data Principal rights: access, correction, erasure supported
• No cross-border transfer: all data stored in India
• Breach notification: 72-hour notification protocol defined
• Data Protection Officer: contactable through app grievance module

9. INCIDENT RESPONSE

• Automated alerts on: unusual login patterns, device changes, mass data access
• Security events logged to dedicated audit service
• Device revocation: instant (next API call fails with 403)
• Session revocation: server-side token blacklist
• Data breach playbook: 72-hour CERT-In notification process

10. CERTIFICATIONS & COMPLIANCE

• DPDP Act 2023 (Digital Personal Data Protection)
• IT Act 2000 (Information Technology Act)
• CERT-In Security Guidelines
• CCS (Conduct) Rules — for government deployments
• STQC Compliance — for NIC/government hosting

11. RESPONSIBLE DISCLOSURE

If you discover a security vulnerability:
• Email: security@civitasone.gov.in
• Do NOT disclose publicly before resolution
• We commit to acknowledging within 48 hours
• Critical vulnerabilities patched within 72 hours

12. WHAT WE DO NOT DO

• We do NOT access your personal photos, contacts, or messages
• We do NOT track location outside of geo-fenced check-in (and only when you tap "Mark Attendance")
• We do NOT sell or share data with advertisers
• We do NOT use data for AI training outside your organization
• We do NOT retain data after account deletion (except statutory minimums)
''';
