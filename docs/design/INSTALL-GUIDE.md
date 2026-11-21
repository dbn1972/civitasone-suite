# CivitasOne — Installation & Deployment Guide

**Platform:** CivitasOne Suite (multi-tenant municipal-governance SaaS)
**Reference build:** pilot build `0a5843762`
**Document status:** Code-verified against the supplied source files (see Section 1.3)
**Companion documents:** HLD, SAD, LLD, Cloud / Infrastructure / Security / Data / Integration Architecture

---

# 1. Purpose, Audience and Verification Basis

## 1.1 Purpose

This guide describes how to install, configure, verify, upgrade and roll back a CivitasOne environment. It is written against the actual installer (`install.sh`), the production and development Docker Compose files, the on-premises Helm chart values, and the environment template (`.env.example`). Where earlier documentation (`INSTALLATION-OPERATIONS-GUIDE.md`, `README.md`, `deployment-runbook.md`) disagrees with those files, this guide follows the files and records the disagreement in Appendix A.

## 1.2 Audience

| Role | Use of this guide |
|---|---|
| Platform / DevOps engineer | Sections 3 to 7 and 10: provisioning, install, upgrade, rollback |
| Security / compliance reviewer | Sections 5, 8 and Appendix A: secrets, TLS expectation, mock integrations |
| Implementation lead (tenant onboarding) | Sections 8 and 9: realm, tenant, adapter configuration and acceptance checks |
| Solution / enterprise architect | Sections 2 and Appendix A: deployment-mode fit and known gaps |

## 1.3 Verification basis and conventions

The following local copies were read in full and are the only sources of fact in this document:

| Source | Role |
|---|---|
| `install.sh` (1106 lines, installer `VERSION="1.0.0"`) | One-command installer |
| `infra/docker-compose.prod.yml` (1339 lines) | Production compose topology |
| `infra/docker-compose.yml` (303 lines) | Development infrastructure compose |
| `infra/onprem/helm/civitasone/Chart.yaml`, `values.production.yaml` | Helm chart metadata and production overrides |
| `.env.example` (203 lines) | Configuration template |
| `INSTALLATION-OPERATIONS-GUIDE.md`, `deployment-runbook.md`, `README.md` | Pre-existing narrative documentation |

Conventions used throughout:

- **Verified** means the statement is read directly from one of the files above.
- **Not verifiable from supplied files** means the item is referenced by those files (for example a script or a Dockerfile) but the referenced file itself was not supplied. Such items are called out rather than assumed.
- Paths are relative to the repository root. `install.sh` resolves its own directory as the repository root and uses `infra/.env` and `infra/docker-compose.prod.yml` relative to it.
- No credential values appear in this document. Secret names are given; values are generated or supplied at install time.

---

# 2. Deployment Modes Overview

## 2.1 Modes

CivitasOne has three packaged deployment modes, plus a fourth process-manager mode documented in the operations runbook.

1. **Local development** uses `infra/docker-compose.yml` to run only the infrastructure dependencies (Postgres, PgBouncer, Redis, Meilisearch, Keycloak, LocalStack). Application services run from source with `pnpm`.
2. **Single-host production compose** uses `infra/docker-compose.prod.yml` to run infrastructure, application services, background workers, the queue service, the gateway and the web application on one Docker host. This is the path driven by `install.sh` (mode `compose`).
3. **On-premises Helm** uses `infra/onprem/helm/civitasone`. It is available for self-managed Kubernetes, with the caveats in Section 2.3. `install.sh --mode helm` does not deploy anything; it prints a `helm upgrade --install` command.
4. **PM2 on a host (documented in the runbook)** is described in `deployment-runbook.md` (`pm2 restart all`, `pm2 start ecosystem.config.js`, a `pm2-ec2-user` systemd unit, and a fleet of 132 declared PM2 apps). The supplied files do not state which of modes 2 or 4 the pilot build `0a5843762` actually runs on. Confirm this with the environment owner before using this guide to rebuild the pilot; see Appendix A, item A-3.

## 2.2 Comparison

| Attribute | Local development | Single-host production compose | On-prem Helm | PM2 on host (runbook) |
|---|---|---|---|---|
| Entry point | `docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml up -d` | `./install.sh --mode compose` or manual `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d` | `helm upgrade --install civitasone infra/onprem/helm/civitasone ...` | `pm2 start ecosystem.config.js` |
| Application services | Run from source (`pnpm --filter ... dev`) | 65 containers: 31 API services, 31 CQRS workers, `queue-service`, `gateway-service`, `web` | Kubernetes Deployments (templates not supplied) | Processes declared in `ecosystem.config.js` (132 apps per runbook) |
| Infrastructure | Postgres 16 (alpine), PgBouncer 1.23.1-p2, Redis 7 (alpine), Meilisearch 1.11.3, Keycloak 24.0, LocalStack 3 | Postgres 16.4, PgBouncer 1.21.0, Redis 7.4, Keycloak 25.0, LocalStack 3.7 | External or chart-provided (not verifiable from supplied files) | External to PM2 |
| Queue / object store | LocalStack SQS, S3, Secrets Manager | LocalStack SQS and S3 (emulator, no persistence volume) | Not verifiable from supplied files | Per host configuration |
| Meilisearch (global search) | Yes | **Not in the compose file** | Chart reportedly ships it (per a comment in the dev compose); not verifiable here | Per host configuration |
| TLS | Not applicable | **None in the compose file**; terminate in front (Section 8.4) | Ingress TLS block present in values | External |
| High availability | None | None (single host, `restart: unless-stopped`) | `replicaCount: 2`, HPA 2 to 5, PDB (see caveat) | None built in |
| Intended use | Developer workstation | Evaluation, staging, small single-host deployments | Self-managed Kubernetes | Current staging-style host per runbook |
| Maturity | Supported | Primary packaged path; installer has defects (Section 4.9) | Exists, with caveats | Operational runbook exists |

## 2.3 Status of the Kubernetes / Helm path

The Helm path must be described as **on-prem / self-managed Kubernetes, with caveats**. It is not the primary production path.

- The chart is versioned `0.1.0` with `appVersion: "0.1.0"` (`Chart.yaml`).
- `values.production.yaml` sets `replicaCount: 2`, an ingress host (`civitasone.example.gov.in`, a placeholder), `ingress.tls.enabled: true` with `secretName: civitasone-tls`, resource requests and limits, `hpa`, `pdb` and `networkPolicy` blocks.
- The chart's `templates/` directory and base `values.yaml` were **not supplied**, so three known risks could not be confirmed here and must be checked before relying on them:
  1. **HPA / PDB key mismatch.** `values.production.yaml` uses the keys `hpa.enabled` and `pdb.enabled`. If the templates read differently named keys (for example `autoscaling.enabled` or `podDisruptionBudget.enabled`), these overrides are silently ignored and no HPA or PDB is rendered. Verify with the render check below.
  2. **NetworkPolicy and external database.** `networkPolicy.enabled: true` may render a policy that restricts egress to in-cluster destinations. If PostgreSQL is an external managed database, egress to it can be blocked. Verify the rendered policy's egress rules.
  3. **No secrets or database configuration in the production values file.** All DSNs and secrets must be supplied through a Kubernetes Secret or additional values; the supplied file does not define them.
- `install.sh --mode helm` only prints the command shown in Section 6.5. It does not call `configure_environment`, so it generates no configuration despite its message "This installer generated your configuration".

Render check to run before any Helm install:

```bash
helm template civitasone infra/onprem/helm/civitasone \
  -f infra/onprem/helm/civitasone/values.production.yaml \
  | grep -E '^kind: (HorizontalPodAutoscaler|PodDisruptionBudget|NetworkPolicy)'
```

If `HorizontalPodAutoscaler` or `PodDisruptionBudget` is absent from the output while `hpa.enabled` / `pdb.enabled` are `true`, the value keys do not match the templates.

## 2.4 AWS landing zone

The Terraform landing zone ships only in part (SQS, SNS and an RDS read replica are active; VPC, ALB, EKS and RDS primary are commented out, per the engagement brief). No supplied file contradicts or confirms this. Nothing in this guide depends on Terraform; there is no EKS deployment path to document.

## 2.5 Deployment topology (single-host production compose)

```mermaid
flowchart TB
    U["Browser / Mobile client"] -->|"HTTPS (terminated upstream)"| LB["Reverse proxy / load balancer<br/>(not part of compose)"]
    LB -->|":3000"| WEB["web<br/>Next.js"]
    LB -->|":8080"| GW["gateway-service<br/>:8080"]
    LB -.->|"OIDC redirects<br/>(Keycloak is NOT published by compose)"| KC

    subgraph HOST["Docker host - network civitasone (bridge)"]
        WEB -->|"CIVITASONE_API_BASE_URL<br/>http://gateway-service:8080"| GW
        GW --> SVC["31 API services<br/>ports 3001-3031, 4012<br/>+ queue-service :3030"]
        SVC --> WRK["31 CQRS workers<br/>(no healthchecks)"]
        SVC -->|"DB_VIA_PGBOUNCER=true"| PGB["pgbouncer 1.21.0<br/>:6432 transaction pool<br/>published on host :6432"]
        WRK --> PGB
        PGB --> PG[("postgres 16.4<br/>per-service databases<br/>volume pgdata")]
        SVC --> RD[("redis 7.4<br/>AOF, volume redisdata")]
        SVC -->|"QUEUE_DRIVER=sqs<br/>AWS_ENDPOINT_URL"| LS["localstack 3.7<br/>SQS + S3 emulation<br/>no data volume"]
        GW -->|"JWKS / RS256 validation<br/>KEYCLOAK_URL=http://keycloak:8080"| KC["keycloak 25.0<br/>HTTP, hostname-strict=false<br/>realm import on start"]
        KC --> PG
    end
```

Host-published ports in `docker-compose.prod.yml` (verified): `6432` (PgBouncer, all interfaces), `${GATEWAY_PORT:-8080}` to the gateway's 8080, and `${WEB_PORT:-3000}` to the web container's 3000. Postgres (5432), Redis (6379), LocalStack (4566) and Keycloak (8080) are **not** published to the host.

---

# 3. Prerequisites

## 3.1 Software versions (constants in `install.sh`)

| Component | Minimum | Source / behaviour |
|---|---|---|
| Docker Engine | `24.0.0` (`MIN_DOCKER_VERSION`) | Below minimum is a pre-flight FAIL |
| Docker Compose (v2 plugin, `docker compose`) | `2.20.0` (`MIN_COMPOSE_VERSION`) | Below minimum is a WARN only; absence of the plugin is a FAIL |
| Helm | `3.12.0` (`MIN_HELM_VERSION`) | Constant is defined but **never checked** by the script |
| Node.js | `20.0.0` (`MIN_NODE_VERSION`) | Constant is defined but **never checked**; yet the migration step runs `node scripts/dev/migrate-all.mjs` on the host |
| bash | 4 or later | Pre-flight FAIL if major version < 4 (macOS ships bash 3.2) |
| `curl`, `openssl`, `jq`, `git` | any | Each missing tool is a pre-flight FAIL |
| `psql` / `pg_isready` client | any | WARN only; used for validation |
| `kubectl` | n/a | Mentioned in the header comment; **never checked** |

Container image versions in the compose files (verified):

| Image | Dev compose | Prod compose |
|---|---|---|
| PostgreSQL | `postgres:16-alpine` | `postgres:16.4-bookworm` |
| PgBouncer | `edoburu/pgbouncer:v1.23.1-p2` | `edoburu/pgbouncer:1.21.0` |
| Redis | `redis:7-alpine` | `redis:7.4-bookworm` |
| Keycloak | `quay.io/keycloak/keycloak:24.0` | `quay.io/keycloak/keycloak:25.0` |
| LocalStack | `localstack/localstack:3` | `localstack/localstack:3.7` |
| Meilisearch | `getmeili/meilisearch:v1.11.3` | not present |

Developer workstation additionally needs Node.js 20+ and pnpm 9+ (`README.md`).

## 3.2 Operating system and hardware

| Item | Installer check | Threshold |
|---|---|---|
| OS | Reads `/etc/os-release` (or `sw_vers` on macOS) and always passes; no allow-list | None enforced |
| CPU architecture | `uname -m` | `x86_64`, `aarch64`, `arm64` pass; others FAIL |
| Memory (Linux only, from `/proc/meminfo`) | `MemTotal` | 8 GB or more PASS; 4 to 7 GB WARN; below 4 GB FAIL; check skipped when `/proc/meminfo` is absent |
| Free disk (uses `df -BG`, GNU syntax) | Free space at the repository directory | 50 GB or more PASS; 20 to 49 GB WARN; below 20 GB FAIL |

Practical notes:

- The pre-flight is effectively **Linux-only** (`df -BG`, `/proc/meminfo` and `ss` are GNU/Linux constructs). The earlier guide's tested platforms are Amazon Linux 2023 and Ubuntu 22.04; those are reasonable targets but are not enforced by the script.
- The installer's 4 GB / 8 GB figures are floors for the check, not a sizing recommendation. The full compose stack starts **70 containers** (5 infrastructure + 65 application). `docker compose build` itself advises at least 8 GB of memory allocated to Docker (installer failure message), and `localstack` alone is capped at `mem_limit: 3g` with `cpus: "2.0"`. As an engineering recommendation (not derived from the code), plan 16 GB RAM for evaluation and 32 GB or more for a staging or production host running all services, and 100 GB of disk to hold images, build cache and the `pgdata` volume.

## 3.3 Network ports

`install.sh` checks `REQUIRED_PORTS=(8080 3000 5432 6379 6432)` using `ss` / `netstat`. A busy port is a WARN only ("Will conflict").

| Port | Component | Published to host by prod compose | Notes |
|---|---|---|---|
| `8080` | Gateway (`GATEWAY_PORT`) | Yes | Public API entry point |
| `3000` | Web (`WEB_PORT`) | Yes | Public web entry point |
| `6432` | PgBouncer | Yes (all interfaces) | Restrict by host firewall; see Section 8.4 |
| `5432` | PostgreSQL | No | Checked by installer but not published by prod compose |
| `6379` | Redis | No | Checked by installer but not published by prod compose |
| `3001`-`3031`, `4012`, `3030` | Application services and `queue-service` | No | Container-internal only |
| `8180` | Keycloak (dev compose `KEYCLOAK_HOST_PORT`) | Dev compose only | The installer's final summary and validation probe `localhost:8180`, which the prod compose does not publish |

Dev compose host ports (verified): Postgres `${POSTGRES_HOST_PORT:-5435}`, PgBouncer `${PGBOUNCER_HOST_PORT:-6432}` (maps to container 5432), Redis `${REDIS_HOST_PORT:-6381}`, LocalStack `${LOCALSTACK_HOST_PORT:-4566}`, Meilisearch `127.0.0.1:${MEILISEARCH_HOST_PORT:-7700}`, Keycloak `${KEYCLOAK_HOST_PORT:-8180}`.

**Port 6432 conflicts if both the dev and prod compose files are run on the same host**, because both publish it.

## 3.4 Outbound connectivity

The pre-flight probes `https://registry-1.docker.io/` and `https://github.com` (WARN only). On an air-gapped or restricted network, pre-load all images and set `IMAGE_REGISTRY` to a private registry.

---

# 4. One-Command Installation (`install.sh`)

> **Read Section 4.9 before running the installer.** Two defects in the supplied script prevent an unmodified end-to-end run from completing on a clean host. Section 6 gives the equivalent manual procedure that works around them.

## 4.1 Invocation

Run from the repository root (the script changes directory to its own location).

```bash
./install.sh                          # interactive
./install.sh --config install.conf    # non-interactive; config file is sourced
./install.sh --dry-run                # no changes made
./install.sh --resume                 # continue after a failure
./install.sh --validate               # post-install validation + readiness score only
./install.sh --mode compose           # skip mode prompt (compose | helm | manual)
./install.sh --non-interactive        # accept defaults for all prompts
./install.sh --help
```

## 4.2 Flag reference

| Flag | Argument | Effect (verified in `parse_args` and `main`) |
|---|---|---|
| `--dry-run` | none | Sets `DRY_RUN=true`. Pre-flight still runs. Image build, infrastructure start, migrations, service start and post-install validation are each reported as SKIP. `configure_environment` is **not** skipped, so a dry run still writes `infra/.env` (see Section 4.9) |
| `--resume` | none | Loads `.install-state.json`; if absent, logs "No state file found" and starts fresh. See Section 4.6 |
| `--validate` | none | Runs `post_install_validate` then `compute_readiness_score`, then exits 0. Skips pre-flight and installation |
| `--config FILE` | path | Sets non-interactive mode; fails (`die`) if the path is empty or not a file. The file is **`source`d as shell code** after argument parsing |
| `--mode M` | `compose`, `helm`, `manual` | Pre-selects the mode; any other value is a `die` |
| `--non-interactive` | none | No prompts. Mode defaults to `compose` when none is given; ports and URLs use defaults |
| `--help`, `-h` | none | Prints usage and exits 0 before changing directory |
| (unknown) | any | `die "Unknown argument"` |

Security notes on `--config`: the file is executed in the installer's shell, so it must be treated as trusted code. Also, the interactive prompts and defaults live in `configure_environment` as local variables (`gateway_port`, `web_port`, `cors_origin`, `api_base`); a sourced config file therefore **cannot change the ports, CORS origin or public API URL**. It can only set shell variables such as `MODE` (it is sourced after `--mode` is parsed and would override it). To change those values, edit `infra/.env` after generation (Section 5) or answer the interactive prompts.

## 4.3 Deployment modes inside the installer

| Mode | Menu option | Behaviour |
|---|---|---|
| `compose` | 1) Docker Compose | Full automated install (Section 4.4) |
| `helm` | 2) Kubernetes/Helm | Prints a `helm upgrade --install` command and refers to `infra/DEPLOY.md` section B; **does nothing else** |
| `manual` | 3) Manual | Runs `configure_environment` only (writes `infra/.env`) and prints guidance |

## 4.4 Phase flow

The installer has pre-flight and mode selection followed by mode-specific steps. Steps are counted by the `STEP` variable; `TOTAL_STEPS` is hard-coded to `9` although the compose path runs eight numbered steps.

```mermaid
flowchart TD
    A["parse_args<br/>--dry-run --resume --validate --config --mode --non-interactive"] --> B{"--validate?"}
    B -- yes --> V["post_install_validate<br/>compute_readiness_score<br/>exit 0"]
    B -- no --> C["source --config file (if given)<br/>TOTAL_STEPS=9"]
    C --> D{"STEP < 1?"}
    D -- yes --> P["Pre-flight<br/>preflight_os, preflight_deps,<br/>preflight_ports, preflight_network"]
    P --> PF{"any FAIL?"}
    PF -- yes --> X1["save_state, exit 1"]
    PF -- no --> M
    D -- no --> M["select_mode<br/>(skipped if STEP >= 2)"]
    M --> MODE{"MODE"}
    MODE -- manual --> E0["configure_environment<br/>print guidance"]
    MODE -- helm --> H0["print helm command<br/>(no config generated)"]
    MODE -- compose --> S1["1 configure_environment<br/>writes infra/.env, chmod 600"]
    S1 --> S2["2 compose_validate<br/>docker compose config -q"]
    S2 --> S3["3 compose_pull_or_build<br/>docker compose build"]
    S3 --> S4["4 compose_start_infra<br/>postgres pgbouncer redis localstack keycloak<br/>wait up to 120 s for 4 healthy"]
    S4 --> S5["5 compose_run_migrations<br/>psql 01-bootstrap.sql,<br/>node scripts/dev/migrate-all.mjs"]
    S5 --> S6["6 compose_start_services<br/>docker compose up -d<br/>wait up to 180 s for 30 ready"]
    S6 --> S7["7 post_install_validate<br/>gateway, web, redis, postgres,<br/>SQS, Keycloak, round-trip"]
    S7 --> S8["8 compute_readiness_score<br/>0-100 heuristic"]
    E0 --> Z
    H0 --> Z
    S8 --> Z["print_summary, save_state<br/>delete state file if FAIL = 0"]
    S2 -. "failure: die" .-> R["state saved<br/>re-run with --resume"]
    S3 -. "failure: die" .-> R
    S4 -. "failure: die" .-> R
    S5 -. "failure: die" .-> R
    S6 -. "failure: die" .-> R
```

### Phase 1: Pre-flight

| Function | Checks | Outcome |
|---|---|---|
| `preflight_os` | OS name, architecture, memory, free disk | FAIL on unsupported architecture, memory below 4 GB, disk below 20 GB |
| `preflight_deps` | bash 4+, `curl openssl jq git`, Docker >= 24.0.0, Docker Compose >= 2.20.0, Docker daemon reachable, `psql` | FAIL on missing or old Docker, missing tool, daemon not running; WARN for old Compose or missing `psql` |
| `preflight_ports` | Ports 8080, 3000, 5432, 6379, 6432 free | WARN only |
| `preflight_network` | Docker Hub, GitHub reachable (10 s timeout) | WARN only |

Any FAIL in pre-flight saves state and exits with status 1. Fix the cause and re-run.

### Phase 2: Mode selection

Interactive prompt "Select mode [1-3]". With `--non-interactive` or `--config` the default is `compose`.

### Phase 3: Compose installation steps

| Step | Function | Action |
|---|---|---|
| 1 | `configure_environment` | Generates secrets and writes `infra/.env` (mode 600). Skipped if `infra/.env` exists **and** `--resume` was given. See Section 4.5 |
| 2 | `compose_validate` | `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env config -q`. Failure calls `die "Fix infra/.env and re-run"` |
| 3 | `compose_pull_or_build` | If an image `${IMAGE_REGISTRY}/gateway-service` already exists locally, skips. Otherwise runs `docker compose ... build` (message says 5 to 15 minutes; "33 services + gateway + web" is stale, see Appendix A). In dry-run it is skipped |
| 4 | `compose_start_infra` | `docker compose ... up -d postgres pgbouncer redis localstack keycloak`; polls every 5 s up to 120 s until at least 4 services report `healthy`. Timeout is a WARN, not a failure |
| 5 | `compose_run_migrations` | (a) `docker compose exec -T postgres psql -U civitasone -f /docker-entrypoint-initdb.d/01-bootstrap.sql`; failure is a WARN ("may be already done"). (b) `node scripts/dev/migrate-all.mjs` on the **host**; failure calls `die` |
| 6 | `compose_start_services` | `docker compose ... up -d` for everything; polls every 10 s up to 180 s for at least 30 containers running or healthy. Falling short is a WARN |
| 7 | `post_install_validate` | Probes listed in Section 9.1 |
| 8 | `compute_readiness_score` | Section 4.7 |

Compose project defaults: no `-p` flag is passed, so the project name is the compose file's directory name (`infra`). The dev compose file sets `name: civitasone`.

### Phase 4: Summary and cleanup

`print_summary` prints access points, counters (Passed / Warnings / Failed / Skipped) and next steps, then `save_state` runs. If `FAIL` is 0 the state file is deleted.

## 4.5 Secret generation

`configure_environment` writes `infra/.env` with these values (all verified):

| Variable | Generation |
|---|---|
| `POSTGRES_PASSWORD` | `generate_password 32`: `openssl rand -base64 48`, strip `/` and `+`, first 32 characters |
| `KEYCLOAK_ADMIN_PASSWORD` | `generate_password 24` |
| `INTERNAL_SERVICE_SECRET`, `DEVICE_TRUST_SECRET` | `generate_secret 48`: `openssl rand -base64 48`, strip `/ + =`, first 48 characters |
| `MFA_ENC_KEY`, `PII_ENC_KEY`, `CITIZEN_PII_KEY`, `CRM_PII_KEY` | `generate_secret 32` |
| Fixed values | `IMAGE_REGISTRY=civitasone`, `IMAGE_TAG=latest`, `POSTGRES_USER=civitasone`, `POSTGRES_DB=civitasone`, `KEYCLOAK_ADMIN=admin`, `KEYCLOAK_REALM=civitasone`, `AWS_DEFAULT_REGION=ap-south-1`, `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`, `AWS_S3_BUCKET=civitasone` |
| Prompted (interactive) | `GATEWAY_PORT` (8080), `WEB_PORT` (3000), `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080`), `CORS_ORIGIN` (default `http://localhost:3000`) |

The file is created with `chmod 600`. Secrets are not echoed to the console.

**The generated file is not sufficient for `docker-compose.prod.yml`.** It omits all 31 `DATABASE_URL_<SVC>` variables and `CANDIDATE_JWT_SECRET`, each of which the compose file declares as required (`${VAR:?}`). See Section 4.9, defect D-2, and the required-variable list in Section 5.2.

## 4.6 Resume-on-failure and state file

State file: `.install-state.json` in the repository root. Fields written by `save_state`: `mode`, `step`, `timestamp`, `pass`, `fail`, `warn`. Log files: `.install-log/install-<YYYYMMDD-HHMMSS>.log` (each line `ISO-8601 [LEVEL] message`).

When state is saved: on any `die`, on a pre-flight failure, and at the end of every run. It is deleted only when the run ends with zero failures.

Resume behaviour (verified; this is a "re-run, skip what is cheap" model, not a true per-step checkpoint):

- `--resume` loads `mode` and `step`. Pre-flight is skipped when `step >= 1`; mode selection is skipped when `step >= 2`.
- **Every compose step is re-executed** from `configure_environment` onward regardless of where the failure occurred. The steps are written to be idempotent: `configure_environment` returns early if `infra/.env` exists; the build is skipped if images exist; `up -d` is idempotent; the bootstrap SQL failure is only a WARN.
- Because `STEP` starts from the saved value, the "Step n/9" banner will show inflated numbers on a resumed run. This is cosmetic.
- If you change `infra/.env` between attempts, pass `--resume` to keep the existing file; omit `--resume` and the installer will **overwrite** it with newly generated secrets, breaking an already-initialised Postgres volume (the database retains the old password).

## 4.7 Readiness scoring

`compute_readiness_score` awards points for 20 checks. It is a **file-presence and configuration heuristic**, not a runtime assessment.

| Category (max points) | Checks (5 points each unless stated) |
|---|---|
| Security (25) | `JWT_ALGORITHM` RS256 in `infra/.env` or prod compose; no `CHANGE_ME`/`your-secret-here` in `infra/.env`; `INTERNAL_SERVICE_SECRET` length at least 32; `PII_ENC_KEY` at least 16 chars; `USER node` in `Dockerfile` or `runAsNonRoot: true` in the Helm deployment template |
| Reliability (20) | Postgres `pg_isready`; Redis ping; `healthcheck:` present in prod compose; `pgbouncer` present in prod compose |
| Observability (15) | `pino` under `packages/observability/`; `/health` or `/ready` in `Dockerfile`; `/metrics` in `services/gateway-service/src/response-metrics.ts` |
| Backup and DR (15) | `scripts/ops/backup-databases.sh`; `scripts/ops/restore-drill.sh`; `.github/workflows/dr-drill.yml` |
| Performance (10) | Redis caching check; rate limiting in `services/gateway-service/src/app.ts` |
| Documentation (10) | `infra/DEPLOY.md`; at least 5 files under `docs/runbooks/` |
| Operational hygiene (5) | `NODE_ENV` production (3 points); `infra/.env` or `.env.local` in `.gitignore` (2 points) |

Verdict thresholds: **85 or more** "READY FOR PRODUCTION"; **60 to 84** "NEEDS ATTENTION"; **below 60** "NOT PRODUCTION READY".

Known scoring defects:

- The Redis caching check pipes `grep -rq` (which prints nothing) into `head -1 | grep -q .`, so it can never succeed. The practical maximum is **95/100**.
- Many checks read repository files not supplied here (`Dockerfile`, `packages/observability/`, `services/gateway-service/...`). On a deployment host that lacks the source tree, those checks score zero.
- A score of 85 or above does not imply real security: it passes with `AWS_ACCESS_KEY_ID=test`, LocalStack in place of AWS, and no TLS.

## 4.8 Typical outputs

At the end the installer prints access points (web `http://localhost:<WEB_PORT>`, gateway `http://localhost:<GATEWAY_PORT>`, health `.../health`, Keycloak `http://localhost:8180`), the counters, and management commands:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env ps
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env logs -f
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env down
./scripts/ops/validate-install.sh        # referenced; script not supplied
```

## 4.9 Installer defects found during verification

These were identified by reading the script; D-1 was additionally reproduced in isolation (a minimal `set -e` / `((VAR++))` script). The full installer was **not executed** against a live host in this exercise. Validate with `./install.sh --dry-run` on a scratch host before relying on either conclusion.

| ID | Defect | Evidence | Impact | Workaround / fix |
|---|---|---|---|---|
| D-1 | `set -euo pipefail` combined with post-increment counters: `((PASS++))`, `((WARN++))`, `((FAIL++))`, `((SKIP++))`, `((STEP++))` | `((X++))` evaluates to the old value; when it is `0` the arithmetic command returns status 1 and `set -e` terminates the script. `PASS` and `STEP` start at 0. Reproduced in isolation: `bash -c 'set -e; PASS=0; ((PASS++)); echo survived'` prints nothing and exits 1 | The installer exits silently at the **first** `check` call (Operating system line) on a fresh run, with no `die` message and no saved state. `--validate` fails the same way (`STEP=0`) | Replace with `PASS=$((PASS+1))` (and likewise for the other counters), or use `((++X))`. Alternatively use the manual procedure in Section 6 |
| D-2 | Generated `infra/.env` lacks variables required by the production compose | The compose file requires `DATABASE_URL_<SVC>` for 31 services and `CANDIDATE_JWT_SECRET` using `${VAR:?}`; `configure_environment` writes none of them | `compose_validate` (`config -q`, output suppressed) fails and the installer dies with "Fix infra/.env and re-run" | Append the missing variables before step 2 (Section 5.2), then `./install.sh --resume` |
| D-3 | `--dry-run` writes `infra/.env` | `configure_environment` has no dry-run guard | A dry run is not side-effect free; a subsequent real run without `--resume` will regenerate and overwrite secrets | Remove `infra/.env` after a dry run, or use `--resume` deliberately |
| D-4 | Final summary and Keycloak probe use `localhost:8180` (and `8080` as fallback) | Prod compose does not publish Keycloak; `8080` is the gateway | Keycloak "ready" check can pass or fail for the wrong reason; the printed Keycloak URL is unreachable | Use `docker compose exec keycloak ...` or a reverse-proxy route (Section 9) |
| D-5 | Host-side migration step needs Node and repository dependencies the installer does not check or install | `MIN_NODE_VERSION` unused; Postgres port 5432 is not published by prod compose | `node scripts/dev/migrate-all.mjs` on the host cannot reach Postgres directly. Whether it can use PgBouncer on `6432` depends on the script, which was not supplied | Confirm the script's DSN handling; see Section 7.3 |
| D-6 | Container-count thresholds are stale | Targets 30 containers (`target_healthy=30`) and 4 healthy infrastructure services, against 70 containers in prod compose | A partially failed rollout (up to 40 containers down) can still be reported as success | Use the explicit checks in Section 9 |
| D-7 | Stale text | "33 services", "~35 containers" | Misleading output only | See Appendix A |

---

# 5. Configuration Reference

## 5.1 Where configuration lives

| File | Used by | Notes |
|---|---|---|
| `infra/.env` | `install.sh`; `docker compose --env-file infra/.env` (prod and dev compose) | Generated by installer; contains secrets; `chmod 600` |
| `.env.local` (copy of `.env.example`) | PM2 / local tooling per `.env.example` header | `.env.example` says "Copy to `.env.local`" |
| Kubernetes Secret / Helm values | Helm path | Not defined in the supplied production values file |

Do not mix the two compose files with the same env file without checking variable names: the **dev** compose requires `POSTGRES_ADMIN_PASSWORD`, `KC_DB_PASSWORD` and `KC_ADMIN_PASSWORD`; the **prod** compose requires `POSTGRES_USER`, `POSTGRES_PASSWORD`, `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`.

## 5.2 Variables required by `docker-compose.prod.yml` (compose refuses to start if unset)

| Variable | Purpose | Set by installer? |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | Cluster superuser; also used by PgBouncer and Keycloak's DB connection | Yes |
| `INTERNAL_SERVICE_SECRET`, `DEVICE_TRUST_SECRET` | Service-to-service authentication; device-trust header signing | Yes |
| `MFA_ENC_KEY` | Identity MFA secret encryption | Yes |
| `PII_ENC_KEY` | PII encryption (HRMS and others) | Yes |
| `CITIZEN_PII_KEY`, `CRM_PII_KEY` | Citizen and CRM PII encryption | Yes |
| `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD` | Keycloak bootstrap admin | Yes |
| `CANDIDATE_JWT_SECRET` | HRMS public careers-portal candidate tokens (API process only) | **No** |
| `DATABASE_URL_<SVC>` for the 31 services below | Per-service least-privilege DSN | **No** |

The 31 `DATABASE_URL_` suffixes: `ADMIN`, `ANALYTICS`, `ASSET`, `AUDIT`, `BILLING`, `CITIZEN`, `CONTRACT`, `CRM`, `ESTAB`, `FINANCE`, `GRANT`, `HELPDESK`, `HRMS`, `IDENTITY`, `INSTALL`, `INVENTORY`, `KNOWLEDGE`, `LEGAL`, `LOCATION`, `NOTIFICATION`, `PAYROLL`, `PLUGIN`, `POLICY`, `PROCUREMENT`, `PROJECT`, `REPORT`, `STOCK`, `TELEPHONY`, `TENANT`, `THEME`, `WORKFLOW`.

Each DSN must follow the pattern in `.env.example` and route through PgBouncer, with a dedicated role per service (the compose error text says "do NOT use the cluster superuser"):

```text
DATABASE_URL_IDENTITY=postgresql://identity_svc:<password>@pgbouncer:6432/civitas_identity
```

The roles and databases are created by `db/bootstrap/bootstrap.generated.sql` (mounted into Postgres as `01-bootstrap.sql`). That file and the way role passwords are set were not supplied; confirm the passwords it assigns before writing the DSNs.

## 5.3 Configuration by group (`.env.example` and compose)

### Database and connection pooling

| Key | Purpose | Example / default |
|---|---|---|
| `DATABASE_URL` | Fallback DSN for tooling and for any service lacking a per-service variable (PM2 path) | `postgresql://civitasone:CHANGE_ME@localhost:5432/civitasone` |
| `DATABASE_URL_<SVC>` | Per-service DSN; takes precedence; required in production | `postgresql://identity_svc:CHANGE_ME@pgbouncer:6432/civitas_identity` |
| `DB_VIA_PGBOUNCER` | Disables prepared statements and caps pool when pooling through PgBouncer | `true` (set fleet-wide in prod compose) |
| `DB_POOL_MAX` | Per-process pool cap | `5` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Prod compose Postgres superuser and default database | `civitasone` / generated / `civitasone` |
| `POSTGRES_ADMIN_USER` / `POSTGRES_ADMIN_PASSWORD` | **Dev** compose superuser | default user `civitas_admin`; password required |
| `PROVISIONING_RUNNER_DSN` | Privileged DSN with CREATE DATABASE, used only by install-service for silo-tenant provisioning; must be distinct from service DSNs | commented in template |
| `PROVISIONING_POLL_INTERVAL_MS`, `PROVISIONING_STALE_MS` | Poll cadence and stale-attempt reclaim | `30000`, `600000` |

PgBouncer (prod compose): `POOL_MODE=transaction`, `MAX_CLIENT_CONN=500`, `DEFAULT_POOL_SIZE=20`, `AUTH_TYPE=md5`, `DB_NAME=*`, listening `6432`. The prod compose does not tune Postgres `max_connections` (the template comment cites 200, which the **dev** compose sets explicitly).

### Redis

| Key | Purpose | Default |
|---|---|---|
| `REDIS_URL` | Cache and rate-limit store | `redis://localhost:6379` (template); `redis://redis:6379` (compose, fleet-wide) |
| `REDIS_HOST_PORT` | Dev compose host port | `6381` |

### Keycloak and authentication

| Key | Purpose | Default |
|---|---|---|
| `KEYCLOAK_URL` | Internal issuer base for services | `http://localhost:8080` (template); `http://keycloak:8080` (compose) |
| `KEYCLOAK_REALM` | Realm name | `civitasone` |
| `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | Backend client | `civitasone-backend`, `CHANGE_ME` |
| `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD` | Prod compose bootstrap admin | `admin`, generated |
| `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` / `KC_DB_USER` / `KC_DB_PASSWORD` | **Dev** compose Keycloak admin and DB credentials | passwords required |
| `JWT_ALGORITHM` | Token algorithm | `RS256` (fleet-wide in prod compose) |
| `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Symmetric secret and lifetimes in the template | `CHANGE_ME_MINIMUM_32_CHARS`, `15m`, `7d` |
| `CANDIDATE_JWT_SECRET` | Careers-portal candidate tokens | required in prod compose |
| `DEVICE_TRUST_SECRET`, `INTERNAL_SERVICE_SECRET` | Platform secrets | generated |

`JWT_SECRET` is not set by the prod compose. The template notes that in production the analytics embed-token route requires `JWT_SECRET` and fails closed (HTTP 500 `CONFIG_MISSING`) if it is absent; add it for any deployment that uses analytics dashboard embeds.

### Queue, object storage and messaging

| Key | Purpose | Default |
|---|---|---|
| `QUEUE_DRIVER` | `memory` (tests), `sqs`, `rabbitmq` | `sqs` |
| `AWS_ENDPOINT_URL` | SQS / S3 endpoint | `http://localhost:4566` (template); `http://localstack:4566` (compose) |
| `AWS_DEFAULT_REGION` | Region | `ap-south-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credentials | `test` / `test` (LocalStack placeholders) |
| `AWS_S3_BUCKET` | Object bucket | `civitasone` |
| `RABBITMQ_URL`, `RABBITMQ_PREFETCH`, `RABBITMQ_MAX_RETRIES` | RabbitMQ driver (on-prem) | commented in template |
| `SQS_VISIBILITY_TIMEOUT` | Referenced by earlier guide; not present in the supplied files | not verified |

SNS is not referenced by the compose files or the template (the Terraform SNS resource is outside the supplied files).

### Search

| Key | Purpose | Default |
|---|---|---|
| `SEARCH_ENGINE` | `meilisearch` or `opensearch` | `meilisearch` |
| `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` | Meilisearch endpoint and master key (at least 16 bytes for shared hosts) | `http://localhost:7700`, `CHANGE_ME` |
| `OPENSEARCH_NODE`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD` | OpenSearch option | `https://localhost:9200`, `admin`, `CHANGE_ME` |
| `MEILI_ENV` | Dev compose Meilisearch mode | `development` |

The prod compose neither runs Meilisearch nor sets `SEARCH_ENGINE` / `MEILISEARCH_HOST`; per a comment in the dev compose, the gateway's search route then returns `503 SEARCH_UNAVAILABLE`. Deploy Meilisearch (or OpenSearch) and add the variables to the services before go-live (see Section 8.5).

### Service URLs, ports and networking

| Key | Purpose | Default |
|---|---|---|
| `GATEWAY_PORT` | Host port for the gateway | `8080` |
| `WEB_PORT` | Host port for the web app | `3000` |
| `NEXT_PUBLIC_API_BASE_URL` | Browser-visible API base URL; baked into the web image at build time (build arg) | `http://localhost:8080` |
| `CIVITASONE_API_BASE_URL` | Server-side web to gateway URL | `http://gateway-service:8080` (compose) |
| `CORS_ORIGIN` | Comma-separated allowed origins for the gateway | `http://localhost:3000` (compose default); template example `https://app.civitasone.gov.in,https://admin.civitasone.gov.in` |
| `TRUSTED_PROXY_HOPS` | Trusted reverse-proxy hops for `x-forwarded-for` | template `1`; **not set in prod compose** (code default `0`) |
| `<SVC>_SERVICE_PORT` (e.g. `IDENTITY_SERVICE_PORT=3001`) | Per-service port, for PM2 path | `3001`-`3018` listed; `QUEUE_SERVICE_PORT=3000` in template vs `3030` in compose |
| `IMAGE_REGISTRY`, `IMAGE_TAG` | Image naming | `civitasone`, `latest` |
| `BIND_HOST`, `PORT`, `HOST` | Set by compose per service | `0.0.0.0` |

Fleet-wide settings injected by the prod compose (`x-svc-env`): `NODE_ENV=production`, `DEPLOY_ENV=production`, `QUEUE_DRIVER=sqs`, `DB_VIA_PGBOUNCER=true`, `JWT_ALGORITHM=RS256`.

Image tags: the compose files default to `IMAGE_TAG=latest`. Pin an explicit tag or digest in production so that upgrades and rollbacks are reproducible (Section 10).

### Feature flags and tuning

| Key | Purpose | Default |
|---|---|---|
| `CRM_PUBLIC_CAPTURE_TENANT_MAX_PER_MINUTE` | Per-tenant public lead-capture ceiling | `600` |
| `WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS` | Cooling-off days before an officer re-rates the same contractor | unset (no cooldown) |
| `ALLOW_DEV_OTP_ECHO` | Echo careers-portal OTP in the response. **Local/E2E only; never in staging, UAT or production** | unset (ignored when `NODE_ENV=production`) |
| `ANALYTICS_EMBED_DEV_SECRET` | Dev/test-only embed signing fallback | unset |
| `LOG_LEVEL`, `OTEL_SERVICE_NAME` | Observability | `info`, `civitasone` |

### Secrets summary

| Secret | Min. length / rule | Notes |
|---|---|---|
| `PII_ENC_KEY` | 16 or more characters; service refuses to start otherwise | Optional rotation controls: `PII_KEY_ID` (default `k1`), `PII_ENC_SALT`, `PII_ENC_KEYRING` (JSON map of retired key IDs). Rotate through the keyring, not by replacing the key |
| `INTERNAL_SERVICE_SECRET`, `DEVICE_TRUST_SECRET` | Installer generates 48 characters | Installer's score check requires at least 32 |
| `MFA_ENC_KEY`, `CITIZEN_PII_KEY`, `CRM_PII_KEY` | Installer generates 32 characters | Losing a PII/MFA key makes existing ciphertext unreadable; back up with the secret store |
| Additional secrets named by the runbook (PM2 path) | n/a | `VISITOR_TENANT_SIGNING_KEY_PEM`, `ID_CARD_QR_SECRET`, `COURT_PII_KEY`, `MEETING_PII_KEY`, `VISITOR_PII_KEY`, `PROCUREMENT_PII_KEY`, `FINANCE_PII_KEY`, and eleven `*_SCANNER_DATABASE_URL` variables. These belong to services that are **not in the prod compose file** (Section 6.6) |

---

# 6. Manual / Step-by-Step Installation

## 6.1 Local development

```bash
git clone https://github.com/dbn1972/civitasone-suite.git
cd civitasone-suite
pnpm install

# infrastructure only
docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml up -d

pnpm --filter @civitasone/web dev                 # web on :3000
pnpm --filter @civitasone/finance-service dev     # a single service
```

Before the first start, create `infra/.env` containing at least `POSTGRES_ADMIN_PASSWORD`, `KC_DB_PASSWORD` and `KC_ADMIN_PASSWORD` (the dev compose uses `:?` on these). Be aware of two environment-specific values hard-coded in the dev compose Keycloak service: `KC_HOSTNAME: civitasone.65-2-205-201.nip.io` and `KC_HTTP_RELATIVE_PATH: /auth`. Edit these for your own host; with the relative path, the realm issuer is `http://localhost:8180/auth/realms/civitasone` (note the `/auth` prefix, which the prod compose does **not** use).

`README.md` lists the dev gateway as `http://localhost:4000`; the compose files use `8080`. Verify the actual port in the service's configuration.

## 6.2 Single-host production compose: prerequisites on the host

1. Install Docker Engine 24 or later with the Compose v2 plugin; confirm with `docker version` and `docker compose version`.
2. Check out the repository and the exact release to deploy (Section 10.1).
3. Ensure these files exist (all are mounted by the compose file; the paths are relative to `infra/`): `db/bootstrap/bootstrap.generated.sql`, `db/bootstrap/keycloak_bootstrap.sql`, `db/03-pg-stat-statements.sql`, `keycloak/civitasone-realm.json`, and the `localstack-init/` directory. These were **not supplied**; if `bootstrap.generated.sql` is generated by a script, run that generator first (the generating command was not identified in the supplied files).
4. Open firewall ports 8080 and 3000 to the reverse proxy only; block 6432 from untrusted networks.

## 6.3 Create the environment file

```bash
umask 077
cat > infra/.env <<'EOF'
IMAGE_REGISTRY=civitasone
IMAGE_TAG=<pinned-release-tag>
POSTGRES_USER=civitasone
POSTGRES_PASSWORD=<generated>
POSTGRES_DB=civitasone
INTERNAL_SERVICE_SECRET=<generated-48>
DEVICE_TRUST_SECRET=<generated-48>
MFA_ENC_KEY=<generated-32>
PII_ENC_KEY=<generated-32>
CITIZEN_PII_KEY=<generated-32>
CRM_PII_KEY=<generated-32>
CANDIDATE_JWT_SECRET=<generated-48>
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=<generated>
KEYCLOAK_REALM=civitasone
AWS_DEFAULT_REGION=ap-south-1
AWS_S3_BUCKET=civitasone
GATEWAY_PORT=8080
WEB_PORT=3000
CORS_ORIGIN=https://<public-web-host>
NEXT_PUBLIC_API_BASE_URL=https://<public-api-host>
# 31 per-service DSNs, one per suffix listed in Section 5.2
DATABASE_URL_IDENTITY=postgresql://identity_svc:<pw>@pgbouncer:6432/civitas_identity
# ... DATABASE_URL_TENANT, _POLICY, _AUDIT, and so on
EOF
chmod 600 infra/.env
```

Generate values the same way the installer does, for example `openssl rand -base64 48 | tr -d '/+=' | head -c 48`.

Remember that `NEXT_PUBLIC_API_BASE_URL` is a **build argument** for the web image: changing it requires rebuilding `web`.

## 6.4 Validate, build, start

```bash
C="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env"

$C config -q                                   # fails if any ${VAR:?} is unset

$C build                                       # first build: 5-15 min per installer message

$C up -d postgres pgbouncer redis localstack keycloak
$C ps                                          # wait until the five report healthy

# database bootstrap and migrations: Section 7

$C up -d                                       # application services, workers, queue, gateway, web
$C ps
```

Start-up ordering is enforced by compose: every API service and worker depends on healthy `postgres`, `pgbouncer`, `redis` and `localstack`; `web` depends on a healthy `gateway-service`.

Image build hazard to check: each `*-worker` service is built from the same image name as its API service (for example `civitasone/identity-service:latest`) with a different `ENTRY` build argument (`dist/worker.js` versus `dist/index.js`), and neither defines a `command`. If the Dockerfile bakes `ENTRY` into the image, the two builds write the same tag and only one entry point survives. The Dockerfile was not supplied. After the first start, verify each pair runs a different process (for example `docker inspect --format '{{.Config.Cmd}}' <container>` for `identity-service` and `identity-worker`) and compare with `docker compose logs`.

## 6.5 Helm (on-prem Kubernetes) with caveats

```bash
helm template civitasone infra/onprem/helm/civitasone \
  -f infra/onprem/helm/civitasone/values.production.yaml   # render and inspect first (Section 2.3)

helm upgrade --install civitasone infra/onprem/helm/civitasone \
  --namespace civitasone --create-namespace \
  -f infra/onprem/helm/civitasone/values.production.yaml \
  --set image.registry=YOUR_REGISTRY \
  --set image.tag=<pinned-release-tag>
```

The `--set image.registry` / `--set image.tag` pair is the command printed by `install.sh --mode helm`. The production values header comment gives the equivalent `helm upgrade civitasone . -f values.yaml -f values.production.yaml`. Create the Kubernetes Secret and provide database, Redis, queue and Keycloak endpoints separately; those are not in the supplied values. Ensure the `ingress.host` placeholder (`civitasone.example.gov.in`) is replaced with the real `.gov.in` host and that the TLS secret `civitasone-tls` exists.

## 6.6 Service coverage of the compose file

The prod compose defines **31 API services plus 31 workers, `queue-service`, `gateway-service` and `web`** (65 application containers). The platform is described as roughly 66 to 68 services (65 database-backed) with per-service databases. Services named in the runbook and `.env.example` that have **no entry in the prod compose** include the court, meeting, visitor, works, inspection, journey, vendor and animal services (inferred from `COURT_PII_KEY`, `MEETING_PII_KEY`, `VISITOR_PII_KEY`, `*_SCANNER_DATABASE_URL`, `works-service` and `vendor-service` / `animal-service` references). If your build includes these modules, the packaged compose file does not start them; they would need entries added or must be run another way (the PM2 `ecosystem.config.js` path in the runbook declares 132 apps). The authoritative service list was not supplied; confirm against `services/`.

---

# 7. Database Bootstrap, Migrations and Seed Data

## 7.1 Model

Each service owns a database (`civitas_<service>`) and a least-privilege role (`<service>_svc`). All runtime traffic goes through PgBouncer in transaction mode. Cross-service data exchange is asynchronous via the queue, not cross-database SQL.

## 7.2 Bootstrap

| Mechanism | Detail (verified from compose) |
|---|---|
| Initial bootstrap | On first start of an **empty** `pgdata` volume, Postgres runs the mounted files in order: `01-bootstrap.sql` (from `db/bootstrap/bootstrap.generated.sql`), `02-keycloak.sql` (from `db/bootstrap/keycloak_bootstrap.sql`; Keycloak connects to database `keycloak`), `03-pg-stat-statements.sql` |
| `pg_stat_statements` | Preloaded through command-line flags (`shared_preload_libraries=pg_stat_statements`, `pg_stat_statements.track=all`, `pg_stat_statements.max=5000`) |
| Installer re-run | `docker compose exec -T postgres psql -U civitasone -f /docker-entrypoint-initdb.d/01-bootstrap.sql` (no `-d`, so it connects to database `civitasone`). A failure is reported as WARN because the file may already have been applied |

The init scripts run only when the data directory is empty. To re-bootstrap from scratch you must remove the volume (destructive: `docker compose ... down -v` deletes `pgdata`). Do not do this on a system holding data.

## 7.3 Migrations

The installer runs `node scripts/dev/migrate-all.mjs` and describes it as idempotent ("safe to re-run"). `INSTALLATION-OPERATIONS-GUIDE.md` instead cites `pnpm run db:migrate`. The migration scripts were not supplied, so neither the DSN source nor the run order could be verified. Practical guidance:

1. Run migrations from a host or container that can reach the databases. In prod compose, Postgres is not published; only PgBouncer `6432` is. Confirm that `migrate-all.mjs` works through PgBouncer and with the per-service credentials, or run it in a container attached to the `civitasone` network.
2. Migration files are forward-only and numbered (`0001_`, `0002_`, ...) per the earlier guide. Down-migrations exist only for `vendor-service`, `animal-service` and `identity-service` (runbook REL-020, `scripts/ops/migrate-rollback.sh`).
3. Take a database backup before every migration run (Section 10).

## 7.4 Seed data

No seed script was supplied, so none can be quoted here. The files mention, without detail, a "setup wizard" at first login (`install-service`) and a Keycloak realm import. Seed or demo data, if used for a pilot or UAT, must come from the repository's own scripts; document their exact names and run order in the environment's install record. Do not seed placeholder-looking data into a customer-facing environment.

---

# 8. Post-Install Configuration

## 8.1 Keycloak realm and clients

- The realm is imported on Keycloak start from `infra/keycloak/civitasone-realm.json` (`--import-realm`). It is imported only if the realm does not already exist in the Keycloak database.
- Prod compose runs Keycloak 25.0 with `start --optimized --hostname-strict=false --http-enabled=true --import-realm`; there is no `KC_HOSTNAME` and no published port. The Keycloak admin console is therefore reachable only from inside the Docker network unless you add a proxy or port mapping.
- Services validate tokens against `KEYCLOAK_URL=http://keycloak:8080` using RS256 (`JWT_ALGORITHM=RS256`) with the realm named by `KEYCLOAK_REALM`.
- Tenant isolation relies on a `tid` claim in the access token. On the staging realm this claim was produced by a Keycloak mapper (user attribute `tenantId` mapped to claim `tid`); a user without the attribute yields a token without `tid`. Confirm the realm you import carries the mapper, and that every user has the attribute (this is an observation from a prior environment, not something the supplied files prove).
- After first login: change the bootstrap admin credentials, create the platform and tenant admin users, assign roles (the earlier guide names `super_admin` and `platform_admin`), and enable MFA/SSO as required by policy.
- Prod versus dev differences to reconcile: Keycloak 25.0 versus 24.0; no relative path versus `/auth`; `--optimized` against an unmodified upstream image. `start --optimized` normally expects the image to have been built with the same build options (including `KC_DB`) and the supplied compose does not include a build step. If Keycloak fails to start with a build-option mismatch, drop `--optimized` from the `command`. This was not tested here.

## 8.2 First-run and tenant onboarding

1. Browse to the web URL; first-time sessions are directed to the installer wizard at `/install` (`install-service`), per the earlier guide (not re-verified).
2. Create the platform tenant and the first municipal tenant through the wizard or admin APIs.
3. For silo tenants (dedicated databases), set `PROVISIONING_RUNNER_DSN` for `install-service`; without it the provisioning poll loop skips its cycle and logs an error rather than falling back to the service DSN.
4. Create tenant users in Keycloak with the `tenantId` attribute so tokens carry `tid`.
5. Verify cross-tenant isolation with two tenants before loading real data.

## 8.3 Government integration adapters: mock/stub by default

The installer **does not configure any live government-rail integration**. PFMS, NACH, GSTN, eSign and DSC adapters default to mock or stub implementations (engagement brief). The supplied files corroborate the absence of wiring: `.env.example`, `docker-compose.prod.yml` and `install.sh` contain no variables, endpoints, certificates or credentials for any of these rails. Treat every environment installed by this guide as **non-production for statutory flows** until each adapter has been configured, credentialled with the government agency, and tested against the agency's sandbox and production endpoints. Record per adapter: owner, endpoint, credential custody, certificate expiry, and the date the mock was disabled. Do not state in any acceptance document that a government integration is live unless it has been verified against the real counterparty.

## 8.4 TLS, reverse proxy and network exposure

- **No TLS exists in the supplied compose or installer.** The web (3000) and gateway (8080) listen on plain HTTP. Keycloak runs HTTP with `--hostname-strict=false --http-enabled=true`. This is acceptable only behind a TLS-terminating reverse proxy or load balancer (Nginx, ALB, ingress controller) on a private network.
- The proxy must: present a CA-signed certificate for the `.gov.in` hostnames; forward `X-Forwarded-For` and `X-Forwarded-Proto`; route the web host to `:3000`, the API host to `:8080`, and an identity host to Keycloak (browsers must be able to reach the Keycloak issuer for OIDC redirects).
- Keycloak behind a proxy needs a consistent public hostname and proxy-header settings (the dev compose uses `KC_PROXY_HEADERS: xforwarded`, `KC_HOSTNAME`, `KC_HOSTNAME_STRICT_HTTPS: "true"`; the prod compose sets none of these). Without them, issuer URLs in tokens will not match the public URL.
- Set `TRUSTED_PROXY_HOPS=1` (not set in prod compose) when traffic reaches services through the gateway and one proxy; otherwise per-IP rate limits for public endpoints collapse to a single counter. Do not set it higher than the real number of trusted proxies.
- Set `CORS_ORIGIN` to the exact public web origin(s); the compose default is `http://localhost:3000`.
- Restrict host port `6432` (PgBouncer) to localhost or a management network; the prod compose publishes it on all interfaces.
- Replace `AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test` and, for production, decide whether LocalStack is acceptable (Section 8.6).

## 8.5 Search

Add Meilisearch (or OpenSearch) and set `SEARCH_ENGINE`, `MEILISEARCH_HOST` and `MEILISEARCH_API_KEY` for the gateway and the indexing services; then run the knowledge reindex (`services/knowledge-service/src/reindex-search.ts`, as named in the dev compose comment).

## 8.6 Queue and object storage are emulated

The prod compose runs **LocalStack** (`SERVICES: sqs,s3`) for SQS and S3, with credentials `test`/`test` by default. It has no data volume, so queued messages and stored objects are lost when the container is recreated. For production-grade durability, point `AWS_ENDPOINT_URL`, credentials and `AWS_S3_BUCKET` at real AWS (or another S3/SQS-compatible service) and remove the `localstack` dependency; or use `QUEUE_DRIVER=rabbitmq` on-prem (template option, not wired in compose).

## 8.7 Backups

Referenced, not supplied: `scripts/ops/backup-databases.sh [BACKUP_DIR]`, `scripts/ops/restore-drill.sh`, `.github/workflows/dr-drill.yml`. Schedule the backup (the earlier guide states daily 02:00 UTC with 30-day retention and a restore drill each quarter) and back up the Keycloak realm and the secret store. The stateful volumes in prod compose are `pgdata` and `redisdata` only.

---

# 9. Health Verification and Smoke Checks

## 9.1 What the installer probes (`post_install_validate`)

| Check | Method | Result on failure |
|---|---|---|
| Gateway health | `curl -sf http://localhost:<GATEWAY_PORT>/health` | FAIL |
| Web application | `curl -sf http://localhost:<WEB_PORT>` | WARN |
| Redis | `docker compose exec -T redis redis-cli ping` expects `PONG` | WARN |
| PostgreSQL | `pg_isready -U civitasone` expects "accepting" | WARN |
| SQS | `docker compose exec -T localstack awslocal sqs list-queues` | WARN |
| Keycloak | `curl` to `localhost:8180/health/ready` or `localhost:8080/health/ready` | WARN |
| API round-trip | Second `curl` to `/health` | WARN |

## 9.2 Recommended checks

```bash
C="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env"

# 1. container state: expect 70 containers running; services with a healthcheck report healthy
$C ps
$C ps --status running -q | wc -l

# 2. anything not running or unhealthy
$C ps --format '{{.Service}} {{.State}} {{.Health}}' | grep -v 'running healthy' | grep -v 'running $'

# 3. gateway liveness and readiness
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/ready

# 4. web
curl -fsSI http://localhost:3000/ | head -1

# 5. stateful services
$C exec -T postgres pg_isready -U "$(grep ^POSTGRES_USER infra/.env | cut -d= -f2)"
$C exec -T redis redis-cli ping
$C exec -T localstack awslocal sqs list-queues | head

# 6. Keycloak (not published; check inside the network)
$C exec -T keycloak bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080 && echo open'

# 7. Prometheus-style metrics from the gateway (endpoint referenced by the installer's score check)
curl -fsS http://localhost:8080/metrics | head
```

Notes:

- Container-level health in compose uses `GET /ready` on each service's own port for the 31 API services, `queue-service`, `gateway-service`, and `/` for `web`. Only 39 services define a healthcheck (5 infrastructure plus 34 application). **The 31 workers have no healthcheck**, so "healthy" does not cover background processing. Check worker logs and queue depth separately: `$C logs --tail=50 <name>-worker`.
- `/health`, `/ready` and `/metrics` are described in the earlier guide as present on each service; the installer and compose files exercise `/health` (gateway) and `/ready` (all).

## 9.3 Functional smoke test (acceptance)

1. Log in through Keycloak as a tenant user; decode the access token and confirm `tid` and expected roles.
2. Create a record that triggers an asynchronous command (for example a finance or HR entity); expect HTTP 202 from the API, then confirm the worker processed it (record visible, audit entry written).
3. Upload and download a file (S3 path).
4. Confirm global search returns results (after Section 8.5).
5. Confirm a second tenant cannot see the first tenant's record.
6. Run `./install.sh --validate` (after fixing D-1) and record the readiness score with the caveats in Section 4.7.

---

# 10. Upgrade and Rollback

## 10.1 Compose upgrade procedure

```bash
C="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env"

# 1. record the running version
$C images > ~/upgrade-pre-$(date +%Y%m%d-%H%M%S).txt

# 2. backup databases (script referenced, not supplied)
./scripts/ops/backup-databases.sh /var/backups/civitasone

# 3. fetch the target release and pin the tag
git fetch --tags && git checkout <release-tag>
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<release-tag>/' infra/.env

# 4. build (or pull) and validate
$C config -q && $C build

# 5. migrate (idempotent per installer), then roll the services
node scripts/dev/migrate-all.mjs
$C up -d

# 6. verify (Section 9)
```

Re-running `up -d` recreates only changed containers. There is no zero-downtime cut-over: every container restart is a brief outage for that service, and `restart: unless-stopped` is the only recovery policy.

## 10.2 Compose rollback

1. Re-point `IMAGE_TAG` in `infra/.env` to the previous tag and run `$C up -d`. This works only if the previous images still exist locally or in the registry. Pinned tags (not `latest`) are required for this to be reliable.
2. Schema: migrations are forward-only. A rollback of application code against an already-migrated schema is safe only if the previous release tolerates the new schema. Otherwise restore from the pre-upgrade backup (`scripts/ops/restore-drill.sh` shows the restore procedure) or apply a compensating migration. Per-service down-migrations exist only for `identity-service`, `vendor-service` and `animal-service` (`scripts/ops/migrate-rollback.sh --service <name> --list | --dry-run`).
3. Never run `down -v` as part of a rollback; it deletes the Postgres and Redis volumes.

## 10.3 Helm upgrade and rollback

```bash
helm upgrade civitasone infra/onprem/helm/civitasone -n civitasone \
  -f infra/onprem/helm/civitasone/values.production.yaml --set image.tag=<release-tag>
helm history civitasone -n civitasone
helm rollback civitasone <REVISION> -n civitasone
```

`helm rollback` reverts Kubernetes resources only, never the database.

## 10.4 PM2 host (per runbook)

`pm2 restart all` restarts only processes PM2 already knows; `pm2 start ecosystem.config.js` additionally starts newly declared apps but re-evaluates the whole file and fails unless all module-level secrets are exported in the invoking shell. The runbook directs running both, in that order, then `pm2 save`, and verifying with `node scripts/ops/verify-fleet-reconciled.mjs`. Application rollback is `bash scripts/rollback.sh` (does not touch databases). Use the runbook's own probe (`node -e "require('./ecosystem.config.js')"`) rather than any copied secret list, as the runbook itself warns the list goes stale.

---

# 11. Troubleshooting

Entries are derived from `install.sh` messages and compose behaviour.

| Symptom | Likely cause | Resolution |
|---|---|---|
| Installer prints the first pre-flight line then exits with status 1 and no error | Defect D-1 (`((PASS++))` under `set -e`) | Patch counters to `PASS=$((PASS+1))` or use Section 6 |
| "Pre-flight failed with N error(s)" | Missing `curl/openssl/jq/git`, Docker below 24.0.0, Compose plugin absent, daemon down, memory below 4 GB, disk below 20 GB, unsupported architecture, bash 3.x | Install or upgrade the item shown in the failing line; start Docker with `sudo systemctl start docker`; re-run |
| "Port N in use by ..." (WARN) | Existing listener on 8080, 3000, 5432, 6379 or 6432 | Stop the process or change `GATEWAY_PORT` / `WEB_PORT` in `infra/.env`; for 6432 note that it is hard-coded in prod compose |
| "Compose config validation: Missing required variables in infra/.env" | Unset `${VAR:?}` (defect D-2) | Run `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env config` without `-q` to see the first missing name; add all 31 `DATABASE_URL_*` and `CANDIDATE_JWT_SECRET` |
| "Image build failed. Ensure Docker has at least 8GB memory allocated." | Out of memory / disk during multi-service build; no network for base images | Increase Docker resources; check `.install-log/*.log`; use a private registry if Docker Hub is blocked |
| Infrastructure health timeout (WARN after 120 s) | Keycloak start period (60 s) plus realm import, or LocalStack init | `$C ps`, `$C logs keycloak localstack`; wait and re-check |
| Keycloak container restarts or exits | `--optimized` mismatch on a stock image; DB `keycloak` missing; wrong DB credentials | Inspect `$C logs keycloak`; remove `--optimized`; verify `02-keycloak.sql` ran (empty volume only) |
| "Per-service database bootstrap (may be already done)" | Init script already applied on an existing volume | Expected on resume; inspect `docker compose exec postgres psql -U civitasone -c '\l'` |
| "Migration failure. Re-run with --resume after fixing the issue." | `node` missing or below 20, dependencies not installed (`pnpm install`), DB unreachable from host (Postgres not published), bad credentials | Check `.install-log`; run the migration script manually from a context with network access |
| Services stay below 30 running | Missing required variable, DB role/password mismatch, dependency (`localstack`) unhealthy | `$C ps -a`, `$C logs --tail=100 <service>`; fix `infra/.env`; `$C up -d` |
| API service crash-loops on start | PII/secret too short or missing (`PII_ENC_KEY` under 16 chars), DSN wrong | Read the service log; the process fails closed by design |
| Gateway `/health` fails | Gateway waiting on dependencies; `CORS_ORIGIN` unaffected | `$C logs gateway-service`; confirm `Keycloak` and `redis` reachable |
| Web loads but API calls go to `localhost` | `NEXT_PUBLIC_API_BASE_URL` was baked at build time with the default | Set the correct value in `infra/.env` and rebuild the `web` image |
| Login redirects fail or tokens rejected (401) | Public issuer differs from `KEYCLOAK_URL`/hostname; realm path (`/auth`) mismatch; clock skew | Align Keycloak hostname/proxy settings (Section 8.4); check NTP |
| Tokens lack `tid` / tenant data missing | User lacks `tenantId` attribute or mapper missing | Section 8.1 |
| Global search returns `SEARCH_UNAVAILABLE` (503) | Prod compose runs no Meilisearch | Section 8.5 |
| Queue messages lost after restart | LocalStack has no persistence volume | Section 8.6 |
| Rate limiting appears shared across all clients | `TRUSTED_PROXY_HOPS` unset (default 0) behind a proxy | Section 8.4 |
| Analytics embeds return 500 `CONFIG_MISSING` | `JWT_SECRET` not set in production | Add `JWT_SECRET` |
| Worker and API behave identically | Shared image tag overwritten at build (Section 6.4) | Inspect container `Cmd`; build with distinct tags |
| Resume regenerated secrets and Postgres rejects the password | `--resume` omitted, so `infra/.env` was rewritten | Restore the previous `.env`; always pass `--resume` after a first generation |

Diagnostic artefacts: installer log `.install-log/install-<timestamp>.log`; state file `.install-state.json`; container logs via `docker compose ... logs`.

---

# Appendix A. Accuracy and Drift

Each row compares a claim in an existing document or script with what the supplied code does.

| # | Claim (source) | What the code actually does | Recommendation |
|---|---|---|---|
| A-1 | Production is Kubernetes/Helm ("Helm / Kubernetes: Production govt deployments", `INSTALLATION-OPERATIONS-GUIDE.md`; installer menu "production HA, autoscaling") | The packaged, working-by-construction path is single-host `docker-compose.prod.yml`. The Helm chart is version 0.1.0; its templates were not available to confirm HPA/PDB/NetworkPolicy behaviour; `install.sh --mode helm` only prints a command. AWS Terraform ships only SQS/SNS/RDS replica (per brief) | Describe Helm as "on-prem / self-managed Kubernetes, with caveats". Do not claim EKS or HA |
| A-2 | Helm values `hpa`, `pdb`, `networkPolicy` enable autoscaling, disruption budgets and network isolation (`values.production.yaml`) | Unverifiable from the supplied files: if template keys differ, the overrides are silently ignored; `networkPolicy.enabled` may block egress to an external managed database | Run the `helm template` check in Section 2.3; align key names; add an explicit egress rule for the database |
| A-3 | "PM2 (bare metal) ... Current staging environment" (`INSTALLATION-OPERATIONS-GUIDE.md`), runbook is entirely PM2 (132 apps), while the brief states production runs `docker-compose.prod.yml` | The two documents imply different live topologies; the supplied files do not say which hosts the pilot build | Obtain a signed-off statement of the pilot's actual runtime and add it to the Cloud/Infra architecture documents |
| A-4 | "33 services" / "~35 containers" / "Building 33 services + gateway + web" (`install.sh`, `README.md`) | Prod compose defines 70 containers (5 infrastructure + 65 application); platform is about 66-68 services (65 database-backed). Compose omits several services (Section 6.6) | Update all counts; derive the service list from the repository |
| A-5 | `install.sh` completes a compose install end-to-end | D-1: exits at the first check under `set -e`. D-2: generated `.env` lacks 31 DSNs and `CANDIDATE_JWT_SECRET` so `config -q` would fail | Fix counters; extend `configure_environment` to generate DSNs and the missing secret; add a CI test that runs `--dry-run` |
| A-6 | `--dry-run` "no changes will be made" | `configure_environment` still writes `infra/.env` | Guard the write with `DRY_RUN` |
| A-7 | `--config FILE` for non-interactive configuration | The file is sourced but the ports/CORS/API URL are local variables, so config values are ignored; file contents run as shell code | Read named keys from the config file explicitly; document it as trusted code |
| A-8 | Resume continues "from last checkpoint" | Only pre-flight and mode selection are skipped; every later step re-runs. `TOTAL_STEPS` is 9 but 8 steps exist | Describe as re-run-idempotent; correct the step count |
| A-9 | Docker Compose "Flow A": `cp .env.example .env.local`, start `infra/docker-compose.yml` services, then `docker compose -f infra/docker-compose.prod.yml --env-file .env.local up -d`; `node scripts/ci/bootstrap-postgres.sh` (`INSTALLATION-OPERATIONS-GUIDE.md`) | Dev and prod compose define overlapping services (`postgres`, `redis`, `keycloak`, `pgbouncer`, `localstack`), publish port 6432 in both, and need different variable names. Installer uses `infra/.env`, not `.env.local`. A `.sh` script is run with `node` | Use one compose file per host; use `infra/.env`; run shell scripts with `bash` |
| A-10 | Helm "Flow B" uses `-f infra/onprem/helm/values.production.yaml` and installs Bitnami PostgreSQL with the CivitasOne values file; migration Job at `infra/onprem/k8s/base/migration-job.yaml` (`INSTALLATION-OPERATIONS-GUIDE.md`) | The values file is at `infra/onprem/helm/civitasone/values.production.yaml`; passing it to a Bitnami chart is incorrect; the Job manifest was not supplied | Use the paths and commands in Section 6.5; verify the Job file exists |
| A-11 | Keycloak "8180 internal" and README "Keycloak Admin http://localhost:8180"; installer prints and probes `8180` | Port 8180 exists only in the dev compose. Prod compose does not publish Keycloak at all | Publish via the reverse proxy or document `docker exec`-only access |
| A-12 | Keycloak 24.x tested (`INSTALLATION-OPERATIONS-GUIDE.md`, README) | Dev compose uses 24.0; prod compose uses 25.0 with `--optimized`, no relative path, no hostname | Standardise the version; test the prod command on a stock image |
| A-13 | Keycloak secure by default | Prod compose runs HTTP with `--hostname-strict=false --http-enabled=true` and no proxy-header settings | Terminate TLS in front; set hostname and proxy settings (Section 8.4) |
| A-14 | Object storage "Server-side encryption (AES-256), lifecycle archive 90d"; "real SQS (prod)" | Prod compose runs LocalStack with `test`/`test` credentials and no data volume | Use real AWS (or compatible) for production; add persistence if LocalStack is retained |
| A-15 | Government rails (PFMS, NACH, GSTN, eSign, DSC) integrated | No configuration for any of them in `.env.example`, compose or installer; defaults are mock/stub (brief) | State as "mock until wired"; add a per-adapter go-live checklist |
| A-16 | Global search available out of the box (`SEARCH_ENGINE=meilisearch` default) | Prod compose runs no search engine and sets no search variables | Add Meilisearch/OpenSearch to the production topology |
| A-17 | "Direct :5432 connections forbidden in production" (`.env.example`) | Prod compose does not publish 5432 (consistent), but publishes PgBouncer 6432 on all interfaces, and the installer's host-side migration needs DB reachability | Bind 6432 to a management interface; run migrations in-network |
| A-18 | Readiness score 100 = production ready | Heuristic file-presence checks; the caching check can never pass (max 95); it passes with placeholder AWS keys and no TLS | Treat the score as hygiene only; do not use it as a go-live gate |
| A-19 | Prerequisite constants for Helm and Node | `MIN_HELM_VERSION`, `MIN_NODE_VERSION` and kubectl are never validated | Add checks (Node is needed for the migration step) |
| A-20 | README gateway `http://localhost:4000` | Compose gateway is `8080` | Correct the README |
| A-21 | `.env.example` `QUEUE_SERVICE_PORT=3000`, `KEYCLOAK_URL=http://localhost:8080` | Compose queue-service is `3030`; `3000` is the web port; `8080` is the gateway port | Correct the template to avoid port collisions |
| A-22 | `.env.example` states `max_connections=200` as the budget | Only the dev compose sets `max_connections=200`; prod compose leaves the Postgres default | Add the setting to prod compose or reconcile `CONNECTION-BUDGET.md` |
| A-23 | Worker and API images are distinct | Both reference the same image name with different build args and no `command` | Verify the Dockerfile; use distinct tags or a `command` override |
| A-24 | Seed data / `validate-install.sh`, `backup-databases.sh`, `restore-drill.sh`, `migrate-all.mjs`, `bootstrap.generated.sql`, `DEPLOY.md`, `ecosystem.config.js` | Referenced by the supplied files but none were supplied | Re-run this verification when those files are available |

---

# Appendix B. Quick Reference

| Task | Command |
|---|---|
| Installer help | `./install.sh --help` |
| Render compose config | `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env config` |
| Start infrastructure only | `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d postgres pgbouncer redis localstack keycloak` |
| Start everything | `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d` |
| Status / logs | `... ps` / `... logs -f <service>` |
| Stop (keep data) | `... down` |
| Installer log / state | `.install-log/install-<timestamp>.log` / `.install-state.json` |
| Dev infrastructure | `docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml up -d` |
| Helm render check | `helm template civitasone infra/onprem/helm/civitasone -f infra/onprem/helm/civitasone/values.production.yaml` |
