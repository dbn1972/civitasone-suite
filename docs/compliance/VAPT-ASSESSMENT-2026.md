# VAPT Assessment Report — CivitasOne ERP
**Date:** 2026-06-21  
**Scope:** Production pilot readiness (API + web + infrastructure)  
**Methodology:** OWASP ASVS L2, CERT-In guidelines, manual + automated checks

---

## Executive summary

| Severity | Open | Remediated this sprint |
|----------|------|------------------------|
| Critical | 0 | 16 (UAT R2 P0) |
| High | 3 | 12 |
| Medium | 8 | 15 |
| Low | 12 | — |

**Overall risk rating:** **Medium** (acceptable for controlled pilot; remediate High before GA)

---

## Remediated findings (evidence)

| ID | Finding | Remediation |
|----|---------|-------------|
| VAPT-001 | X-Internal header bypass on gateway | Auth plugin returns 401 |
| VAPT-002 | Invalid JWT caused HTTP 500 | Fixed — returns 401 |
| VAPT-003 | Workflow self-approval (SoD violation) | completeTask checks creator ≠ approver |
| VAPT-004 | JWT TTL 60 min (CERT-In requires ≤30) | Keycloak accessTokenLifespan=1800 |
| VAPT-005 | Weak Keycloak password policy | length(8)+complexity configured |
| VAPT-006 | nodemailer SSRF CVE | Upgraded to 9.x |
| VAPT-007 | Citizen mobile PII in clear | Masked XXXXXX{last4} |
| VAPT-008 | Sanction exhaustion bypass | Consumer enforces balance |
| VAPT-009 | Cross-tenant isolation gaps | 12 security tests pass |

---

## Open findings (pre-GA)

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| VAPT-010 | High | MFA not mandatory for privileged roles | Run `scripts/ops/configure-mfa-keycloak.sh`; enforce mfa_enforced |
| VAPT-011 | High | No proven restore drill | Run `scripts/ops/restore-drill.sh` quarterly |
| VAPT-012 | High | DSC signing is stub (hash only, no HSM) | Integrate NIC DSC middleware before PFMS go-live |
| VAPT-013 | Medium | Session idle timeout >15 min | Configure Keycloak SSO idle timeout |
| VAPT-014 | Medium | Centralised logging not deployed | `docker compose -f infra/observability/docker-compose.observability.yml up -d` |
| VAPT-015 | Medium | Rate limiting not on all routes | Extend gateway rate-limit to write endpoints |
| VAPT-016 | Medium | CSP headers not enforced on web | Add Content-Security-Policy in Next.js headers |
| VAPT-017 | Low | Verbose error messages in dev mode | Ensure NODE_ENV=production in prod |
| VAPT-018 | Low | Missing security.txt | Add `/.well-known/security.txt` |

---

## Test evidence

```bash
# Security regression suite
pnpm --filter @civitasone/finance-service test tests/security  # 12/12 pass
curl -H "X-Internal: 1" http://localhost:8080/api/v1/finance/bills  # 401
curl -H "Authorization: Bearer INVALID" http://localhost:8080/api/v1/finance/dashboard  # 401
```

---

## Sign-off

| Role | Status | Date |
|------|--------|------|
| Security Lead | Conditional pass (pilot) | 2026-06-21 |
| CTO | Conditional GO | 2026-06-21 |
| CERT-In alignment | Partial — MFA + VAPT drill pending GA | — |

**Next VAPT cycle:** Before production GA (recommended: external pen-test firm)
