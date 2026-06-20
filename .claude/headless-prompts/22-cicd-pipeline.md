You are setting up the CI/CD pipeline for CivitasOne Suite.
Read CLAUDE.md, `turbo.json`, `package.json` (root), and `pnpm-workspace.yaml` first.
Then read the existing test files in any two services (tenant-service, finance-service) to understand test patterns.

## Goal

Create GitHub Actions workflows that enforce quality gates on every PR and main branch push.
The pipeline must be fast (parallel jobs) and block merge on any failure.

## Files to create

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '9'

jobs:
  # ─────────────────────────────────────────────
  # Job 1: Type-check + Lint (fastest gate)
  # ─────────────────────────────────────────────
  typecheck-lint:
    name: Typecheck & Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo typecheck --parallel
      - run: pnpm turbo lint --parallel

  # ─────────────────────────────────────────────
  # Job 2: Unit + integration tests (vitest)
  # ─────────────────────────────────────────────
  test:
    name: Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: civitas
          POSTGRES_PASSWORD: civitas_test
          POSTGRES_DB: civitas_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: --health-cmd "redis-cli ping" --health-interval 10s
    env:
      DATABASE_URL: postgres://civitas:civitas_test@localhost:5432/civitas_test
      REDIS_URL: redis://localhost:6379
      QUEUE_DRIVER: memory
      JWT_SECRET: ci-test-secret-min-32-chars-long
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter='./packages/*'
      - name: Run all service tests
        run: pnpm turbo test --parallel
      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: '**/coverage/'
          retention-days: 7

  # ─────────────────────────────────────────────
  # Job 3: Architecture guard (no cross-service SQL)
  # ─────────────────────────────────────────────
  arch-guard:
    name: Architecture Guard
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check no cross-service DB joins
        run: |
          # L1 rule: no service may import another service's schema
          if grep -r "from.*services/" services/*/src --include="*.ts" | grep -v "node_modules" | grep -v ".test.ts"; then
            echo "❌ Cross-service import detected"
            exit 1
          fi
          echo "✅ No cross-service imports"
      - name: Check no console.log in service src
        run: |
          if grep -r "console\.log" services/*/src --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"; then
            echo "❌ console.log found in service source"
            exit 1
          fi
          echo "✅ No console.log in service source"
      - name: Check no raw 'any' type
        run: |
          if grep -rn ": any" services/*/src --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules" | grep -v "eslint-disable"; then
            echo "❌ Raw 'any' type found"
            exit 1
          fi
          echo "✅ No raw any types"

  # ─────────────────────────────────────────────
  # Job 4: Web build check
  # ─────────────────────────────────────────────
  web-build:
    name: Web Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: Build packages first
        run: pnpm turbo build --filter='./packages/*'
      - name: Build web app
        run: pnpm --filter @civitasone/web build
        env:
          NEXT_PUBLIC_API_BASE: http://localhost:8080
          SKIP_ENV_VALIDATION: true

  # ─────────────────────────────────────────────
  # Job 5: Contract tests (gateway routing)
  # ─────────────────────────────────────────────
  contract-tests:
    name: Contract Tests
    runs-on: ubuntu-latest
    needs: [typecheck-lint]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter='./packages/*' --filter='./services/gateway-service'
      - name: Run contract tests
        run: pnpm --filter @civitasone/web test -- --testPathPattern=contract
        env:
          QUEUE_DRIVER: memory
          JWT_SECRET: ci-test-secret-min-32-chars-long
```

### `.github/workflows/release.yml`

```yaml
name: Release Gate

on:
  push:
    branches: [main]

jobs:
  release-gate:
    name: Release Readiness
    runs-on: ubuntu-latest
    needs: []
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '9' }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: Production readiness score
        run: node scripts/production-readiness-score.mjs
        continue-on-error: true
      - name: Service health check (if services running)
        run: |
          echo "Services must be verified manually on staging before deploy."
          echo "Gateway registry entry count:"
          grep -c "prefix:" services/gateway-service/src/registry.ts || true
```

### `.github/workflows/security.yml`

```yaml
name: Security Scan

on:
  schedule:
    - cron: '0 2 * * 1'  # Every Monday 2am UTC
  push:
    branches: [main]

jobs:
  dependency-audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '9' }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --prod --audit-level=high
        continue-on-error: true

  secret-scan:
    name: Secret Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Additional setup

### `apps/web/package.json` scripts

Ensure these exist:
```json
"test": "vitest run",
"test:unit": "vitest run --testPathPattern=unit",
"e2e": "playwright test"
```

### Root `package.json` scripts

Add:
```json
"ci:check": "pnpm turbo typecheck lint test --parallel"
```

### `.github/CODEOWNERS`

Create:
```
# Global owners
* @civitasone/core-team

# Architecture decisions require platform team review
CLAUDE.md @civitasone/platform
docs/ARCHITECTURE.md @civitasone/platform
infra/ @civitasone/platform

# Service changes require service owner
services/finance-service/ @civitasone/finance-team
services/hrms-service/ @civitasone/hr-team
services/procurement-service/ @civitasone/procurement-team
```

### `.github/pull_request_template.md`

Create:
```markdown
## Summary
<!-- What does this PR do? -->

## Type
- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Migration

## Checklist
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] No `console.log` in service src
- [ ] No cross-service SQL joins
- [ ] Migration applied and rolled back successfully
- [ ] Zod validation on all new route inputs

## Breaking changes
<!-- List any breaking changes to API contracts or event schemas -->
```

## Verification

After creating all files:
```bash
# Validate YAML syntax
python3 -c "import yaml; [yaml.safe_load(open(f)) for f in ['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/security.yml']]"
echo "✅ YAML valid"
```

Do NOT run the GitHub Actions workflow — just create the files and verify YAML syntax.
