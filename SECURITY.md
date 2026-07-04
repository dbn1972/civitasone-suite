# Security Policy

The CivitasOne team takes security seriously. We appreciate your efforts to responsibly disclose your findings.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x | ✅ Active development |
| 0.1.x | ⚠️ Critical fixes only |
| < 0.1 | ❌ Unsupported |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, send an email to **security@civitasone.app** with:

1. **Description** of the vulnerability
2. **Steps to reproduce** (proof of concept if possible)
3. **Impact assessment** — what could an attacker achieve?
4. **Affected component** — which service, package, or app?
5. **Your contact info** for follow-up

### What to Expect

| Step | Timeline |
|------|----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix for Critical/High | Within 7 days |
| Fix for Medium | Within 30 days |
| Fix for Low | Next release cycle |
| Public disclosure | After fix is released + 30 days |

We will keep you informed of progress and may ask for additional information.

## Scope

### In Scope

- All 33 microservices (`services/`)
- Shared packages (`packages/`)
- Web application (`apps/web/`)
- Mobile application (`apps/mobile/`)
- API Gateway authentication and authorization
- Data isolation between tenants
- Session management and token handling
- Input validation and injection flaws

### Out of Scope

- Third-party dependencies (report upstream; notify us if critical)
- Infrastructure configurations (Terraform, Helm) unless default is insecure
- Social engineering attacks
- Denial of service (volumetric)
- Issues in development/staging environments only
- Issues requiring physical access to a device

## Bug Bounty

A formal bug bounty program is **planned but not yet active**. Currently, we offer:

- Public acknowledgment in our security hall of fame (with your permission)
- Early access to security-related releases
- CivitasOne swag for significant findings

We will announce the formal program when launched.

## Security Features

CivitasOne Suite implements defense-in-depth:

### Authentication & Authorization
- PKCE-based OAuth 2.0 flows via Keycloak 24
- RS256 JWT verification with JWKS rotation
- Device trust and fingerprinting
- Session binding with refresh token rotation
- Role-Based Access Control (RBAC) with granular permissions

### Data Protection
- Tenant isolation enforced at database, cache, and API layers
- Encrypted at rest (AES-256) and in transit (TLS 1.3)
- DPDP Act compliance — data export, deletion, consent tracking
- No cross-tenant data leakage by architecture

### Application Security
- All inputs validated with zod at route boundary
- Parameterized queries via Drizzle ORM (no raw SQL)
- Rate limiting on all public endpoints
- Security headers (CSP, HSTS, X-Frame-Options)
- CSRF protection on state-changing operations
- Immutable audit trail for all mutations

### Infrastructure
- Database-per-service isolation
- Secrets managed via environment variables (never in code)
- Container images scanned for vulnerabilities
- Dependency audit in CI pipeline
- SAST scanning on every PR

## Disclosure Policy

- We follow coordinated disclosure practices
- We will not take legal action against researchers who follow this policy
- We ask that you give us reasonable time to fix issues before public disclosure
- We will credit you (unless you prefer anonymity) in our changelog

## Contact

- **Security reports**: security@civitasone.app
- **PGP key**: Available upon request
- **General questions**: hello@civitasone.app
