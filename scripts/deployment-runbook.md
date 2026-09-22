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
file fresh — and that file's module-level `requireSecret("INTERNAL_SERVICE_SECRET")`
(and `DEVICE_TRUST_SECRET`) throws unless those are exported in the invoking
shell (confirmed live: with them unset, `pm2 start ecosystem.config.js`
failed outright with `[PM2][ERROR] File ecosystem.config.js malformated` —
starting or restarting *nothing at all*, not even the apps that were already
running). Neither is normally present in a plain interactive shell on this
host (no `.bashrc`/`.bash_profile`/`.profile` exports them, and the pm2
systemd unit's own `Environment=` lines don't either) — they're meant to be
pulled from the secret manager per-session (see
`docs/runbooks/launch-undeployed-services.md` step 3), not persisted on disk.

So the two commands below are kept **both**, in this order, rather than
replacing one with the other: `pm2 restart all` first, with no precondition,
exactly as today — every already-known app gets the new build regardless of
whether secrets are exported. `pm2 start ecosystem.config.js` second,
reconciling in anything still missing — if the secrets aren't exported this
step fails loudly and specifically (the error above names exactly what's
missing) without undoing the restart that already succeeded. Export
`INTERNAL_SERVICE_SECRET` / `DEVICE_TRUST_SECRET` (and any newly-declared
service's own secret) into the shell before deploying if reconciliation needs
to actually succeed, not just fail informatively. The cost of running both is
a second, redundant hard-restart of the already-known apps a few seconds
after the first (harmless, since a deploy's restart is already accepted as a
brief full-fleet outage) in exchange for the reconciliation half degrading to
a loud, actionable error instead of an outright failure when secrets are
absent.

```bash
cd ~/CivitasOne/civitasone-suite
git pull
pnpm build
pm2 restart all                  # refresh every already-known app — unconditional, no precondition
pm2 start ecosystem.config.js    # + reconcile anything ecosystem.config.js declares that PM2 doesn't know
                                  #   about yet — needs INTERNAL_SERVICE_SECRET/DEVICE_TRUST_SECRET exported
                                  #   first, or fails loudly here without undoing the restart above
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
