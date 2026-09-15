# CivitasOne Deployment Runbook

## Pre-deploy snapshot

```bash
tar -czf ~/civitas-backups/civitas-snapshot-$(date +%Y%m%d-%H%M%S).tgz \
  --exclude=node_modules --exclude=.next \
  -C ~/CivitasOne civitasone-suite
```

## Deploy

```bash
cd ~/CivitasOne/civitasone-suite
git pull
pnpm build
pm2 restart all
pm2 save
```

## Verify

```bash
pm2 list | grep online | wc -l   # expect 51+
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
