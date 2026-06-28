# MASTER PROMPT — Complete Technical Documentation Generator for CivitasOne Suite

## Role

You are a documentation team consisting of:
- **Chief Architect** — writes HLD, system architecture, infrastructure diagrams
- **Senior Backend Engineer** — writes LLD, API specs, database schemas, service internals
- **Mobile Lead** — writes Flutter architecture, screen specs, state management docs
- **Frontend Lead** — writes Next.js architecture, component library, page specs
- **DevOps Engineer** — writes deployment guides, Docker, K8s, CI/CD, monitoring
- **Security Architect** — writes security architecture, threat model, compliance docs
- **Technical Writer** — writes contributor guides, onboarding docs, coding standards
- **Product Designer** — writes design system docs, component specs, UX guidelines
- **QA Lead** — writes testing strategy, test plan, quality gates
- **Community Manager** — writes contributing guidelines, governance, roadmap

## Objective

Generate the **complete technical documentation suite** required for:
1. Open-source community development
2. New developer onboarding (backend, frontend, mobile, DevOps)
3. Designer contribution (design system, component specs)
4. SysAdmin deployment (on-prem + cloud)
5. Security audit (VAPT, compliance, threat model)
6. Enterprise adoption (RFP response, capability matrix)

## Context

CivitasOne Suite is:
- 33 microservices (Node.js/TypeScript/Fastify)
- Flutter mobile app (50 screens)
- Next.js 14 web app (386 pages)
- PostgreSQL 16 (one DB per service)
- Redis 7 (cache), SQS (queue), S3 (storage)
- Keycloak 24 (auth), Drizzle ORM
- pnpm workspaces + Turborepo monorepo
- CQRS architecture, transactional outbox
- Multi-tenant with RLS isolation

Scan the full codebase at:
```
civitasone-suite/
├── services/          — 33 microservices
├── apps/web/          — Next.js frontend
├── apps/mobile/       — Flutter mobile
├── packages/          — 12 shared packages
├── infra/             — Docker, Terraform, Helm
├── tests/             — Contract + integration tests
├── scripts/           — Dev/CI utilities
└── docs/              — Existing documentation
```

---

## Documents to Generate

### SECTION 1: Architecture Documents

#### 1.1 High-Level Design (HLD)
Generate: `docs/architecture/HIGH-LEVEL-DESIGN.md`

Include:
- System context diagram (Mermaid C4)
- Container diagram (all 33 services + databases + queues + cache)
- Technology stack decisions with rationale
- Communication patterns (sync HTTP, async SQS, events)
- Multi-tenancy architecture
- Data flow diagrams (read path, write path)
- Deployment topology (single-node dev, K8s prod)
- Scalability strategy (horizontal scaling, connection pooling)
- High availability design (failover, health checks)
- Disaster recovery (backup, RTO, RPO)

#### 1.2 Low-Level Design (LLD)
Generate: `docs/architecture/LOW-LEVEL-DESIGN.md`

For each service, document:
- Module breakdown with responsibilities
- Database schema (tables, relationships, indexes)
- API contracts (OpenAPI-style: method, path, request, response)
- Event contracts (topics produced, topics consumed)
- CQRS flow (route → validate → queue → consumer → outbox → cache)
- Error handling patterns
- Idempotency strategy
- Cache invalidation strategy
- Rate limiting rules
- Concurrency handling

#### 1.3 Database Design Document
Generate: `docs/architecture/DATABASE-DESIGN.md`

Include:
- ER diagrams per service (Mermaid)
- Table catalog (name, columns, types, constraints, indexes)
- Foreign key relationships
- Tenant isolation strategy (tenant_id on every table)
- Row-Level Security (RLS) policies
- Migration naming convention
- Data retention policies
- Partitioning strategy (for high-volume tables)
- Backup & restore procedures

#### 1.4 API Reference
Generate: `docs/api/API-REFERENCE.md`

For every service endpoint:
- HTTP method + path
- Request headers (auth, correlation-id, tenant-id)
- Request body schema (with examples)
- Response schema (success + error)
- Status codes
- Rate limits
- RBAC roles required
- Example curl commands

#### 1.5 Event Catalog
Generate: `docs/architecture/EVENT-CATALOG.md`

For every inter-service event:
- Topic name
- Producer service
- Consumer service(s)
- Payload schema
- Ordering guarantees
- Retry/DLQ behavior
- Idempotency key

---

### SECTION 2: Developer Guides

#### 2.1 Getting Started (Developer Onboarding)
Generate: `docs/guides/GETTING-STARTED.md`

Include:
- Prerequisites (Node 20, pnpm 9, Docker, Flutter SDK)
- Clone + install steps
- Start dev infrastructure (docker compose)
- Start services (pm2 / turbo dev)
- Run tests
- First API call walkthrough
- First code change walkthrough
- PR submission process

#### 2.2 Backend Development Guide
Generate: `docs/guides/BACKEND-DEVELOPMENT.md`

Include:
- Service anatomy (app.ts, modules, shared, topics, worker)
- Module structure (schema, domain, commands, consumer, repo, routes, validators)
- Adding a new endpoint (step-by-step)
- Adding a new module (step-by-step)
- Writing a migration
- Writing a consumer (SQS handler)
- Using the outbox pattern
- Using the cache (getOrLoad)
- Error handling (HttpError, ZodError)
- Testing patterns (Vitest, supertest)
- Auth in tests (HS256 bypass)

#### 2.3 Frontend Development Guide
Generate: `docs/guides/FRONTEND-DEVELOPMENT.md`

Include:
- Next.js App Router structure
- Page patterns (server component with fetchJson)
- Design system components (PageHeader, StatCard, DataTable, Card, EmptyState)
- Adding a new page
- Data fetching (apiClient.ts, LoaderResult)
- TypeScript patterns
- Tailwind CSS conventions
- shadcn/ui usage

#### 2.4 Mobile Development Guide
Generate: `docs/guides/MOBILE-DEVELOPMENT.md`

Include:
- Flutter project structure
- State management (Riverpod providers)
- Navigation (GoRouter, ShellRoute, full-screen routes)
- Sync engine (outbox push, delta pull, mailboxes)
- Adding a new screen
- Theme system (AppColors, Spacing, TouchTargets)
- Offline-first patterns
- Haptic feedback
- Biometric lock integration
- Dark mode
- Localization (ARB files)
- Platform channels (Android native)

#### 2.5 Coding Standards
Generate: `docs/guides/CODING-STANDARDS.md`

Include:
- TypeScript style (strict mode, no-any, explicit return types)
- Naming conventions (files, variables, functions, types, events)
- Git commit messages (conventional commits)
- Branch strategy (feature branches, squash merge)
- PR checklist
- Code review expectations
- Documentation requirements
- Testing requirements (coverage targets)

---

### SECTION 3: Design System Documentation

#### 3.1 Design System
Generate: `docs/design/DESIGN-SYSTEM.md`

Include:
- Color tokens (light + dark mode)
- Typography scale
- Spacing system (4dp grid)
- Border radius tokens
- Elevation/shadow system
- Icon usage guidelines
- Touch target requirements (48dp min)
- Component library (with props + usage examples):
  - PageHeader, StatCard, StatGrid, DataTable, Card, EmptyState
  - StatusPill, SkeletonCard, FileUpload
  - AppGradientHeader, AppErrorState, AppEmptyState, AppCacheBanner
- Mobile vs Web component mapping
- Accessibility requirements (WCAG 2.2 AA)
- Dark mode guidelines
- Responsive breakpoints

#### 3.2 Mobile Design Specs
Generate: `docs/design/MOBILE-DESIGN-SPECS.md`

Include:
- Screen inventory (all 50 screens with wireframe descriptions)
- Navigation architecture (bottom nav, drawer, full-screen)
- App flow diagram (splash → onboarding → login → dashboard → lock)
- Card design patterns
- Form design patterns
- Loading/error/empty state patterns
- Animation specifications
- Gesture specifications

---

### SECTION 4: DevOps & Deployment

#### 4.1 Deployment Guide
Generate: `docs/devops/DEPLOYMENT-GUIDE.md`

Include:
- Single-node deployment (PM2 + Docker Compose)
- Kubernetes deployment (Helm charts)
- AWS deployment (Terraform)
- On-premises deployment (Ansible)
- Environment variables reference (all env vars, all services)
- Database setup (per-service PostgreSQL)
- Keycloak configuration
- Redis setup
- SQS/LocalStack setup
- S3/MinIO setup
- SSL/TLS configuration
- Domain/DNS setup

#### 4.2 Operations Guide
Generate: `docs/devops/OPERATIONS-GUIDE.md`

Include:
- Health check endpoints (/health, /ready)
- Monitoring (Prometheus metrics, Grafana dashboards)
- Logging (Pino structured JSON, log levels)
- Alerting rules
- Backup procedures
- Restore procedures
- Scaling procedures
- Troubleshooting common issues
- Runbook for incidents

#### 4.3 CI/CD Pipeline
Generate: `docs/devops/CICD-PIPELINE.md`

Include:
- GitHub Actions workflow (ci.yml, release.yml, security.yml)
- Build stages (typecheck → lint → test → build → deploy)
- Docker image building
- Semantic versioning
- Release process
- Rollback procedures

---

### SECTION 5: Security Documentation

#### 5.1 Security Architecture
Generate: `docs/security/SECURITY-ARCHITECTURE.md`

Include:
- Authentication architecture (PKCE, Keycloak, JWT)
- Authorization architecture (RBAC, policy-service)
- Data encryption (at-rest, in-transit)
- Tenant isolation (RLS, separate DBs)
- API security (rate limiting, input validation, CORS)
- Mobile security (biometric, encrypted DB, device trust)
- Network security (internal communication, gateway)
- Secret management
- Audit trail architecture

#### 5.2 Threat Model
Generate: `docs/security/THREAT-MODEL.md`

Include:
- STRIDE analysis per component
- Attack surface mapping
- Risk matrix (likelihood × impact)
- Mitigations implemented
- Residual risks
- Security testing requirements

#### 5.3 Compliance Matrix
Generate: `docs/security/COMPLIANCE-MATRIX.md`

Include:
- DPDP Act 2023 compliance checklist
- IT Act 2000 compliance
- CERT-In guidelines compliance
- OWASP Top 10 (API + Mobile)
- ISO 27001 mapping
- Data classification
- Retention policies

---

### SECTION 6: Community & Governance

#### 6.1 Contributing Guide
Generate: `CONTRIBUTING.md` (root)

Include:
- How to contribute (code, docs, design, translations)
- Development setup
- Issue reporting guidelines
- PR process
- Code review process
- Release process
- Communication channels
- Code of Conduct reference

#### 6.2 Project Governance
Generate: `docs/community/GOVERNANCE.md`

Include:
- Project structure (core team, maintainers, contributors)
- Decision-making process
- RFC process for major changes
- Release cadence
- Versioning strategy
- Deprecation policy

#### 6.3 Roadmap
Generate: `docs/community/ROADMAP.md`

Include:
- Current release status
- Upcoming features (prioritized)
- Long-term vision
- Community-requested features
- Known limitations

---

### SECTION 7: Testing Documentation

#### 7.1 Testing Strategy
Generate: `docs/testing/TESTING-STRATEGY.md`

Include:
- Testing pyramid (unit → integration → contract → E2E)
- Unit testing patterns (Vitest)
- Integration testing (supertest + in-memory Fastify)
- Contract testing (inter-service)
- E2E testing (Playwright)
- Load testing (k6)
- Test data strategy
- Coverage targets (≥80% on changed code)
- CI enforcement

---

## Output Requirements

1. **Format:** Markdown with Mermaid diagrams where applicable
2. **Length:** Each document should be comprehensive (2000-5000 words minimum)
3. **Code examples:** Include real code snippets from the codebase
4. **Diagrams:** Use Mermaid for architecture, sequence, ER diagrams
5. **Cross-references:** Link between documents
6. **Audience-aware:** Label each document's target audience (developer/designer/sysadmin/all)
7. **Actionable:** Every guide should have step-by-step instructions a new contributor can follow

## Execution

Start by scanning the codebase structure, then generate documents in this order:
1. HLD (architecture overview)
2. Getting Started (developer onboarding)
3. Backend Development Guide
4. API Reference (top 5 services)
5. Database Design
6. Deployment Guide
7. Security Architecture
8. Contributing Guide

The remaining documents can follow in any order.

---

*This prompt produces a complete documentation suite sufficient for open-source community development, enterprise evaluation, and developer onboarding.*
