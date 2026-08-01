# protocols module (AG-005)

Registry of open agent-interoperability endpoints: MCP, A2A, and OpenAI/Anthropic
tool schemas.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/ai/protocols` | List registrations (cache-first, filterable) |
| POST | `/v1/ai/protocols` | Register an endpoint |
| PATCH | `/v1/ai/protocols/:id` | Update endpoint / capabilities / enabled |
| GET | `/v1/ai/protocols/:id/capabilities` | Discovered capability descriptor |

## Events

`ai.protocol.registered`, `ai.protocol.updated`.

## Rules

- `endpoint` must be `https`; plain `http` is accepted only for loopback hosts,
  because interop traffic carries prompts and tool arguments.
- Capabilities are normalised (nameless entries dropped, deduped by name) before
  they are stored, so the descriptor is stable.

## Table

`ai_agent.protocol_registrations` (migration 0002).

## Dependencies

`shared/db`, `shared/outbox`, `shared/audit`, `shared/infra` (cache).
