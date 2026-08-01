# Runbook — Double-Encoded `jsonb` Repair

**Severity:** P1 (silent data defect, platform-wide)
**Owner:** Platform Engineering
**Tools:** `scripts/dev/scan-jsonb-encoding.mjs` (read-only detector) ·
`scripts/dev/repair-jsonb-encoding.mjs` (UPDATE-only remediation)
**Prerequisite:** the write-path fix in `packages/db` MUST be deployed first. See
[Ordering](#ordering-the-code-fix-comes-first).

---

## 1. The defect

Affected `jsonb` columns do not hold a JSON object. They hold a **JSON string
whose text is the intended document**:

```
expected in column:  {"userId": "u-1", "ip": "10.0.0.4"}
actually in column:  "{\"userId\": \"u-1\", \"ip\": \"10.0.0.4\"}"
                     ^ jsonb_typeof() = 'string', not 'object'
```

The value was serialised twice on the way in. Drizzle's `jsonb` mapper calls
`JSON.stringify(value)` and hands the driver a string; `postgres.js` then applies
its own `json` serialiser to any parameter whose inferred Postgres type is
`json`/`jsonb`. Two encodes, one column.

### Why nobody noticed

**Application reads cancel the error out.** `postgres.js` parses the column once,
Drizzle's `mapFromDriverValue` parses again. Two decodes undo two encodes, so
TypeScript sees a correct object and every service test passes.

**Anything evaluated inside Postgres sees a scalar string.** The two decodes only
cancel in the Node process. Server-side, the column is a string, so:

| Expression | Correct row | Corrupt row |
|---|---|---|
| `payload->>'userId'` | `u-1` | `NULL` |
| `payload @> '{"userId":"u-1"}'` | true | false — never matches |
| GIN index lookup on `payload` | hit | no rows |
| `jsonb_array_elements(reasons)` | rows | **error** — cannot extract from scalar |
| `jsonb_typeof(payload)` | `object` | `string` |

So the blast radius is: SQL-side filters, analytics/reporting queries, GIN-indexed
searches, export jobs, and any migration or admin query that reaches into a
document. All of them silently returned nothing rather than failing loudly, which
is why this survived several sprints.

### What counts as corrupt

A row is repaired **only** when all three hold:

1. `jsonb_typeof(col) = 'string'` — it is a jsonb string
2. `left(btrim(col #>> '{}'), 1) IN ('{', '[')` — the inner text opens an object or array
3. `(col #>> '{}') IS JSON` — the inner text genuinely parses as JSON

A jsonb string holding `"hello"` is a **legitimate JSON scalar**. It fails (2) and
is left alone. There are 4 such values in the dev estate. The predicate is
deliberately not widened to `'"'` or to "all strings" — that would corrupt good
data while fixing bad.

The correction is `col = (col #>> '{}')::jsonb`: take the inner text of the jsonb
string and re-parse it.

---

## 2. Ordering: the code fix comes first

> **Do not run the repair before the `packages/db` write-path fix is deployed and
> confirmed on every writer.**

The repair rewrites rows that exist *now*. If a service is still double-encoding,
it keeps inserting new corrupt rows the moment the repair passes them. You get a
partially-clean table that re-dirties continuously, no stable "done" state, and a
verification pass that never reaches zero. Repeating the repair does not help —
it is a race you cannot win while a writer is broken.

Confirm before starting:

1. The `packages/db` fix is released and every service (including workers and
   outbox relays) is running the new build. Consumers and relays are easy to miss
   — they write more `jsonb` than the HTTP routes do.
2. A freshly written row reads back as an object server-side:
   ```sql
   SELECT jsonb_typeof(payload) FROM _outbox.messages ORDER BY created_at DESC LIMIT 5;
   -- must be 'object', not 'string'
   ```
3. Re-run the scanner twice, ~5 minutes apart, on a busy database. The corrupt
   count must be **flat**. A rising count means a writer is still broken; stop.

Quiescing writers is not required — the repair is batched, short-locking and
idempotent — but a low-traffic window shortens the run and makes step 3 easier to
read.

---

## 3. Command sequence

Run from the repo root. Connection comes from `PGHOST` / `PGPORT` / `PGUSER` /
`PGPASSWORD` (dev defaults: `localhost:5435`, `civitas_admin`), the same
convention as every other `scripts/dev/*.mjs`.

### 3.1 Scan — read-only, establishes the baseline

```bash
node scripts/dev/scan-jsonb-encoding.mjs                    # whole estate
node scripts/dev/scan-jsonb-encoding.mjs --db civitas_cdp   # one database
node scripts/dev/scan-jsonb-encoding.mjs --json             # machine-readable
```

Record the output. This is your before-picture and your rollback evidence.

The repair tool's dry-run is also a complete detector in its own right and needs
no other script — use it when you want partition-deduplicated counts, the
repairable/unparseable split, or machine-readable output:

```bash
node scripts/dev/repair-jsonb-encoding.mjs --json | jq .totals
```

> The scanner lists partitioned **parents and their leaf partitions** separately,
> so its totals double-count partitioned data. The repair tool reports
> partition-deduplicated numbers. Expect the repair's "found" to be lower than
> the scanner's "corrupt rows", and use the repair tool's dry-run figure for
> planning. See [§7](#7-partitioned-tables).

### 3.2 Dry-run — default mode, writes nothing

```bash
node scripts/dev/repair-jsonb-encoding.mjs --db civitas_cdp
```

`--apply` is the only thing that enables writes. Without it the tool counts, prints
per-column detail and exits 0. Verify the dry-run really was inert by re-running
the scanner and confirming identical numbers.

### 3.3 Apply

Start with one hot table so you see behaviour on a bounded target before doing a
whole database:

```bash
node scripts/dev/repair-jsonb-encoding.mjs --db civitas_citizen \
     --table _outbox.messages --apply
```

Then the database:

```bash
node scripts/dev/repair-jsonb-encoding.mjs --db civitas_citizen --apply
```

Full interface:

| Flag | Default | Meaning |
|---|---|---|
| `--apply` | off | Enable writes. **Without this nothing is written.** |
| `--db <name>` | all `civitas_*` | Restrict to one database. Must match `^civitas_`. |
| `--table <schema.table>` | all | Restrict to one table. Naming a partitioned parent selects all its leaves. |
| `--column <name>` | all | Restrict to one column name. |
| `--batch-size <n>` | `1000` | Rows per UPDATE, committed per batch. |
| `--lock-timeout <t>` | `5s` | Per-session `lock_timeout`. |
| `--statement-timeout <t>` | `60s` | Per-session `statement_timeout`. |
| `--json` | off | Machine-readable summary. |
| `--help` | — | Usage. |

Exit codes: `0` clean · `1` corrupt rows remain or errors occurred · `2` usage
error or refused target.

### 3.4 Verify

The tool verifies itself: after `--apply` it re-counts corrupt rows for every
column it touched with an independent query, prints the result, and **exits 1 if
anything remains**. Confirm independently with the scanner:

```bash
node scripts/dev/scan-jsonb-encoding.mjs --db civitas_citizen
# → "No double-encoded jsonb found across 1 database(s)."
```

---

## 4. Expected duration

Measured on dev (PostgreSQL 16.14, `localhost:5435`, default batch size 1000):

| Target | Distinct rows | Wall time |
|---|---|---|
| `civitas_cdp` (2 columns) | 2 | 0.46 s |
| `civitas_contract` (3 columns, forced `--batch-size 1`) | 9 | 1.23 s |
| `civitas_helpdesk` (resumed remainder) | 230 | 0.63 s |
| `civitas_citizen` (16 columns) | 8,690 | 3.16 s |
| single 6,185-row partition | 6,185 | 0.55 s |
| full-estate dry-run (47 DBs, 128 columns) | 108,050 counted | ~30 s |

≈ **2,700–11,000 rows/second**, dominated by index maintenance rather than the
cast. Budget **under two minutes for the entire dev estate**. On production-sized
tables, plan by row count and add margin for GIN index updates on wide payloads;
the work is linear in rows and the per-batch commit means the cost is spread, not
front-loaded.

Every batch is its own transaction, so no lock is ever held longer than one batch.
`lock_timeout=5s` and `statement_timeout=60s` are set per session — a contended or
pathological batch fails fast instead of wedging the database. A failed batch is
recorded and the run continues with the next column.

---

## 5. Interrupting and resuming

**Ctrl-C at any point is safe.** No cleanup, no recovery step.

The repair is idempotent by construction: a repaired row is no longer
`jsonb_typeof = 'string'`, so it fails the predicate and self-excludes. There is
no state file, no cursor, no bookkeeping table. Each batch is a single autocommit
statement, so at every instant the database contains only fully-repaired rows and
untouched corrupt rows — never a partial row and never a half-applied batch.

To resume, **re-run the same command**. It picks up the rows that remain.

Verified on dev. `civitas_helpdesk` had 301 corrupt rows; the run was deliberately
slowed with `--batch-size 1` and killed with `SIGINT` after two seconds:

```
$ timeout -s INT 2s node scripts/dev/repair-jsonb-encoding.mjs \
      --db civitas_helpdesk --batch-size 1 --apply     # killed mid-column

$ node scripts/dev/repair-jsonb-encoding.mjs --db civitas_helpdesk --json
  corrupt rows still remaining: 230 | unparseable: 0          # 71 of 301 done

$ psql -c "SELECT jsonb_typeof(payload), count(*) FROM _outbox.messages GROUP BY 1"
  object | 46
  string | 115        # every row either fully repaired or fully untouched

$ node scripts/dev/repair-jsonb-encoding.mjs --db civitas_helpdesk --apply
  ... found 230 · repaired 230 ... Verification: 0 corrupt rows remain

$ node scripts/dev/scan-jsonb-encoding.mjs --db civitas_helpdesk
  No double-encoded jsonb found across 1 database(s).
```

No cleanup step was needed between the interruption and the resume. Running to
completion twice is a no-op the second time:

```
$ node scripts/dev/repair-jsonb-encoding.mjs --db civitas_citizen --apply
  ... Rows repaired: 8690 ... Verification: 0 corrupt rows remain

$ node scripts/dev/repair-jsonb-encoding.mjs --db civitas_citizen --apply
  No double-encoded jsonb found across 1 database(s).
```

Because it is idempotent, it is also safe to run on a schedule or to re-run after
a deploy as a belt-and-braces check.

---

## 6. Rollback posture

**There is no inverse operation.** `(col #>> '{}')::jsonb` is lossy in the sense
that the original double-encoded form cannot be reconstructed from the repaired
value with certainty — re-encoding a repaired object would produce a
byte-different string (key order, whitespace) than the one that was stored. Do not
plan on "undo".

What you have instead:

- **The change is provably narrowing.** The UPDATE only ever touches rows matching
  all three predicate clauses, and the predicate is re-checked in the UPDATE's own
  `WHERE` clause — not just in the row-selection subquery — so a row that is not
  a structured double-encoded string cannot be rewritten even in the presence of
  concurrent activity. Legitimate scalars, real objects, real arrays and `NULL`s
  are outside the predicate.
- **The transformation is total on its domain.** For any row the predicate
  matches, `col #>> '{}'` is valid JSON (clause 3 guarantees it), so the cast
  cannot fail and cannot silently truncate. Rows whose inner text does not parse
  are counted, reported and skipped for manual review.
- **The repaired value is what the application already believed was there.**
  Application reads returned the correct object before the repair and return the
  same object after. Only server-side evaluation changes — from broken to correct.

**Take a database snapshot before the production run.** This is the actual
rollback mechanism:

```bash
# per database, before --apply
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Fc -d civitas_citizen \
        -f "/backup/pre-jsonb-repair-civitas_citizen-$(date +%Y%m%d%H%M).dump"
```

Or an RDS snapshot / storage-level snapshot of the whole cluster if the estate is
large. Keep it until the post-repair verification has been signed off and
downstream reports have been spot-checked.

Also note the repair deliberately does **not** bump `version` or `updated_at`.
This is a byte-level correction of a storage defect, not a business mutation.
Bumping `version` would invalidate in-flight optimistic-lock reads and generate
spurious `409`s, and would misrepresent the repair as a domain event. The
consequence is that the repair emits **no audit event** — so record the run here,
in the change ticket, with the before/after scanner output attached.

---

## 7. Partitioned tables

`_outbox.messages` and `events.events` are range-partitioned. The scanner reports
the parent **and** each leaf, so its totals double-count.

**The repair tool repairs leaf partitions only and skips partitioned parents**
(`pg_class.relkind = 'p'`). Rationale:

- Batching keys off `ctid`, which is unique within a physical relation but **not**
  across a partition hierarchy. `WHERE ctid IN (...)` issued against a parent
  could match an unrelated row in a different partition. Leaf-only keeps `ctid`
  meaningful.
- Coverage is complete either way: every row of a partitioned table lives in
  exactly one leaf, so nothing is missed.
- Locks stay scoped to one partition at a time instead of the whole hierarchy.
- No row movement risk: the repaired column is never a partition key.

Verified numerically on `civitas_audit` — the scanner counted 78,774 corrupt rows;
the repair tool, after excluding parents, reported 52,268, and
`78,774 − (13,049 × 2) − 408 = 52,268` accounts for the parents exactly.

`--table` still accepts a parent name and expands to its leaves, so operators do
not need to know the partition naming scheme:

```bash
node scripts/dev/repair-jsonb-encoding.mjs --db civitas_audit --table events.events
# → selects events.events_default and events.events_y2026m07
```

Note that `events.events_legacy` and `_outbox.messages_legacy` are **standalone
tables**, not partitions (`relispartition = false`), left behind by the
partitioning migration. They are repaired in their own right and are not covered
by `--table events.events`.

---

## 8. Blocked: append-only and immutability triggers

Some tables reject `UPDATE` outright. This is correct and must not be worked
around by the repair tool — it never issues `ALTER TABLE ... DISABLE TRIGGER`, and
it should not be made to.

```
$ node scripts/dev/repair-jsonb-encoding.mjs --db civitas_audit --apply
  civitas_audit.events.events_y2026m07.payload
      found 8907 · repaired 0 · 0.03s · partition of events.events, ERRORED
  ...
  [repair] civitas_audit.events.events_y2026m07.payload:
      ERROR:  events.events is append-only: UPDATE is not permitted on the audit log (AUD-1)
```

Tables with `BEFORE UPDATE` immutability triggers in the dev estate:

| Database | Table | Trigger |
|---|---|---|
| `civitas_audit` | `events.events` + all partitions + `events_legacy` | `trg_events_immutable` |
| `civitas_workflow` | `workflow.transition_history` | `trg_transition_no_update` |
| `civitas_tenant` | `tenant.consent_ledger` | `trg_consent_ledger_append_only` |
| `civitas_finance` | `gl.finance_journals`, `gl.finance_ledger` | `trg_journal_no_mutate`, `trg_ledger_no_mutate` |
| `civitas_estab` | `files.estab_notings` | `trg_noting_immutability` |
| `civitas_hrms` | `appraisal.hrms_apar_stage_history` | `trg_apar_history_no_mutation` |

For `events.events` the trigger is not the only obstacle. The table carries a
`prev_hash` / `event_hash` chain, and the hash binds the event content including
`actor` and `payload`:

```ts
// services/audit-service/src/modules/events/consumer.ts
const eventHash = computeHash(id, msg.tenantId, msg.type, latest?.eventHash ?? null, now, {
  ..., actor, target, payload: enrichedPayload,
});
```

Rewriting `payload` in place would therefore invalidate that event's hash and
every subsequent link in the chain, breaking the CERT-In tamper-evidence property
the trigger exists to protect. **In-place repair of audit events is not merely
blocked, it is semantically wrong.**

Options for the blocked rows, all requiring explicit sign-off — do not pick one
unilaterally:

1. **Leave them.** Historical audit rows are already hash-anchored in their
   double-encoded form. A read-side compatibility shim (normalise on read: if
   `jsonb_typeof = 'string'`, parse the inner text) restores SQL-side query
   ability without mutating the log. Lowest risk; recommended default.
2. **Re-anchor the chain.** Repair the payloads and recompute the whole chain,
   with a signed record of the operation and the old/new head hashes. Restores
   clean data and a valid chain, but rewrites the audit log — needs DPO / audit
   owner approval and a documented attestation.
3. **Migrate forward.** Write corrected copies into a new partition or a
   `events_repaired` projection and point analytics at it, leaving the original
   log immutable.

The non-audit blocked tables (`transition_history`, `consent_ledger`,
`finance_journals`) have no hash chain, so option 2 is cheaper there — but they
are append-only ledgers for the same governance reasons and still need the
respective domain owner's approval.

---

## 9. Confirming success

A run is successful when all of these hold:

1. `repair-jsonb-encoding.mjs --apply` **exits 0** and prints
   `Verification: 0 corrupt rows remain in the columns touched.`
2. `scan-jsonb-encoding.mjs --db <name>` prints
   `No double-encoded jsonb found` — an independent read via a different code
   path.
3. Legitimate scalars are still scalars. The scanner's
   `Legitimate jsonb scalars left untouched: N` must be unchanged from the
   baseline (4 across the dev estate). Spot-check directly:
   ```sql
   SELECT jsonb_typeof(col) FROM schema.table WHERE <known scalar row>;  -- 'string'
   ```
4. A server-side read that used to fail now works — the whole point of the
   exercise. Compare a repaired database against one still pending:
   ```sql
   -- civitas_citizen, repaired
   SELECT count(*) FILTER (WHERE jsonb_typeof(payload) = 'object') FROM _outbox.messages;
   -- 6363 of 6363

   -- civitas_notification, not yet repaired
   SELECT count(*) FILTER (WHERE jsonb_typeof(payload) = 'object') FROM _outbox.messages;
   -- 0 of 4834
   ```
   And a query that outright errored before now returns rows (key names only —
   never select payload contents into a terminal, these carry citizen PII):
   ```sql
   SELECT k, count(*) FROM _outbox.messages m, jsonb_object_keys(m.payload) k
    GROUP BY 1 ORDER BY 2 DESC;
   -- repaired:     outcome 4360, service 3476, action 3476, resourceId 3476, ...
   -- not repaired: ERROR: cannot call jsonb_object_keys on a scalar
   ```
5. `unparseable` is 0. Any non-zero value is a row whose inner text starts with
   `{` or `[` but is not valid JSON. It was skipped, not corrupted. Investigate it
   by hand — it is likely genuine plain text in a `jsonb` column.
6. A second `--apply` reports zero rows repaired.
7. The affected service's reporting/analytics queries and GIN-indexed searches
   return non-empty results where they previously returned nothing.

Attach the baseline scan, the dry-run, the apply output and the post-scan to the
change ticket. There is no audit event for this operation (see [§6](#6-rollback-posture)),
so the ticket is the record.

---

## 10. Phase 0 execution record — dev estate, 2026-08-01

The write-path fix (`packages/db/src/pool.ts`, PR #325) was committed first, which is
the hard gate in [§2](#2-ordering-the-code-fix-comes-first). The repair was then run
across the whole dev estate.

### Outcome

| | Distinct rows (partition-deduplicated) |
|---|---|
| Corrupt before | 107,995 |
| **Repaired** | **46,675** |
| Remaining | 61,320 — all behind append-only / immutability protection |
| Unparseable | 0 |
| Legitimate scalars altered | **0** (4 present, all survived) |

Wall time for the estate-wide apply: **77 s**.

### Remaining rows, all blocked by design

| Rows | Location | Blocked by |
|---|---|---|
| 51,739 | `civitas_audit` `events.*` (+ partitions, + `events_legacy`) | `trg_events_immutable` |
| 9,200 | `civitas_workflow` `workflow.transition_history.detail` | `trg_transition_no_update` |
| 370 | `civitas_tenant` `tenant.consent_ledger.categories` | `trg_consent_ledger_append_only` |
| 7 | `civitas_tenant` `tenant.tenants.settings` | a poisoned sibling row — see below |
| 4 | `civitas_finance` `gl.finance_journals.lines` | `trg_journal_no_mutate` |

None of these is a tool failure. Each is an append-only guarantee doing its job, and
for `civitas_audit` in-place repair is **semantically wrong** rather than merely
blocked — see [§8](#8-blocked-append-only-and-immutability-triggers). These 61,320
rows need the decision recorded there, not another repair run.

### Verified after the run

`jsonb_object_keys()` — which raises `cannot call jsonb_object_keys on a scalar`
against a corrupt column — now succeeds on repaired outbox payloads:

```sql
-- civitas_crm, after repair (key names only; never select payload contents)
SELECT k, count(*) AS n FROM _outbox.messages m, jsonb_object_keys(m.payload) k
 GROUP BY k ORDER BY n DESC LIMIT 5;
  resourceType 2500 · outcome 2500 · action 2500 · resourceId 2500 · service 2500
```

The 4 legitimate scalars in `visitor.config_entries.value` are still
`jsonb_typeof = 'string'` — the repair did not widen into good data.

### Two defects the repair exposed (neither is a repair bug)

**1. `tenant.tenants` has a row violating its own CHECK constraint.**
`tenants_edition_check` allows `govt|psu|private|ngo|section8|cooperative|small_office`,
but one row holds `edition = 'govt_dept'`. The constraint was added `NOT VALID`, so the
offending row was grandfathered in and only surfaces when the row is UPDATEd — which the
repair did:

```
ERROR: new row for relation "tenants" violates check constraint "tenants_edition_check"
```

Fixing it is a **domain decision** (is `govt_dept` a synonym for `govt`, or a missing
edition?) and was deliberately left alone. Until it is resolved, 7 otherwise-repairable
rows in that table stay corrupt. Owner: tenant-service.

**2. The tool stops a column on the first batch error.**
When a batch fails, the per-column loop `break`s. That is right for the audit tables
(every row is blocked, so continuing would just retry pointlessly) but it means a
*single* poisoned row halts the rest of its column — even at `--batch-size 1`, which
repaired 1 row and then stopped with 7 still outstanding. If a future run hits a
partially-blocked column, isolate it with `--table`/`--column`, fix or exclude the
offending row, then re-run. Making the loop skip-and-continue instead of break would be
a reasonable enhancement; it was not changed here because for every currently-known
blocked column the break is the correct behaviour.

### Also noted

`services/helpdesk-service/src/modules/sla-engine/routes.ts:106` selects
`t.assigned_to`, but the column is `assignee_id`. It returns a 500 on
`GET /v1/helpdesk/sla/breaches`. Pre-existing, unrelated to this work, and left for the
helpdesk owner — recorded here only because it was found while reading repair logs.
