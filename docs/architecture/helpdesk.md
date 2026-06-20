# Helpdesk Architecture (Option A)

## Decision

**Citizen-service** owns external/citizen-facing tickets. **Helpdesk-service** owns internal operations tickets. Both services remain registered in the gateway; each UI screen calls exactly one canonical API.

This split avoids merging databases while eliminating ambiguity about which service owns which ticket domain.

## Service boundaries

| Service | Domain | Database tables | Gateway prefix |
|---------|--------|-----------------|----------------|
| `citizen-service` | Citizen portal tickets, grievances, SLA analytics for citizen queues | `helpdesk.citizen_tickets`, `helpdesk.citizen_ticket_notes` | `/api/v1/citizen` |
| `helpdesk-service` | Internal staff ops tickets | `helpdesk.tickets` | `/api/v1/helpdesk` |

## Web UI → API mapping

| Web route | Loader | Gateway path | Upstream service |
|-----------|--------|--------------|------------------|
| `/helpdesk/tickets` | `getHelpdeskTickets()` | `GET /api/v1/citizen/tickets` | citizen-service |
| `/helpdesk/internal` | `getInternalHelpdeskTickets()` | `GET /api/v1/helpdesk/tickets` | helpdesk-service |
| `/helpdesk/reports` | `getHelpdeskMetrics()` | `GET /api/v1/citizen/analytics/metrics` | citizen-service |
| `/helpdesk/slas` | `getSlaRules()` | `GET /api/v1/citizen/analytics/sla-rules` | citizen-service |

Citizen-facing analytics (reports, SLA monitor) stay on citizen-service because they reflect citizen queue health. Internal ops metrics may be added to helpdesk-service in a follow-up.

## Shared types

Wire shapes for ticket list rows live in `@civitasone/types`:

- `HelpdeskTicketPriority`, `HelpdeskTicketStatus`
- `HelpdeskTicketSummary` — citizen-facing list row
- `InternalHelpdeskTicketSummary` — alias of the same shape for internal ops

Response validation uses `@civitasone/schemas/web` (`ticketsListSchema`, `helpdeskTicketSchema`).

## Roles

| Service | Roles |
|---------|-------|
| citizen-service | `citizen`, `citizen_officer`, `citizen_admin`, `super_admin` |
| helpdesk-service | `helpdesk_user`, `helpdesk_admin`, `super_admin` |

## Migration notes

No database merge is required under Option A. Citizen and internal ticket stores remain separate schemas within the `helpdesk` Postgres schema. Cross-linking (e.g. escalating a citizen ticket to internal ops) should be implemented via events, not shared tables.

## Deprecation

Do not route new internal-ops UI to citizen-service ticket endpoints. The orphaned duplicate is resolved by giving helpdesk-service its own screen (`/helpdesk/internal`) rather than removing the service.
