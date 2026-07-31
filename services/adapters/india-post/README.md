# India Post Adapters

This directory contains the adapter services for India Post system integrations.

## Architecture

Each adapter implements a **standard interface pattern** to bridge external India Post systems into the CivitasOne event bus:

1. **Standard Interfaces** — Every adapter exposes a consistent REST API following CivitasOne conventions (Fastify, Zod validation, tenant-scoped, audited).
2. **Independent Deployment** — Each adapter is a standalone microservice with its own `package.json`, Docker image, and port allocation. Adapters can be deployed, scaled, and versioned independently.
3. **Event Bus Bridge** — Adapters translate external system responses into CivitasOne domain events published to the internal queue (SQS/RabbitMQ). Downstream services consume these events without coupling to the external system's API.
4. **Per-Tenant Configuration** — Each adapter reads tenant-specific credentials and configuration from environment variables or the tenant-config store. Multiple tenants can use different API keys, endpoints, or rate-limit profiles.

## Adapters

| Adapter | External System | Port | Status |
|---------|----------------|------|--------|
| `apt-adapter` | APT (Article Processing & Tracking) | 3050 | Scaffolded |
| `posb-adapter` | Post Office Savings Bank | — | Placeholder |
| `pli-adapter` | Postal Life Insurance | — | Placeholder |
| `ippb-adapter` | India Post Payments Bank | — | Placeholder |
| `cpgrams-adapter` | CPGRAMS (Grievance) | — | Placeholder |
| `dream-adapter` | DREAM (Delivery Reporting) | — | Placeholder |
| `digipin-adapter` | DigiPIN (Digital PIN code) | — | Placeholder |
| `dak-karmayogi-adapter` | Dak Karmayogi (Training/HR) | — | Placeholder |

## Conventions

- Follow `@civitasone/*` monorepo conventions (TypeScript strict, Fastify 4, Zod, Drizzle).
- All adapters use `@civitasone/circuit-breaker` for outbound calls to external systems.
- Retry policy: max 3 retries with exponential backoff on transient failures.
- Timeout: 10s default for all outbound HTTP calls.
- Observability: Pino structured logging, OpenTelemetry tracing, `/health` endpoint.
- Auth: Keycloak JWT via `@civitasone/auth` plugin (same as all other services).

## Adding a New Adapter

1. Copy the `apt-adapter/` structure as a template.
2. Assign a port from the adapter port range (3050–3069).
3. Implement the external system's client using `@civitasone/circuit-breaker`.
4. Publish domain events to the CivitasOne queue on successful operations.
5. Add tenant-specific config support via env vars or tenant-config lookup.
6. Register the adapter in the gateway service registry.
