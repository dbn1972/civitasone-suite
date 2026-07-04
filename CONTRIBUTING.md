# Contributing to CivitasOne Suite

First off, thank you for considering contributing to CivitasOne! Every contribution matters — whether it's a bug fix, documentation improvement, or a new feature.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to conduct@civitasone.app.

## How to Contribute

### 🐛 Reporting Bugs

Found a bug? Please [open an issue](https://github.com/CivitasOne/civitasone-suite/issues/new?template=bug_report.yml) with:

- A clear title and description
- Steps to reproduce the behavior
- Expected vs actual behavior
- Environment details (OS, browser, service name)
- Screenshots if applicable

### 💡 Suggesting Features

Have an idea? [Open a feature request](https://github.com/CivitasOne/civitasone-suite/issues/new?template=feature_request.yml) with:

- The problem you're trying to solve
- Your proposed solution
- Alternatives you've considered
- Which module(s) would be affected

### 📝 Improving Documentation

Documentation improvements are always welcome. [Open a docs issue](https://github.com/CivitasOne/civitasone-suite/issues/new?template=documentation.yml) or submit a PR directly.

---

## Development Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Runtime |
| pnpm | 9+ | Package manager |
| Docker | 24+ | Infrastructure services |
| Docker Compose | 2.20+ | Multi-container orchestration |
| Git | 2.40+ | Version control |

### Getting Started

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/civitasone-suite.git
cd civitasone-suite

# 2. Install dependencies
pnpm install

# 3. Copy environment file
cp .env.example .env

# 4. Start infrastructure (Postgres, Redis, LocalStack, Keycloak)
docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml up -d

# 5. Run database migrations
pnpm db:migrate

# 6. Start development
pnpm dev
```

### Running Tests

```bash
# All tests
pnpm test

# Single service
pnpm --filter @civitasone/finance-service test

# With coverage
pnpm test -- --coverage

# Type checking
pnpm typecheck

# Lint
pnpm lint

# Full CI check
pnpm ci:check
```

---

## Pull Request Process

### Branch Naming

Use the following prefixes:

| Prefix | Use Case |
|--------|----------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `test/` | Adding or updating tests |
| `refactor/` | Code refactoring (no behavior change) |
| `chore/` | Maintenance, deps, tooling |

Example: `feat/finance-budget-transfer` or `fix/hrms-leave-calculation`

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `ci`

**Scopes:** Service or package name — `finance`, `hrms`, `web`, `auth`, `queue`, etc.

**Examples:**

```
feat(finance): add budget transfer approval workflow
fix(hrms): correct leave balance calculation for carry-forward
docs(api): update procurement endpoint examples
test(citizen): add integration tests for grievance filing
refactor(cache): simplify getOrLoad retry logic
```

### PR Checklist

Before submitting your PR, ensure:

- [ ] Tests pass: `pnpm test`
- [ ] Type check passes: `pnpm typecheck`
- [ ] Lint passes: `pnpm lint`
- [ ] No `console.log` in service source code
- [ ] All new route inputs validated with zod
- [ ] All mutations emit audit events
- [ ] RBAC permissions checked where applicable
- [ ] 80%+ coverage on changed code
- [ ] PR description explains what and why

### Review Process

| Change Type | Required Approvals |
|------------|-------------------|
| Services (backend) | 2 reviewers |
| Packages (shared libs) | 2 reviewers |
| Web / Mobile (frontend) | 1 reviewer |
| Documentation | 1 reviewer |
| Infrastructure | 2 reviewers |

---

## Architecture Rules

These are CI-enforced and non-negotiable:

### Database Isolation
- Each service owns its own PostgreSQL database
- No cross-service database access
- Within a service, each module owns its own PG schema
- No cross-schema JOINs

### CQRS Pattern (Mandatory)
```
Route → Validate (zod) → Publish Command to SQS → Return 202
Consumer → Idempotency Check → Write (Outbox) → Emit Audit Event → Refresh Cache
```
- Never write to PostgreSQL from a route handler
- All reads go through Redis cache (`@civitasone/cache` `getOrLoad`)

### Cross-Service Communication
- **Reads**: HTTP API calls
- **Writes**: SQS message queue
- **Never**: Cross-service SQL queries

### Entity Requirements

Every database entity must have:
```typescript
id: uuid
tenantId: uuid
createdAt: timestamptz
updatedAt: timestamptz
createdBy: uuid
updatedBy: uuid
version: integer
```

### Input Validation
- All route inputs validated with zod at the boundary
- Use `@civitasone/schemas` for shared validation schemas

### Audit Events
- Every mutation emits an audit event via `@civitasone/events`
- Events include: actor, tenantId, action, entity, before/after state

---

## Code Style

### TypeScript
- Strict mode (`strict: true`)
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- No `any` — use `unknown` and narrow
- Prefer interfaces for object shapes, types for unions/aliases

### Formatting
- Prettier (configured in repo)
- ESLint with strict TypeScript rules
- Run `pnpm lint` to verify

### Naming
- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Database columns: `snake_case`

---

## Testing Requirements

- **Minimum 80% coverage** on changed code
- Unit tests for domain logic and validators
- Integration tests for routes and consumers
- Tests co-located as `*.test.ts` next to source
- Use HS256 bypass for auth in tests:
  ```typescript
  // JWT_ALGORITHM=HS256, JWT_SECRET=test_secret_for_civitasone_32chr
  ```

---

## Getting Help

- **Discord**: [Join our community](https://discord.gg/civitasone)
- **Discussions**: [GitHub Discussions](https://github.com/CivitasOne/civitasone-suite/discussions)
- **Email**: contributors@civitasone.app

Thank you for helping make government technology better! 🇮🇳
