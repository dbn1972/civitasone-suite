# CivitasOne Headless Build Prompts

Run any prompt on the remote server:

```bash
ssh cloudsphere-ec2
cd ~/CivitasOne/civitasone-suite
export PATH="$HOME/.npm-global/bin:$PATH"
claude -p "$(cat .claude/headless-prompts/01-platform.md)" --dangerously-skip-permissions
```

## Build order (must follow — services depend on each other via events)

| Step | File | Service | Why first |
|------|------|---------|-----------|
| 1 | 01-platform.md | identity + tenant + policy + audit | Every other service depends on JWT auth and tenant context |
| 2 | 02-finance.md | finance-service | Budget/sanction check needed by procurement |
| 3 | 03-procurement.md | procurement-service | P2P backbone — feeds asset, stock, finance |
| 4 | 04-hr.md | hrms-service | Payroll posts to finance GL |
| 5 | 05-establishment.md | estab-service | File approval triggers procurement indent |
| 6 | 06-asset.md | asset-service | Fed by procurement GRN |
| 7 | 07-projects.md | project-service + scheme | Fund releases post to finance |
| 8 | 08-grants.md | grant-service | Bills/PFMS via finance |
| 9 | 09-citizen.md | citizen-service | Standalone CRM |
| 10 | 10-audit-legal.md | audit + legal services | Cross-cutting, reads all modules |
| 11 | 11-notification.md | notification-service | Consumed by all modules |
| 12 | 12-admin.md | admin + billing | Control plane, last |

## What each prompt does
Each prompt runs a complete slice:
1. Reads the screen HTML from `~/CivitasOne/erpnext-develop/{module}/web/`
2. Reads the schema from `MODULES_AND_SCHEMA.md`
3. Writes the Drizzle migration SQL
4. Writes the Fastify routes (CQRS: validate → SQS → 202)
5. Writes the worker/consumer (SQS → outbox → Postgres)
6. Writes the query handlers (Redis cache → Postgres)
7. Runs `pnpm typecheck && pnpm test`
8. Applies the migration to the live Postgres on localhost:5435
