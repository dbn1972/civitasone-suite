# 09-T3 — PM2 systemd persistence repair (runbook)

**Finding (CTO review):** `systemctl status pm2-ec2-user` reported
`Active: failed (Result: protocol)` while still *enabled*. The unit is wired to
start at boot but is in a failed state, so a reboot may not resurrect the ~51
PM2-managed processes. Several services also sit at or above their
`max_restarts: 10` give-up threshold (observed: web=65, procurement=18,
finance=13, estab=11, hrms=11, payroll=10, grant=10), meaning they have stopped
auto-recovering and need a root-cause fix, not just a restart.

## Why this matters
PM2 keeps the services alive while the box is up, but boot-time resurrection is
owned by the systemd unit `pm2-<user>`. If that unit is failed, an instance
reboot (planned or from an EC2 health event) brings the host back with **no
application processes** and only liveness probes to tell you — exactly the
"failures are invisible" class of problem this program targets.

## Tooling
`scripts/ops/pm2-systemd-repair.sh` — diagnose-only by default, `--apply` to fix.

```bash
# 1. Diagnose (safe, read-only): unit state + restart counts + error-log tails
scripts/ops/pm2-systemd-repair.sh

# 2. Apply the repair (regenerates the systemd unit, needs sudo)
scripts/ops/pm2-systemd-repair.sh --apply
```

The script prints the exact privileged commands before running anything, so you
can run them by hand instead of `--apply` if you prefer.

## Manual repair (equivalent to `--apply`)
```bash
# (a) regenerate + install a healthy systemd unit
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$(whoami)" --hp "$HOME"

# (b) snapshot the running process list so boot restores it
pm2 save

# (c) confirm the unit is healthy + enabled
sudo systemctl daemon-reload
sudo systemctl enable --now pm2-"$(whoami)"
systemctl status pm2-"$(whoami)" --no-pager
```

## Crash-loop root-cause (do BEFORE zeroing counters)
1. Identify the offenders from the script's section 2 (restart counts) and the
   error-log tails in section 3.
2. `web` (65) and `procurement` (18) are the worst — read their full error logs:
   ```bash
   pm2 logs web --err --lines 200 --nostream
   pm2 logs procurement --err --lines 200 --nostream
   ```
   Typical causes: missing env (fail-closed `dbUrl()` from 06-T5 now throws
   instead of silently using a default — confirm the prod env file is present),
   port already in use, or a dependency that wasn't built.
3. Fix the root cause, rebuild the service (`cd services/<svc>-service && pnpm build`),
   then `pm2 restart <svc>`.
4. Only once a service is stable, reset its counter so the give-up threshold is
   meaningful again:
   ```bash
   pm2 reset all   # or: pm2 reset <name>
   pm2 save
   ```

## Acceptance (09-T3)
- [ ] `systemctl is-active pm2-<user>` → `active`
- [ ] `systemctl is-enabled pm2-<user>` → `enabled`
- [ ] A controlled reboot resurrects **all** PM2 processes
      (`pm2 list` count matches pre-reboot; verify in a maintenance window).
- [ ] Restart counters stop climbing after the root-cause fix
      (re-run the diagnose script a few minutes apart; the top counts are flat).

## Notes
- The reboot verification is deliberately **not** automated here: rebooting a
  shared host is a high-blast-radius action that must be done in a maintenance
  window with sign-off. The script gives you everything needed to make the unit
  healthy so the reboot is safe.
- `pm2 reset all` zeroes counters; do it only after fixes, otherwise you hide
  the very crash-loop signal you need.
