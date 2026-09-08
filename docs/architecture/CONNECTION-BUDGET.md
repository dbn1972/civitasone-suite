# Database Connection Budget

**Status: PERF-001 (2026-09-08).** This doc previously described the "C2" fix from an
earlier, much smaller fleet (33 services). That fix's `ecosystem.config.js` wiring
regressed at some point as the fleet grew to 65 DB-backed services / 132 PM2
processes, and — worse — the container actually running as `civitasone-pgbouncer`
would have rejected every real service connection even if the wiring hadn't
regressed, for two separate reasons neither the original fix nor anything since
ever caught (see §3). This revision fixes the wiring, fixes both container-level
bugs, derives every number below from `ecosystem.config.js` itself instead of a
hand-maintained literal (§5 — this is the actual root-cause fix), and records how
it was verified (§6).

## 1. Problem

`ecosystem.config.js` defines the fleet mostly as `svc()` + `worker()` factory
calls, plus a small number of hand-written object-literal entries (`gateway`,
`web`, `queue`). Neither factory
function set `DB_VIA_PGBOUNCER` or `DB_POOL_MAX`, and `packages/db/src/pool.ts`
defaults each process's own connection pool to **max 10** direct connections.
Additionally, 19 services open a **second** "scanner" pool per process — a
BYPASSRLS role used by outbox-relay/purge maintenance loops that must scan
*across* tenants (see `services/*/src/shared/scanner-db.ts`; the BYPASSRLS
requirement is documented in each one, e.g. `finance-service`'s: FORCE ROW LEVEL
SECURITY on `_outbox.messages` means the ordinary tenant-scoped role sees zero
rows on a cross-tenant scan, so the maintenance loop silently no-ops without it).

Worst case, fully direct: **130 DB-backed processes × 10 + 19 scanner pools × 10
≈ 1,490 connections**, against `infra/postgres/postgresql.conf`'s
`max_connections = 200`. On the live EC2 host, 11/11 currently-running processes
connect **directly** to Postgres — PgBouncer was "running" (visible in `docker
ps`) but not used by the application at all, and, as detailed in §3, would not
actually have worked if it had been used.

## 2. Fleet shape (derived, not hand-counted)

`scripts/ops/lib/fleet-topology.mjs` derives these numbers **live from
`ecosystem.config.js`** every time it's imported — by the connection-budget test,
by `scripts/ops/verify-pgbouncer-routing.mjs`, and by this doc's author, right
now:

| Quantity | Value (2026-09-08) |
|---|---|
| Total PM2 processes | 132 |
| DB-backed processes | 130 |
| Distinct services (svc+worker share one (dbUser,dbName) pool) | 65 |
| Distinct (dbUser,dbName) "main" pools | 65 |
| Scanner (BYPASSRLS) pools actually wired today | 11 |
| Scanner pools that *could* exist once all `scanner-db.ts` modules get a distinct `*_SCANNER_DATABASE_URL` (a separate, pre-existing gap — see §7) | 19 |
| **Total distinct PgBouncer pools today** | **76** (65 + 11) |
| **Total distinct PgBouncer pools, forward-looking** | **84** (65 + 19) |

Run it yourself: `node -e 'process.env.NODE_ENV="test"; import("./scripts/ops/lib/fleet-topology.mjs").then(m=>console.log(m.loadFleetTopology()))'`

## 3. Two bugs that made PgBouncer non-functional, independent of the wiring gap

Both were found by trying to actually route a real connection through PgBouncer
end-to-end during this fix, not by static reading — `docker ps` showing the
container healthy proved nothing about whether it could serve traffic.

### 3a. Single-database config instead of a wildcard

`infra/docker-compose.yml`'s `pgbouncer` service was driven by
`DATABASE_URL: postgres://civitas_admin:...@civitasone-postgres:5432/postgres`.
The `edoburu/pgbouncer` image's entrypoint parses that URL and writes an
auto-generated `pgbouncer.ini` with `[databases] postgres = host=... port=...`
— an **explicit, single-database entry**, not the wildcard
`infra/pgbouncer/pgbouncer.ini`'s own `* = host=... port=...` implies. Any
client requesting `civitas_finance`, `civitas_hrms`, or any other real service
database would have gotten "database ... is not configured" — reachable to
literally none of the 65 real databases. Fixed by switching the container's
config to `DB_HOST`/`DB_PORT` (not `DATABASE_URL`), which leaves the entrypoint's
`DB_NAME` unset and defaults it to the wildcard.

### 3b. `auth_type = trust` cannot authenticate to this Postgres at all

`civitasone-postgres`'s `pg_hba.conf` has `host all all all scram-sha-256` —
**every** non-local (i.e. every container-to-container) connection requires a
real password. `AUTH_TYPE: trust` tells PgBouncer not to *check* the client's
password, but PgBouncer still needs *some* credential to present when it opens
the actual server-side connection to Postgres, and trust mode gives it none.
Empirically: every server-side login failed with
`password authentication failed`, regardless of which role PgBouncer tried.

Fix: `AUTH_TYPE: scram-sha-256` + `AUTH_USER`/`AUTH_QUERY`
(`SELECT rolname, rolpassword FROM pg_authid WHERE rolname=$1`, run as
`civitas_admin`). This is the standard PgBouncer pattern for a fleet with many
distinct login roles: PgBouncer holds **one** bootstrap credential
(`civitas_admin`'s — already required elsewhere in `infra/docker-compose.yml`
via `POSTGRES_ADMIN_PASSWORD`) and fetches every *other* connecting role's real
SCRAM secret from `pg_authid` on demand, authenticating the client **and** the
matching server-side connection as that same real role. This scales to all 65+
roles without a hand-maintained `userlist.txt` (exactly the kind of
hand-maintained list that let PERF-001 regress once already — see §5) and
without re-provisioning PgBouncer when a new service/role is added.

Verified end-to-end on an isolated PgBouncer instance (not the shared
`civitasone-pgbouncer`): `finance_svc`/`hrms_svc`/`identity_svc` each
authenticated as themselves and reached their own database
(`current_user`/`current_database()` both correct per role) — not as
`civitas_admin`, not as a shared/forced role. See §6.

## 4. The fix

1. **`ecosystem.config.js`**: `DB_HOST` now points at PgBouncer (`:6432`,
   was `:5435` direct Postgres). Both `svc()` and `worker()` spread a shared
   `PGBOUNCER_ENV = { DB_VIA_PGBOUNCER: "true", DB_POOL_MAX: "5" }` into every
   DB-backed process's env. The one hand-written entry that bypassed the
   factory functions (`gateway`) needed the same fix applied by hand — found by
   the wiring-guard test in `tests/security/connection-budget.test.ts`, which
   walks every app with a `DATABASE_URL`, not just apps built via `svc()`/`worker()`.
2. **`infra/docker-compose.yml`**'s `pgbouncer` service: wildcard routing (§3a)
   + working auth (§3b) + sized for the real fleet (§5 below).
3. **`infra/pgbouncer/pgbouncer.ini`** (the reference config for a standalone/
   bare-metal deployment — not what the Docker Compose container actually runs
   on, see its own header comment): same `auth_user`/`auth_query` fix, same
   sizing, numerically kept in sync with docker-compose.yml.
4. **`infra/onprem/helm/civitasone/values.yaml`**: `maxClientConn`/
   `defaultPoolSize` sizing only — see §7's PERF-012 for a *separate*,
   pre-existing bug in that deployment path this fix does not touch.
5. **`packages/db/src/pool.ts`**: unchanged — it already had
   `DB_VIA_PGBOUNCER`-aware `prepare: false` and a reduced default `max: 5`
   before this fix. The gap was entirely that nothing ever set the env var
   that turns this on.

## 5. Sizing

**`DB_POOL_MAX=5`** per process (client-side, to PgBouncer) — matches
`pool.ts`'s own default for the `viaBouncer` branch; set explicitly rather
than relying on the fallback so it's visible and independently tunable.

**`MAX_CLIENT_CONN=1000`** — (130 DB-backed processes + up to 19 scanner pools)
× 5 = 745 worst case; 1000 leaves ~25% headroom.

**`DEFAULT_POOL_SIZE=2`** (real backend connections to Postgres, per PgBouncer
pool) — deliberately flat and conservative, not per-database-tuned: there is
no production `pg_stat_activity`/`pg_stat_statements` telemetry yet to tune
against (that's PERF-010, already tracked). 84 pools (the forward-looking
figure, once all 19 scanner DSNs are wired — see §2) × 2 = **168 real backend
connections**, vs. `max_connections=200` — **32 headroom** for Postgres's own
`superuser_reserved_connections`, direct `psql`/admin sessions, and one-off
migration/seed scripts that connect directly with a dedicated `max:1` client
(e.g. `services/install-service/src/modules/provisioning/scheduler.ts`,
`services/procurement-service/scripts/migrate-encrypt-pii.ts`) rather than
through PgBouncer. At today's 76 wired pools the real number is smaller (152,
48 headroom) — 168/32 is the number to hold this config to as more scanner DSNs
get wired.

**`MIN_POOL_SIZE=1`**, **`RESERVE_POOL_SIZE=1`** — kept small on purpose. The
*nominal* budget above (default_pool_size only) is what's relevant to the
"full fleet boots" DoD. Naively summing `(default_pool_size + reserve_pool_size)
× 84 pools = 252` **would** exceed `max_connections` if every single database's
reserve activated *simultaneously* — but that requires 65+ independent domains
(finance, parks, animal control, telephony, ...) to all spike at once, which
isn't a realistic correlated event for this fleet. This is a genuine residual
risk, not a false one: it should be covered by **alerting on
`pg_stat_activity` approaching, say, 180** (not asserted here — no monitoring
stack wiring is in scope for PERF-001), not by a claim that it's
mathematically impossible.

**Constraint the whole config satisfies:**
```
(DB-backed processes + scanner pools) × DB_POOL_MAX  ≤  PgBouncer max_client_conn
distinct PgBouncer pools × default_pool_size          ≤  Postgres max_connections, with headroom
```

## 6. Pool mode decision: transaction (not session)

**Session mode** would not fix PERF-001 at all — each client would still hold a
real backend connection for its whole session, giving no multiplexing and no
reduction in worst-case connections; it was never a serious option once the
actual problem (connection *count*, not connection *lifetime*) was understood.

**Transaction mode** is what actually multiplexes many client connections onto
few backend connections, but is only safe if nothing relies on session-scoped
Postgres state surviving across statements outside a single transaction.
Investigated *before* committing to it (per the gap's own instructions):

- **Tenant GUC**: every tenant-scoping call site in the fleet
  (`packages/db/src/wrap-tenant-db.ts`, `tenant-db.ts`, `raw-tenant-guc.ts`,
  `tenant-scope.ts`, and every service-level `repo.ts`/`routes.ts` found via a
  fleet-wide grep for `set_config`/`SET LOCAL`) sets `app.tenant_id` via
  `set_config('app.tenant_id', $1, true)` — the `true` third argument is
  `SET LOCAL` semantics, self-resetting at `COMMIT`/`ROLLBACK` — and does so as
  the **first statement inside a real transaction**
  (`db.transaction()`/`sqlClient.begin()`), never as a bare statement. Zero
  exceptions found in production code (one test fixture uses non-local
  `set_config(...,false)`, but on its own dedicated `max:1` connection,
  outside the pooled path entirely).
- **Advisory locks**: every use in the fleet is `pg_advisory_XACT_lock`
  (transaction-scoped, auto-releases at commit/rollback) — none use the
  session-scoped `pg_advisory_lock`.
- **`LISTEN`/`NOTIFY`, temp tables**: none found anywhere in `services/`/`packages/`.
- **Prepared statements**: `packages/db/src/pool.ts` already sets
  `prepare: false` whenever `DB_VIA_PGBOUNCER` is set — this was already
  correct before PERF-001, just never activated.

**Conclusion**: this codebase's tenant-isolation pattern is exactly the shape
transaction-mode pooling is safe for. Session mode was never necessary, and
would not have solved PERF-001 even if it had been chosen.

## 7. Related, deliberately NOT fixed here

- **PERF-012** (filed alongside this fix): `infra/onprem/helm/civitasone/
  templates/pgbouncer.yaml`'s pgbouncer container sets `DATABASE_HOST`/
  `DATABASE_PORT`/`DATABASE_USER`/`DATABASE_PASSWORD`, but the
  `edoburu/pgbouncer` entrypoint only recognizes `DB_HOST`/`DB_PORT`/
  `DB_USER`/`DB_PASSWORD` (or `DATABASE_URL`) — none of those names match, so
  the container fails its own `${DB_HOST:?...}` startup check. This is the
  on-prem/Kubernetes deployment path, not the EC2 PM2 fleet PERF-001 fixes,
  and needs its own investigation (that chart also uses a single shared
  `civitasone` DB role fleet-wide, a materially different auth model than the
  per-service-role EC2 fleet — not a one-line rename).
- **8 of 19 scanner-role DSNs** — `admin`, `asset`, `helpdesk`, `identity`,
  `meeting`, `notification`, `project`, `report` each have a
  `src/shared/scanner-db.ts` module but no matching `*_SCANNER_DATABASE_URL`
  entry in `ecosystem.config.js` (the other 11 — `finance`, `procurement`,
  `workflow`, `payroll`, `crm`, `contract`, `journey`, `court`, `visitor`,
  `works`, `inspection` — are wired). Those 8 fall back to reusing the
  service's own `DATABASE_URL`, meaning their "second pool" doesn't actually
  authenticate as a distinct BYPASSRLS role today — a pre-existing gap this
  fix doesn't widen or narrow, tracked as part of the TX/SEC deadlock-scanner
  work referenced in the gap report, not re-litigated here.
- **Per-database `pool_size` tuning**: §5's `DEFAULT_POOL_SIZE=2` is flat
  across all 65+ databases on purpose — no real traffic telemetry exists yet
  to justify giving `finance`/`hrms`/`identity` a larger override than
  `animal`/`parks`/`telephony`. PERF-010 (load testing, `pg_stat_statements`)
  is the natural prerequisite for that follow-up.

## 8. Verification performed (see PR for full detail)

Not run: the full 129+ process fleet on the shared EC2 host (explicitly
avoided — other agents are running parallel gap fixes on this host right now).
Instead, verified against an isolated PgBouncer instance (`perf001-pgbouncer`,
a separate container/port, torn down after), pointed at the same shared
Postgres:

1. **Wildcard routing**: `finance_svc`→`civitas_finance`, `hrms_svc`→
   `civitas_hrms`, `identity_svc`→`civitas_identity` each connected and
   landed on their own database as their own role.
2. **Tenant isolation under transaction pooling** (`tests/integration/
   perf-001-pgbouncer-pooling.test.ts`): 30 concurrent "tenant requests"
   (real `FORCE ROW LEVEL SECURITY` table, real `set_config(...,true)`
   pattern) through a 5-connection client pool against a 2-connection
   PgBouncer backend pool — no tenant ever observed another tenant's row, and
   every tenant saw its own. Sabotage-checked: the same load pattern using a
   session-level `SET` issued outside a transaction (the anti-pattern this
   codebase's own `raw-tenant-guc.ts` comment warns against) reliably broke —
   every request either errored (RLS-policy cast failure, because the GUC
   never reliably reached the backend the next statement landed on) or, given
   different timing, could instead leak a row onto a reused connection; both
   are exactly what this test's assertions exist to catch.
3. **Connection count under load**: sampled `pg_stat_activity` during the same
   concurrent load — stayed within a small explicit ceiling, corroborating §5's
   static arithmetic for one pool against a live PgBouncer + Postgres.
4. **Static config**: `tests/security/connection-budget.test.ts`,
   `tests/ops/verify-pgbouncer-routing.test.ts`, `tests/infra/
   helm-pgbouncer.test.ts` all pass — including new assertions that would fail
   if the wiring, the wildcard fix, or the auth fix regressed again.
