# Runbook: plugin-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 300 ms, plugin sandbox isolation guarantee 100%.

- **Purpose:** plugin/extension ecosystem — plugin registry (install/enable/disable/uninstall/configure), hook registration (lifecycle events that plugins can subscribe to), sandboxed runtime execution, persistent key-value store per plugin, marketplace listing, and item management. Owns `civitas_plugin`. 8 modules. Enables tenant-specific customizations without core code changes.

- **Owner / escalation:** primary: Platform Engineering. Secondary: SRE. Page on sandbox escape detection or plugin causing service degradation.

- **Dependencies:**
  - Own Postgres DB (`civitas_plugin`), RLS enabled, tenant-scoped. Stores registry state, hook registrations, store data.
  - Redis — plugin config cache (quick lookup for enabled plugins on each request), store data cache.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for item create, registry lifecycle (install/enable/disable/uninstall/configure), hook register/deregister, store put/delete; events mirroring all mutations.
  - Sandbox: plugins execute in an isolated environment (V8 isolate or container sandbox depending on plugin type). CPU/memory/time limits enforced.
  - Cross-service: hook events from all services can trigger plugin execution. Plugin responses are advisory (cannot block core workflows).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: installed plugins by tenant, execution rate, execution time distribution, sandbox OOM kills, hook trigger rate.
  - Alert: sandbox OOM/timeout > 5/min = WARN (noisy plugin — consider disabling); plugin execution error rate > 20% = WARN.

- **Common failure modes → action:**
  - *Plugin sandbox timeout* → plugins have a maximum execution time (configurable, default 5s). If a plugin consistently times out, it's doing too much work. Disable it and notify the plugin author. Core platform is never blocked.
  - *Plugin store data corrupted* → the key-value store is per-plugin per-tenant. If data is corrupted, the plugin author must fix their data schema. The platform provides reset capability (clear all store data for a plugin).
  - *Hook not triggering* → verify the hook registration is active (`plugins.hook.registered` event was processed). Hooks are matched by event type — verify the event name matches exactly.
  - *Plugin installation failing* → installation validates the plugin manifest (required fields, version compatibility). If failing, check the manifest format. Marketplace plugins are pre-validated; custom plugins may have manifest issues.
  - *Resource leak from plugin* → sandboxed plugins have memory/CPU caps. If a plugin is leaking within its sandbox, it hits the OOM kill threshold and is terminated. The platform is protected. Disable the plugin if it's consistently OOM-killing.

- **Rollback:** redeploy previous image tag. Plugin state (installed/enabled) persists in DB — rollback doesn't change which plugins are active. To rollback a bad plugin, disable it via the registry.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify plugin registry matches expected state (no plugins accidentally uninstalled); (2) rebuild plugin-config cache in Redis; (3) plugin store data is restored with the DB.
