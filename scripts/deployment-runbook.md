# CivitasOne Deployment Runbook

## Pre-deploy snapshot

```bash
tar -czf ~/civitas-backups/civitas-snapshot-$(date +%Y%m%d-%H%M%S).tgz \
  --exclude=node_modules --exclude=.next \
  -C ~/CivitasOne civitasone-suite
```

## Deploy

`pm2 restart all` only restarts processes PM2 **already knows about** — it
does not start anything newly declared in `ecosystem.config.js` that isn't
already a running PM2 process. Measured 2026-09-22: 100 of 132 declared apps
were not running on this host despite having no structural blocker, and
`pm2 restart all` would have restarted the other 32 while never noticing the
100 were missing — no error, no signal, nothing in the deploy output to catch.

Verified live on this host (isolated dummy-app testing, then confirmed
against the real `ecosystem.config.js`): `pm2 start ecosystem.config.js`
safely reconciles the fleet in one command — run with some apps already known
to PM2 and some not, it restarts every already-known app in place (same PM2
id, no duplication) **and** starts every not-yet-known one fresh, exit 0. It
does *not* "leave healthy apps alone" — every app it touches gets a hard
stop-then-start, known or not — but that's not a new risk: `pm2 restart all`
already did a hard stop-then-start of every known app on every deploy (see
the release-engineering notes on `pm2 restart all` having no
`wait_ready`/graceful cutover), so this has the identical restart profile for
already-known apps, plus it additionally reconciles anything missing.

**But it is not a drop-in replacement for `pm2 restart all` — it has a real
precondition `pm2 restart all` does not.** `pm2 restart <name|all>` (no file
argument) restarts using PM2's already-resolved, already-running process
definitions and never re-reads `ecosystem.config.js`. `pm2 start
ecosystem.config.js` (with or without `--only`) always re-`require()`s the
file fresh — and every module-level secret in that file throws unless it's
exported in the invoking shell (confirmed live: with none of them set, `pm2
start ecosystem.config.js` failed outright with `[PM2][ERROR] File
ecosystem.config.js malformated` — starting or restarting *nothing at all*,
not even the apps that were already running). None of them are normally
present in a plain interactive shell on this host (no
`.bashrc`/`.bash_profile`/`.profile` exports any of them, and the pm2 systemd
unit's own `Environment=` lines don't either) — they're meant to be pulled
from the secret manager per-session, not persisted on disk. **The full list
is longer than it looks at first — see the verified chain a few paragraphs
below before assuming two exports are enough.**

So the two commands below are kept **both**, in this order, rather than
replacing one with the other: `pm2 restart all` first, with no precondition,
exactly as today — every already-known app gets the new build regardless of
whether secrets are exported. `pm2 start ecosystem.config.js` second,
reconciling in anything still missing — if the secrets aren't exported this
step fails loudly and specifically (the error above names exactly what's
missing) without undoing the restart that already succeeded. The cost of
running both is a second, redundant hard-restart of the already-known apps a
few seconds after the first (harmless, since a deploy's restart is already
accepted as a brief full-fleet outage) in exchange for the reconciliation
half degrading to a loud, actionable error instead of an outright failure
when secrets are absent.

Every module-level secret in `ecosystem.config.js` is evaluated
unconditionally, top to bottom, on every `require()` of the file — `--only`
scoping doesn't skip this, since it only affects which apps PM2 *acts on*
after the whole file has already finished evaluating. Here is the actual
chain, found the same safe way: a read-only probe (never `pm2 start`, never
touches a real daemon — just Node evaluating the module, exactly like
`scripts/ops/lib/fleet-topology.mjs` already does for its own introspection)
that supplies whatever each thrown error names and re-runs until it stops
throwing.

```bash
cd ~/CivitasOne/civitasone-suite
node -e "require('./ecosystem.config.js')"   # throws "[ecosystem] <NAME> ..."
                                              # naming exactly what's still
                                              # missing. Export that var
                                              # (any non-empty value proves
                                              # the point; real deploys need
                                              # the real one) and re-run to
                                              # find the next.
```

Walked to actual success on this host today, in the order the file evaluates
them — 10 named secrets, then the DB tier, then 11 named scanner DSNs with no
blanket fallback:

```
INTERNAL_SERVICE_SECRET, DEVICE_TRUST_SECRET, VISITOR_TENANT_SIGNING_KEY_PEM,
ID_CARD_QR_SECRET, CANDIDATE_JWT_SECRET, COURT_PII_KEY, MEETING_PII_KEY,
VISITOR_PII_KEY, PROCUREMENT_PII_KEY, FINANCE_PII_KEY,

DATABASE_URL   # one blanket value satisfies every service's dbUrl() call —
               # no need to set 29+ individual DATABASE_URL_<SVC> vars unless
               # different services must route to different roles/databases

FINANCE_SCANNER_DATABASE_URL, PROCUREMENT_SCANNER_DATABASE_URL,
WORKFLOW_SCANNER_DATABASE_URL, PAYROLL_SCANNER_DATABASE_URL,
CRM_SCANNER_DATABASE_URL, CONTRACT_SCANNER_DATABASE_URL,
JOURNEY_SCANNER_DATABASE_URL, COURT_SCANNER_DATABASE_URL,
VISITOR_SCANNER_DATABASE_URL, WORKS_SCANNER_DATABASE_URL,
INSPECTION_SCANNER_DATABASE_URL
  # each scannerDbUrl() call needs its OWN named var — unlike dbUrl(),
  # it has no blanket-DATABASE_URL-style fallback.
```

**Asymmetry worth knowing about**, so the chain above isn't confusing: four
more — `PII_ENC_KEY` (hrms), `MFA_ENC_KEY` (identity), `CITIZEN_PII_KEY`,
`CRM_PII_KEY` — never appear in it, not because they're optional but because
`~/.civitasone-{hrms,identity-mfa,citizen,crm}-*-key` already exist on *this*
host (provisioned since June) and each one's resolver checks that file
before ever reaching the env-var throw. `COURT_PII_KEY` / `MEETING_PII_KEY` /
`VISITOR_PII_KEY` / `PROCUREMENT_PII_KEY` / `FINANCE_PII_KEY` have no such
file here yet, so they still throw. A host with different key-file
provisioning walks a different chain.

This list is a **verified snapshot, not a contract** — the same anti-pattern
this campaign keeps fixing elsewhere (PERF-001, `fleet-topology.mjs`) applies
to hand-copying it too: it will silently go stale the next time a service
gains its own required secret. Re-run the probe above rather than trusting
this list if it's been a while or `ecosystem.config.js` has changed.
`docs/runbooks/launch-undeployed-services.md` step 3 documents pulling
`INTERNAL_SERVICE_SECRET` / `DEVICE_TRUST_SECRET` / `COURT_PII_KEY` /
`MEETING_PII_KEY` / `VISITOR_PII_KEY` from the secret manager, but for a
narrower purpose (launching those specific services) — useful for those
five, but not a complete list for full reconciliation: `--only` scoping
still evaluates the whole file first, so it doesn't cover
`VISITOR_TENANT_SIGNING_KEY_PEM`, `ID_CARD_QR_SECRET`, `CANDIDATE_JWT_SECRET`,
`PROCUREMENT_PII_KEY`, `FINANCE_PII_KEY`, `DATABASE_URL`, or any of the 11
scanner vars either.

```bash
cd ~/CivitasOne/civitasone-suite
git pull
pnpm build
pm2 restart all                  # refresh every already-known app — unconditional, no precondition
pm2 start ecosystem.config.js    # + reconcile anything ecosystem.config.js declares that PM2 doesn't know
                                  #   about yet — re-requires the whole file, so needs its full secret
                                  #   chain exported first (see above — it's longer than two vars), or
                                  #   fails loudly here without undoing the restart above
pm2 save
```

## Verify

`pm2 list | grep online | wc -l` against a hardcoded `51+` drifted silently
out of sync with the fleet (132 apps declared in `ecosystem.config.js` today,
not 51 — see `scripts/ops/pm2-systemd-repair.md`'s 09-T3 finding, written
when 51 was still roughly right). `scripts/ops/verify-fleet-reconciled.mjs`
replaces the hardcoded count the same way `scripts/ops/lib/fleet-topology.mjs`
already keeps the connection-budget checks in sync with the fleet (PERF-001):
it re-derives the full expected app list LIVE from `ecosystem.config.js` on
every run and fails loudly, by name, if anything declared is missing from PM2
entirely or present but not `online` — instead of requiring a human to compare
a printed number against a comment that can go stale.

```bash
node scripts/ops/verify-fleet-reconciled.mjs   # fails loudly + by name if any
                                                # declared app is missing/down
systemctl status pm2-ec2-user    # expect active (running)
curl -s http://localhost:8080/health
```

## Rollback

Application/process rollback (pm2 reload to the last snapshot; does not
touch any database):

```bash
bash ~/CivitasOne/civitasone-suite/scripts/rollback.sh
```

## Migration rollback (REL-020)

To undo one service's most recently applied *database* migration (a
separate concern from the application rollback above — that script never
touches schema), see `scripts/ops/MIGRATION-ROLLBACK.md` and run:

```bash
scripts/ops/migrate-rollback.sh --service <name> --list      # see rollback coverage first
scripts/ops/migrate-rollback.sh --service <name> --dry-run   # review before touching anything
scripts/ops/migrate-rollback.sh --service <name>              # interactive confirm, then applies
```

Only services with an authored `migrations/down/` file can be rolled back
this way today (`vendor-service`, `animal-service`, `identity-service` as of
REL-020 — see that doc to extend to more). For anything else, restore from
`scripts/ops/backup-databases.sh` / `restore-drill.sh` instead.
