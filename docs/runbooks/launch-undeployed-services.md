# Runbook — Launching the 8 declared-but-not-running services

**Owner:** SRE · **Last verified:** 2026-07-27 · **Risk:** medium (adds processes to a live fleet)

## When to use this

Eight services are declared in `ecosystem.config.js` and routed in the gateway
registry, but are not running. `scripts/ci/deployment-declaration-guard.mjs`
passes; the L0 readiness lane lists them in `KNOWN_NOT_SERVING`.

| Service | Port | Extra secret needed beyond the fleet-wide two |
|---------|------|-----------------------------------------------|
| works | 3036 | — |
| metadata | 3039 | — |
| ml | 3032 | — |
| revenue | 3038 | — |
| inspection | 3037 | — |
| court | 3034 | `COURT_PII_KEY` |
| meeting | 3033 | `MEETING_PII_KEY` |
| visitor | 3035 | `VISITOR_PII_KEY` |

Fleet-wide, all eight need `INTERNAL_SERVICE_SECRET` and `DEVICE_TRUST_SECRET`.

## Why they fail without this procedure

`svc()` injects `NODE_ENV=production` into every app. The ecosystem decides
`IS_PROD` from the **shell** `NODE_ENV`. Start a service without the secrets
exported in the launching shell and it receives an **empty**
`INTERNAL_SERVICE_SECRET` together with `NODE_ENV=production`, so
`@civitasone/auth/plugin` refuses:

```
Error: INTERNAL_SERVICE_SECRET must be set in production; refusing to start.
```

This is correct fail-closed behaviour. The process still shows as `online` in pm2
because it stays attached to pm2's IPC channel — **pm2 "online" is not readiness.**
Always verify with a port check, never with `pm2 list`.

> The `IS_PROD`-from-shell vs `NODE_ENV=production`-injected split is a known
> inconsistency (QUALITY-SCORECARD.md, Next Steps #2). Until it is reconciled,
> the secrets **must** be present in the launching shell.

## Procedure

### 1. Confirm dependencies are up

```bash
for p in 5435 6381 4566; do
  printf "%s: %s\n" "$p" "$(ss -tln | grep -c ":$p ")"
done
```

All three must report `1` or more (Postgres, Redis, LocalStack). Stop if any is `0`.

### 2. Record the current baseline

```bash
pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const l=JSON.parse(d);
  console.log('pm2 total='+l.length+' online='+l.filter(p=>p.pm2_env.status==='online').length);
});"
ss -tln | grep -oP ':(3[0-9]{3}|4012|8080)\b' | sed 's/://' | sort -un | wc -l
```

Write both numbers down. You will compare against them in step 6 and on rollback.

### 3. Load secrets into the launching shell

Take these from the secret manager. **Do not** echo them, and do not write them to
a file that outlives the session.

```bash
read -rs -p "INTERNAL_SERVICE_SECRET: " INTERNAL_SERVICE_SECRET; echo
read -rs -p "DEVICE_TRUST_SECRET: "     DEVICE_TRUST_SECRET;     echo
read -rs -p "COURT_PII_KEY: "           COURT_PII_KEY;           echo
read -rs -p "MEETING_PII_KEY: "         MEETING_PII_KEY;         echo
read -rs -p "VISITOR_PII_KEY: "         VISITOR_PII_KEY;         echo
export INTERNAL_SERVICE_SECRET DEVICE_TRUST_SECRET \
       COURT_PII_KEY MEETING_PII_KEY VISITOR_PII_KEY
```

Sanity-check lengths only — never values:

```bash
for v in INTERNAL_SERVICE_SECRET DEVICE_TRUST_SECRET COURT_PII_KEY MEETING_PII_KEY VISITOR_PII_KEY; do
  printf "%-26s len=%s\n" "$v" "${#!v}" 2>/dev/null || \
    printf "%-26s len=%s\n" "$v" "$(eval echo -n \"\${$v}\" | wc -c)"
done
```

Every PII key must be **≥ 16 characters** or the owning service will fail closed.

Alternative to exporting the PII keys: provision on-host key files, which the
`piiKey()` resolver reads as its second source.

```bash
umask 077
printf '%s' "$COURT_PII_KEY"   > ~/.civitasone-court-pii-key
printf '%s' "$MEETING_PII_KEY" > ~/.civitasone-meeting-pii-key
printf '%s' "$VISITOR_PII_KEY" > ~/.civitasone-visitor-pii-key
```

### 4. Start the no-extra-secret group first

Smallest blast radius, so failures are easy to attribute.

```bash
cd /home/ec2-user/CivitasOne/civitasone-suite
for s in works metadata ml revenue inspection; do
  pm2 start ecosystem.config.js --only "$s"
done
sleep 20
```

### 5. Verify by port, not by pm2

```bash
for p in works:3036 metadata:3039 ml:3032 revenue:3038 inspection:3037; do
  n="${p%%:*}"; port="${p##*:}"
  printf "%-11s bound=%s health=" "$n" "$(ss -tln | grep -c ":$port ")"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 "http://127.0.0.1:$port/health"
done
```

Expected: `bound=1 health=200` for each. On `bound=0`, go to Troubleshooting.

### 6. Start the PII group, then verify

```bash
for s in court meeting visitor; do
  pm2 start ecosystem.config.js --only "$s"
done
sleep 20
for p in court:3034 meeting:3033 visitor:3035; do
  n="${p%%:*}"; port="${p##*:}"
  printf "%-11s bound=%s health=" "$n" "$(ss -tln | grep -c ":$port ")"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 "http://127.0.0.1:$port/health"
done
```

### 7. Verify through the gateway

A bound port proves the service started; only the gateway proves it is reachable.

```bash
TOK=$(node -e "const a=require('./packages/auth/dist/index.js');
console.log(a.signToken({sub:'aaaaaaaa-0000-4000-8000-0000000000ff',
tid:'00000000-0000-0000-0000-000000000001',roles:['super_admin'],sid:'rb'},
process.env.JWT_SECRET||'civitasone-dev-secret'))")

for path in /api/v1/works/works /api/v1/metadata/objects /api/v1/ml/models \
            /api/v1/revenue/collections /api/v1/inspection/plans \
            /api/v1/court/cases /api/v1/meeting/meetings /api/v1/visitor/visits; do
  printf "%-34s " "$path"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 8 \
    "http://localhost:8080$path" -H "Authorization: Bearer $TOK"
done
```

`200` or `403` is success (the route resolved). `502`/`503` means the upstream is
down. `404` means the gateway route is missing — re-run the declaration guard.

### 8. Persist and close out the gate

```bash
pm2 save
node scripts/ci/deployment-declaration-guard.mjs
```

Then **remove each now-serving service from `KNOWN_NOT_SERVING`** in
`tests/quality-program/L0-deployment-readiness/readiness.test.ts`. The L0
staleness check fails while a serving service is still listed — that is
deliberate, so a fixed service cannot silently regress.

```bash
bash scripts/ci/quality-gates.sh L0
```

Finally, extend L1/L2/L4 to the newly reachable services: their tenant isolation
and authz are **unverified** until they are covered.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `online` in pm2, `bound=0`, **empty error log** | Startup threw before binding — usually a missing secret or an unresolvable import | Run in the foreground (below) to see the real error |
| `INTERNAL_SERVICE_SECRET must be set in production` | Secret absent from the launching shell | Redo step 3; `pm2 delete <svc>` then start again |
| `<SVC>_PII_KEY is required (>=16 chars)` | PII key missing or too short | Provide a ≥16-char key or the host key file |
| `ERR_MODULE_NOT_FOUND` on a `@civitasone/*` path | Package `exports` map points at a non-existent file | `node scripts/ci/package-exports-guard.mjs` |
| Gateway returns `404` | No registry prefix | `node scripts/ci/deployment-declaration-guard.mjs` |
| Gateway returns `429` | Rate limit — the global limiter keys on **IP**, 1000/min | Wait 60s; see the L7 finding in QUALITY-SCORECARD.md |

**Foreground run** — the fastest way to see a suppressed startup error. pm2 hides
these because the process survives on its IPC channel:

```bash
cd services/<svc>-service
env PORT=<probe-port> \
    DATABASE_URL="postgres://<svc>_svc:<svc>_dev_pw@localhost:5435/civitas_<svc>" \
    REDIS_URL="redis://localhost:6381" \
    QUEUE_DRIVER=memory CACHE_DRIVER=memory \
    JWT_ALGORITHM=HS256 JWT_SECRET=civitasone-dev-secret \
    NODE_ENV=staging \
    node dist/index.js
```

Use a **probe port** (e.g. 3136 → 3236) so you never collide with the real one.
Reproduce the pm2 failure exactly by setting `NODE_ENV=production` and omitting
the secret. Note that a service's required-env list may include more than the
above — check its `app.ts` before concluding the config is wrong.

## Rollback

Removing these services returns the fleet to its prior state; nothing else
depends on them.

```bash
for s in works metadata ml revenue inspection court meeting visitor; do
  pm2 delete "$s" 2>/dev/null
done
pm2 save
```

Confirm `pm2 total` and the listening-port count match the step 2 baseline, then
restore the `KNOWN_NOT_SERVING` entries so L0 reflects reality again.

## Verification checklist

- [ ] Dependencies up (5435, 6381, 4566)
- [ ] Baseline recorded
- [ ] All 8 report `bound=1 health=200`
- [ ] All 8 resolve through the gateway (200/403, not 404/502)
- [ ] `pm2 save` run
- [ ] Declaration guard clean
- [ ] `KNOWN_NOT_SERVING` updated and L0 green
- [ ] L1/L2/L4 extended to the newly reachable services
