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

```bash
bash ~/CivitasOne/civitasone-suite/scripts/rollback.sh
```
