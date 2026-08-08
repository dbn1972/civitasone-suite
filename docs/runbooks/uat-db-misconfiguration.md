# UAT Environment — DATABASE_URL Misconfiguration

**Discovered:** 2026-08-07 during UAT battery execution  
**Severity:** P1 — Multiple services returning 500 on all queries  
**Impact:** HRMS, Citizen, Helpdesk, Telephony services all non-functional

## Problem

Several services in the UAT environment were started with incorrect `DATABASE_URL` values. All affected services point to `civitas_works` instead of their own databases.

**Evidence** (from `/proc/<pid>/environ`):
```
# HRMS (PID 3412997) — WRONG
DATABASE_URL=postgres://works_svc:works_dev_pw@localhost:5435/civitas_works

# Expected
DATABASE_URL=postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms
```

## Affected Services

| Service | Port | Symptom | Root Cause |
|---------|------|---------|------------|
| hrms-service | 3012 | 500 on all queries | Wrong DATABASE_URL |
| citizen-service | 3020 | 500 on all queries | Wrong DATABASE_URL (suspected) |
| helpdesk-service | 3027 | 500 on all queries | Wrong DATABASE_URL (suspected) |
| telephony-service | 3026 | 500 on all queries | Wrong DATABASE_URL (suspected) |

**Not affected** (verified working): payroll, estab, finance, procurement, contract, stock, inventory, project, audit, identity, CRM, legal, court, gateway.

## Fix

Restart the affected services with correct DATABASE_URL values. The correct credentials follow the pattern:

```bash
# Pattern: postgres://{service}_svc:{service}_dev_pw@localhost:5435/civitas_{service}

# HRMS
DATABASE_URL=postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms

# Citizen
DATABASE_URL=postgres://citizen_svc:citizen_dev_pw@localhost:5435/civitas_citizen

# Helpdesk
DATABASE_URL=postgres://helpdesk_svc:helpdesk_dev_pw@localhost:5435/civitas_helpdesk

# Telephony
DATABASE_URL=postgres://telephony_svc:telephony_dev_pw@localhost:5435/civitas_telephony
```

Check `infra/docker-compose.yml` and the service startup scripts for the source of the misconfiguration.

## Verification

After restart, confirm each service responds to its health + list endpoint:

```bash
# Health
curl -s http://localhost:3012/health  # hrms
curl -s http://localhost:3020/health  # citizen
curl -s http://localhost:3027/health  # helpdesk
curl -s http://localhost:3026/health  # telephony

# Query (with valid token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3012/v1/hrms/employees?limit=1
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3020/v1/citizen/grievances?limit=1
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3027/v1/helpdesk/tickets?limit=1
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3026/v1/telephony/calls?limit=1
```

## Prevention

- Add a startup assertion in each service that validates `DATABASE_URL` contains the expected database name:
  ```typescript
  const expected = `civitas_${SERVICE_NAME.replace('-service', '')}`;
  if (!DATABASE_URL.includes(expected)) {
    throw new Error(`DATABASE_URL mismatch: expected DB name containing "${expected}"`);
  }
  ```
- The stack startup script should source per-service `.env` files rather than inheriting a shared environment.

---

# JWT Auth Misalignment — CDP & Catalogue

**Discovered:** 2026-08-08 during UAT pack 06 execution

## Problem

CDP and Catalogue services reject the HS256 dev token that all other services accept.

| Service | Port | JWT_ALGORITHM | Issue |
|---------|------|---------------|-------|
| cdp-service | 3043 | RS256 | Should be HS256 in dev |
| catalogue-service | 3044 | HS256 | Config correct but auth plugin may use a different verification path |

## Fix

1. Restart both services with:
   ```
   JWT_ALGORITHM=HS256
   JWT_SECRET=civitasone-dev-secret
   ```

2. For catalogue: check if its auth plugin imports from a local `shared/auth.ts` that overrides the algorithm. May need to align with `@civitasone/auth`.

3. For CDP: process had `JWT_ALGORITHM=RS256` — change to `HS256` in the startup script/env file.
