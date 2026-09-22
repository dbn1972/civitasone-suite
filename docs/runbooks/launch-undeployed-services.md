# Runbook — Launching the 8 declared-but-not-running services

**Owner:** SRE · **Last verified:** 2026-09-22 · **Risk:** medium (adds processes to a live fleet)

> **2026-09-22 correction:** step 3b previously told you to `export
> JWT_ALGORITHM=HS256` and to confirm that by copying whatever `finance`
> happened to have set. Both were wrong and have been corrected below —
> Keycloak (this deployment's real OIDC provider) issues **RS256**-signed
> tokens, confirmed directly against the realm's own JWKS. See step 3b for
> the corrected value and a verification method that doesn't depend on
> another service already being configured correctly.

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

### 3b. Set the two runtime knobs — THIS IS THE STEP THAT GETS MISSED

```bash
export RUNTIME_NODE_ENV=staging   # runtime NODE_ENV the SERVICES see
export JWT_ALGORITHM=RS256        # matches what Keycloak actually issues — verify below, don't assume
export NODE_ENV=staging           # only controls the ecosystem's own IS_PROD
```

- **`RUNTIME_NODE_ENV`, not `NODE_ENV`,** sets the runtime env the services see
  (`ecosystem.config.js` line ~62: `NODE_ENV: RUNTIME_NODE_ENV`). Exporting
  `NODE_ENV=staging` alone leaves the service running as `production` — it only
  flips the ecosystem's `IS_PROD` decision, which governs whether secrets are
  demanded and whether PII dev fallbacks are permitted. Verified the hard way on
  2026-07-27.
- **`JWT_ALGORITHM` defaults to `RS256`** (`ecosystem.config.js` line 111:
  `process.env.JWT_ALGORITHM ?? "RS256"`), and **that default is correct — leave
  it unset, or export `RS256` explicitly.** Keycloak (this deployment's real OIDC
  provider) signs real browser-facing tokens with RS256; get this wrong and the
  service starts, binds its port and answers `/health` with 200 — but **every
  gatewayed request returns 401**, which looks like an auth bug and is purely a
  launch-env mismatch.

  Do **not** export `JWT_ALGORITHM=HS256` to "match the fleet." HS256 is real,
  but it is a distinct, narrower, opt-in thing: the internal dev-login fallback
  (gated by `JWT_SECRET` plus a non-production `RUNTIME_NODE_ENV`, documented in
  `docs/GOLDEN-PATH-AUDIT.md` as "Path A"), meant for golden-path usability
  testing when no reachable Keycloak is available. It is not the fleet-wide
  default, and a previous version of this step conflated the two — which is how
  the fleet ended up misconfigured for an extended period even though Keycloak
  has always issued RS256.

#### Verify against Keycloak itself, not against another service

A previous version of this step said to "confirm against a known-good service"
by grepping `finance`'s `pm2 env` and matching whatever it had. **Don't do
that.** It only tells you what `finance` is configured to *verify*, not what
Keycloak actually *signs with* — if `finance` is wrong (as it was), copying it
just propagates the same mistake to every service launched afterward, with
nothing anchored to ground truth.

Check Keycloak's own realm metadata instead. This is public JWKS data — no
login or credentials needed:

```bash
KC_URL="${KEYCLOAK_URL:-https://civitasone.65-2-205-201.nip.io/auth}"
KC_REALM="${KEYCLOAK_REALM:-civitasone}"
# -k is required here: this host's Keycloak cert is CN/SAN-scoped to the
# bare IP (65.2.205.201), not the nip.io hostname every service actually
# connects through — a known hostname-verification mismatch, not a "just
# ignore TLS" habit. See ecosystem.config.js's AUTH_ENV block (~line 183)
# for the full story and the equivalent NODE_TLS_REJECT_UNAUTHORIZED
# workaround already running fleet-wide for the same reason. Without -k,
# curl fails closed with "SSL: no alternative certificate subject name
# matches target hostname" and the node call below throws on the empty
# response — don't mistake that for JWKS being unreachable.
JWKS_URI=$(curl -sk "$KC_URL/realms/$KC_REALM/.well-known/openid-configuration" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      console.log(JSON.parse(d).jwks_uri)})")
curl -sk "$JWKS_URI" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  JSON.parse(d).keys.filter(k=>k.use==='sig').forEach(k=>console.log(k.kty, k.alg))})"
```

Expect exactly one signing (`use:"sig"`) key: `RSA RS256`. That is the algorithm
every Keycloak-facing service must verify against — including the one you are
about to launch. (Equivalently, if you have a real browser session: decode a
real access token's header, the first `.`-separated segment, base64url-decoded
— it will read `{"alg":"RS256",...}`. The JWKS check above proves the same fact
without a live login.)

Whatever this shows, your new service's `pm2 env` must match it. Check with
`pm2 env` after starting, before concluding anything about auth.

### 3c. Confirm the role and database exist

A service with no database cannot start, and this is not hypothetical:
`inspection_svc` and `civitas_inspection` **did not exist at all**, so
inspection-service — 39 test files, 78.6% coverage, declared and routed — could
never have run.

```bash
PGPASSWORD="$PGADMIN_PW" psql -h localhost -p 5435 -U civitas_admin -d postgres -t -A \
  -c "SELECT rolname FROM pg_roles WHERE rolname LIKE '%\_svc' ORDER BY 1"
PGPASSWORD="$PGADMIN_PW" psql -h localhost -p 5435 -U civitas_admin -d postgres -t -A \
  -c "SELECT datname FROM pg_database WHERE datname LIKE 'civitas\_%' ORDER BY 1"
```

Still missing as of 2026-07-27: **`revenue_svc`, `works_svc`, `ml_svc`** and their
databases. Provision with `infra/db/bootstrap/bootstrap_inspection.sql` as the
template — it documents the convention (role `NOSUPERUSER NOBYPASSRLS`, db owned
by `civitas_admin`, service role gets `USAGE` + DML but never ownership), then
apply that service's migrations as `civitas_admin` and re-run the grant block.

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

> **This mints an HS256 token, which only works if the fleet is in the
> dev-login/"Path A" posture (§3b) — the exception, not the default.** Against
> the standard RS256/Keycloak posture this produces `401 TOKEN_INVALID` at the
> gateway regardless of whether the route resolved, which is easy to mistake
> for step 3b having failed. If `pm2 env <gateway id>` shows `JWT_ALGORITHM=RS256`
> (the default — check first), get a real token instead: log in through the
> actual web app / Keycloak flow and copy the access token from the browser's
> network tab or dev-login redirect, then use that as `$TOK` below. Also note:
> as of 2026-09-22, `packages/auth/dist/index.js` does not exist on this host
> (no build artifact) — the snippet below needs a source-mode equivalent
> (`tsx`/`ts-node` against `packages/auth/src/index.ts`) or a prior `pnpm build`
> of that package; this is a separate, pre-existing gap, not part of this fix.

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
A `401 TOKEN_INVALID` here means the token's algorithm doesn't match what the
gateway is configured to verify — see the callout above before assuming the
route itself is broken.

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
| `/health` 200 but **every gatewayed route 401** | `JWT_ALGORITHM` doesn't match Keycloak — usually a stray `HS256` left over from the dev-login/"Path A" posture, applied where real Keycloak-facing RS256 was needed | `pm2 env <id> \| grep JWT_ALGORITHM`; verify the correct value against Keycloak's own JWKS, not against another service (see step 3b); redo step 3b, `pm2 delete` and restart |
| Service runs as `production` despite `NODE_ENV=staging` | You set `NODE_ENV`, not `RUNTIME_NODE_ENV` | Export `RUNTIME_NODE_ENV`; see step 3b |
| `password authentication failed for user "<svc>_svc"` | Role does not exist | Provision it; see step 3c |
| Gatewayed route returns 400 | Route resolved, zod rejected the empty query — this is SUCCESS for reachability | No action |
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
