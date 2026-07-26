# CivitasOne — DEV-ONLY Demo Access (Login Card)

> ## ⚠️ DEV / DEMO ONLY — NOT FOR PRODUCTION
> These are throw-away demo accounts with a **well-known shared password**
> (`Demo@12345`). They exist only so you can log in and click through the suite
> on the `cloudsphere-ec2` dev box. **Never** create these users, this password,
> or the `/auth/dev` login route in any production / internet-facing deployment.
> The running dev fleet authenticates with **HS256** (`JWT_SECRET=civitasone-dev-secret`),
> which is itself a dev-only mode.

---

## 1. Where to log in (the web app)

The Next.js web app runs on the dev box, port **3000** (`next start`, pm2 process `web`).
It binds to `0.0.0.0`, but the box has no public HTTP ingress — reach it over an SSH tunnel:

```bash
# from your laptop
ssh -L 3000:localhost:3000 cloudsphere-ec2
# then open in your browser:
#   http://localhost:3000        → redirects to the sign-in page
```

The suite dashboard lives at `http://localhost:3000/dashboard`. Unauthenticated
requests redirect to `http://localhost:3000/auth/dev`.

---

## 2. How to sign in as a persona

There are two ways. **Method A (cookie) works right now for all 13 personas**
with no rebuild. Method B (the pretty form) needs one env var (and, for the extra
personas, a web rebuild — see notes).

### Method A — set the session cookie (works now, all personas)

Each persona has a pre-minted 12-hour HS256 token in `scripts/demo/.tokens/<username>.jwt`
(regenerated every time you run the seed). Log in by putting it in the `civitasone_at`
cookie, then browse normally.

**Browser DevTools console** (on `http://localhost:3000`):

```js
// paste the token string for your persona (from scripts/demo/.tokens/<username>.jwt)
document.cookie = "civitasone_at=<PASTE_TOKEN>; path=/";
location.href = "/dashboard";
```

Verified: `GET /dashboard` with this cookie returns **HTTP 200** (authenticated
session); without it you get a 307 back to the sign-in page.

### Method B — the `/auth/dev` sign-in form

`http://localhost:3000/auth/dev` — enter **username** + password **`Demo@12345`**,
leave *Office ID* blank (the persona carries its own tenant).

- Requires `DEV_LOGIN_PASSWORD=Demo@12345` in the web process env. To enable on the
  running box:
  ```bash
  pm2 set web:DEV_LOGIN_PASSWORD Demo@12345   # or add to apps/web/.env
  DEV_LOGIN_PASSWORD=Demo@12345 pm2 restart web --update-env
  ```
- The 3 legacy accounts (`superadmin`, `officer`, `auditor`) work as soon as that
  env is set. The **granular personas** below (commissioner, hrofficer, …) are in
  the dev-login route on branch `feat/demo-seed` and become form-loginable after
  the web app is rebuilt from that branch (`pnpm --filter @civitasone/web build && pm2 restart web`).
  Until then, use **Method A** for those — it needs no rebuild.

---

## 3. Personas

Demo password for **all** rows: **`Demo@12345`** (DEV-ONLY). Tenant **T1** =
*Demo Municipal Corporation* (`00000000-0000-0000-0000-000000000001`); tenant
**T2** = *Partner Revenue Department* (`00000000-0000-0000-0000-000000000002`).

| Persona | Username | Password | Roles | Tenant | What they can test |
|---|---|---|---|---|---|
| Platform super admin | `superadmin` | `Demo@12345` | super_admin, platform_admin, admin, tenant_admin | T1 | Everything — all modules, all tenants, admin console |
| Municipal Commissioner | `commissioner` | `Demo@12345` | tenant_admin, admin | T1 | Org/tenant setup, users & roles, module config, dashboards |
| HR / Establishment Officer | `hrofficer` | `Demo@12345` | hr_officer, hr_admin, estab_officer | T1 | HRMS: employees, departments, leave, attendance; Establishment files |
| Finance / Budget Officer | `financeofficer` | `Demo@12345` | finance_officer, budget_officer | T1 | Finance: budget heads, allocations, sanctions, bills (prepare/read) |
| Chief Accounts Officer | `financeadmin` | `Demo@12345` | finance_admin | T1 | Finance approver: approve sanctions / bills / payments |
| Procurement Officer | `procurementofficer` | `Demo@12345` | procurement_officer, procurement_admin | T1 | Procurement: vendors, indents, RFQs, tenders, POs, GRNs |
| Internal Auditor | `auditor` | `Demo@12345` | audit_officer, audit_admin | T1 | Audit: plans, observations, risk register; read-only finance |
| Law Officer | `legalofficer` | `Demo@12345` | legal_officer, legal_admin | T1 | Legal: cases, hearings, notices, opinions, orders |
| Field Inspector | `inspector` | `Demo@12345` | inspector, inspection_admin | T1 | Inspection: templates, field instances, findings |
| Grievance / Dept Officer | `grievanceofficer` | `Demo@12345` | grievance_officer, citizen_officer, dept_officer | T1 | Citizen desk: service applications, grievances, RTI (officer side) |
| Citizen (public user) | `citizen` | `Demo@12345` | citizen | T1 | Citizen portal: file a grievance / service application / RTI |
| Data Principal (consent) | `dataprincipal` | `Demo@12345` | data_principal, citizen | T1 | Data governance: grant/revoke consent for cross-dept sharing |
| Partner Dept Officer | `partnerofficer` | `Demo@12345` | tenant_admin, dept_officer, citizen_officer | **T2** | Second tenant — proves tenant isolation & is the consent-exchange counterparty |

---

## 4. Headless / API testing (HS256 test-bypass)

The whole fleet (gateway `:8080` + all services) verifies **HS256** tokens signed
with **`civitasone-dev-secret`** (the dev test-bypass secret; the test suites use
`test_secret_for_civitasone_32chr` — either works if it matches the process's
`JWT_SECRET`, which here is `civitasone-dev-secret`). Mint a token for any persona
and call the gateway directly.

```bash
# use a pre-minted token
TOKEN=$(cat scripts/demo/.tokens/financeofficer.jwt)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/finance/budgets

# or mint the built-in super_admin token
TOKEN=$(JWT_SECRET=civitasone-dev-secret node scripts/dev/_mint-dev-token.cjs)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/hrms/employees
```

Mint an arbitrary persona token by hand (HS256, header `{"alg":"HS256","typ":"JWT"}`,
claims `{sub, tid, tenantId, roles, iss:"civitasone-dev", aud:"civitasone", exp}`),
signed with `civitasone-dev-secret`. `scripts/demo/seed-demo.mjs` does exactly this
and drops the results in `scripts/demo/.tokens/` (gitignored).

Auth verified during seeding: `superadmin`, `financeofficer`, `procurementofficer`
→ HTTP 200 (token accepted); `partnerofficer` (T2, no finance role) → HTTP 403
(token accepted, correctly forbidden — RBAC working).

---

## 5. What data is seeded

- **Tenant / identity / RBAC** (this seed): 2 demo tenants; 13 persona users in
  `identity-service` (`users.users`); per-tenant RBAC roles + role assignments in
  `rbac.roles` / `rbac.role_assignments` (tenant membership); Keycloak realm roles
  + realm users with the demo password (best-effort — OIDC-readiness only, since
  the live fleet uses HS256).
- **Module data** (via the existing idempotent `scripts/dev/seed-all.mjs`, invoked
  by the demo seed): budget heads + allocations + sanctions + bills + payments +
  ledger (finance); employees, departments, leave, attendance, trainings (HRMS);
  vendors, indents, RFQs, tenders, POs, GRNs (procurement); citizen services,
  applications, grievances, RTI (citizen); legal cases/hearings/notices; audit
  plans/observations/risk; grant schemes/beneficiaries/disbursements; projects,
  schemes, fund releases; assets, stock, contracts, CRM, workflows, reports,
  notifications, and more — all scoped to tenant T1 (`…0001`).

### Tenant isolation — proven

Verified during seeding against the **NOBYPASSRLS** service DB roles (not the
superuser), so Postgres RLS actually filters:

- `finance_svc` + `app.tenant_id=T1` → **2** budget rows; `+T2` → **0** rows → isolated ✓
- `identity_svc` + `app.tenant_id=T1` → **26** role assignments; `+T2` → **3** → isolated ✓

---

## 6. ⚠️ Known limitation — list views may read empty in the live UI

The service builds currently deployed on the box (pm2 `dist/`, built **Jun 28**)
**predate** the change that sets the `app.tenant_id` GUC on the *read* path. Under
the NOBYPASSRLS service roles, RLS then fails closed and **list/detail reads return
0 rows** even though the data exists and is correctly tenant-scoped in the database
(confirmed above). This is a **stale-deployment condition, not a seed problem** —
writes (POST) are accepted and the DB is correctly populated; only the deployed read
path is behind `main`.

To make seeded data visible in the live UI, rebuild + restart the services from
current `main` (each service's read path in `src/` already wraps reads in the
tenant transaction). Example for one service:

```bash
pnpm -r --filter "./packages/*" build          # build workspace deps first
pnpm --filter @civitasone/finance-service build
pm2 restart finance
```

(At the time of writing, a clean `main` service build needs the `@civitasone/*`
workspace packages built first — e.g. `@civitasone/reconciliation` — do that before
the per-service build.)

Until then, personas can still **log in**, see role-appropriate **navigation**, and
exercise **create** flows; the API/DB layers and tenant isolation are fully
functional and demonstrable via the curl examples above.

---

## 7. Re-running the seed (idempotent)

```bash
cd /home/ec2-user/wt-demoseed          # (or wherever the branch is checked out)
node scripts/demo/seed-demo.mjs        # safe to re-run; upserts everything

# useful env toggles:
#   SKIP_MODULE_DATA=1   only (re)provision personas + tenants + tokens
#   SKIP_KEYCLOAK=1      skip Keycloak realm provisioning
#   DEMO_PASSWORD=...    override the demo password
```
